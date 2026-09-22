import { type Capability, can, type Me, ROLE_CAPABILITIES } from '@crowd/shared';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv } from '../app';
import type { UserRow } from '../db/schema';
import { forbidden, unauthorized } from '../lib/errors';
import { resolveSession, SESSION_COOKIE } from './sessions';

export function toMe(user: UserRow): Me {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    capabilities: [...ROLE_CAPABILITIES[user.role]],
  };
}

/** Attach the signed-in user, if any. Never rejects. */
export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const user = await resolveSession(c.var.deps.db, token);
    if (user) c.set('user', user);
  }
  await next();
};

export function currentUser(c: Context<AppEnv>): UserRow {
  const user = c.var.user;
  if (!user) throw unauthorized();
  return user;
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  currentUser(c);
  await next();
};

export function requireCapability(capability: Capability): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = currentUser(c);
    if (!can(user.role, capability)) throw forbidden();
    await next();
  };
}

export function assertCan(user: UserRow, capability: Capability): void {
  if (!can(user.role, capability)) throw forbidden();
}
