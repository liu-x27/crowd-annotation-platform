import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessions, type UserRow, users } from '../db/schema';

export const SESSION_COOKIE = 'cap_session';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(
  db: Db,
  userId: number,
  ttlMs: number,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.insert(sessions).values({
    id: hashToken(token),
    userId,
    expiresAt,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    ip: meta.ip ?? null,
  });
  return { token, expiresAt };
}

/**
 * Resolve a cookie token to its user. The user row is read on every request, so a role
 * change, a disabled account or a deleted session takes effect immediately — there is no
 * signed token that stays valid until it expires.
 */
export async function resolveSession(db: Db, token: string): Promise<UserRow | null> {
  const id = hashToken(token);
  const now = new Date();
  const [row] = await db
    .select({ user: users, lastUsedAt: sessions.lastUsedAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row || row.user.disabledAt) return null;
  // Touch at most once a minute so reads do not turn into a write per request.
  if (now.getTime() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastUsedAt: now }).where(eq(sessions.id, id));
    await db.update(users).set({ lastSeenAt: now }).where(eq(users.id, row.user.id));
  }
  return row.user;
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

/** Sign a user out everywhere, optionally keeping the session making the request. */
export async function destroyUserSessions(
  db: Db,
  userId: number,
  exceptToken?: string,
): Promise<void> {
  await db
    .delete(sessions)
    .where(
      exceptToken
        ? and(eq(sessions.userId, userId), ne(sessions.id, hashToken(exceptToken)))
        : eq(sessions.userId, userId),
    );
}

export async function purgeExpiredSessions(db: Db): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
