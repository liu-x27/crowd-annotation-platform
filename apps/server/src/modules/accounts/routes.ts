import {
  type AuthState,
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  registerSchema,
  updateMeSchema,
  updateUserSchema,
} from '@crowd/shared';
import { eq, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../../app';
import { currentUser, requireCapability, requireUser, toMe } from '../../auth/middleware';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../../auth/password';
import { RateLimiter } from '../../auth/rate-limit';
import {
  createSession,
  destroySession,
  destroyUserSessions,
  SESSION_COOKIE,
} from '../../auth/sessions';
import { type UserRow, users } from '../../db/schema';
import { AppError, conflict, forbidden, tooMany } from '../../lib/errors';
import { body, idParam } from '../../lib/validate';
import { createUser, findUserByName, listUsers, myStats, updateUser } from './service';

function clientIp(c: Context<AppEnv>): string {
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming;
  return incoming?.socket?.remoteAddress ?? 'unknown';
}

export function validTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

async function startSession(c: Context<AppEnv>, user: UserRow): Promise<void> {
  const { db, config } = c.var.deps;
  const { token, expiresAt } = await createSession(db, user.id, config.sessionTtlMs, {
    userAgent: c.req.header('user-agent'),
    ip: clientIp(c),
  });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.cookieSecure,
    path: '/',
    expires: expiresAt,
  });
}

export function authRoutes() {
  const loginLimiter = new RateLimiter(10, 15 * 60_000);
  const registerLimiter = new RateLimiter(20, 60 * 60_000);

  return (
    new Hono<AppEnv>()
      .get('/state', async (c) => {
        const { db, config } = c.var.deps;
        const [anyone] = await db.select({ id: users.id }).from(users).limit(1);
        const state: AuthState = {
          needsSetup: !anyone,
          registrationOpen: config.allowRegistration && !!anyone,
          user: c.var.user ? toMe(c.var.user) : null,
        };
        return c.json(state);
      })

      // The first account becomes the admin. Only possible while there are no users at all,
      // which replaces v1's "register, then promote yourself with mongosh".
      .post('/setup', async (c) => {
        const { db } = c.var.deps;
        const input = await body(c, registerSchema);
        const passwordHash = await hashPassword(input.password);
        const user = await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(7201)`);
          const [existing] = await tx.select({ id: users.id }).from(users).limit(1);
          if (existing)
            throw conflict(
              'already_set_up',
              'This instance already has an admin. Sign in instead.',
            );
          const [created] = await tx
            .insert(users)
            .values({
              username: input.username,
              displayName: input.displayName || null,
              passwordHash,
              role: 'admin',
            })
            .returning();
          return created!;
        });
        await startSession(c, user);
        return c.json(toMe(user), 201);
      })

      .post('/login', async (c) => {
        const { db } = c.var.deps;
        const { username, password } = await body(c, loginSchema);
        const key = `${clientIp(c)}|${username.toLowerCase()}`;
        const wait = loginLimiter.hit(key);
        if (wait > 0)
          throw tooMany(`Too many attempts. Try again in ${Math.ceil(wait / 60_000)} min.`);

        const user = await findUserByName(db, username);
        // Verify against a dummy hash for unknown names so timing does not reveal them.
        const result = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !result.ok) {
          throw new AppError(401, 'invalid_credentials', 'Wrong username or password.');
        }
        if (user.disabledAt)
          throw new AppError(403, 'account_disabled', 'This account is disabled.');
        if (result.needsRehash) {
          await db
            .update(users)
            .set({ passwordHash: await hashPassword(password) })
            .where(eq(users.id, user.id));
        }
        loginLimiter.reset(key);
        await startSession(c, user);
        return c.json(toMe(user));
      })

      .post('/logout', async (c) => {
        const token = getCookie(c, SESSION_COOKIE);
        if (token) await destroySession(c.var.deps.db, token);
        deleteCookie(c, SESSION_COOKIE, { path: '/' });
        return c.json({ ok: true });
      })

      .post('/register', async (c) => {
        const { db, config } = c.var.deps;
        if (!config.allowRegistration)
          throw forbidden('Registration is closed. Ask an admin for an account.');
        const [anyone] = await db.select({ id: users.id }).from(users).limit(1);
        if (!anyone) throw conflict('needs_setup', 'Create the admin account first.');
        if (registerLimiter.hit(clientIp(c)) > 0)
          throw tooMany('Too many registrations from this address.');
        const input = await body(c, registerSchema);
        const user = await createUser(db, { ...input, role: 'annotator' });
        await startSession(c, user);
        return c.json(toMe(user), 201);
      })
  );
}

export function meRoutes() {
  return new Hono<AppEnv>()
    .use(requireUser)
    .get('/', (c) => c.json(toMe(currentUser(c))))
    .patch('/', async (c) => {
      const { db } = c.var.deps;
      const me = currentUser(c);
      const input = await body(c, updateMeSchema);
      const [updated] = await db
        .update(users)
        .set({ displayName: input.displayName || null })
        .where(eq(users.id, me.id))
        .returning();
      return c.json(toMe(updated!));
    })
    .post('/password', async (c) => {
      const { db } = c.var.deps;
      const me = currentUser(c);
      const input = await body(c, changePasswordSchema);
      const check = await verifyPassword(input.current, me.passwordHash);
      if (!check.ok) throw new AppError(400, 'wrong_password', 'The current password is wrong.');
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(input.next) })
        .where(eq(users.id, me.id));
      await destroyUserSessions(db, me.id, getCookie(c, SESSION_COOKIE));
      return c.json({ ok: true });
    })
    .get('/stats', async (c) => {
      const me = currentUser(c);
      return c.json(await myStats(c.var.deps.db, me.id, validTimeZone(c.req.query('tz'))));
    });
}

export function userRoutes() {
  return new Hono<AppEnv>()
    .use(requireCapability('user:manage'))
    .get('/', async (c) => c.json(await listUsers(c.var.deps.db)))
    .post('/', async (c) => {
      const input = await body(c, createUserSchema);
      const user = await createUser(c.var.deps.db, input);
      return c.json(toMe(user), 201);
    })
    .patch('/:id', async (c) => {
      const input = await body(c, updateUserSchema);
      const user = await updateUser(c.var.deps.db, currentUser(c), idParam(c), input);
      return c.json(toMe(user));
    });
}
