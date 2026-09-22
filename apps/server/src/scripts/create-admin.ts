/**
 * Create an admin, or with --reset turn an existing account back into an enabled admin
 * with a new password. For recovery when nobody can sign in.
 *
 *   npm run create-admin -- --username alice --password '…' [--reset]
 */
import { parseArgs } from 'node:util';
import { passwordSchema, usernameSchema } from '@crowd/shared';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../auth/password';
import { destroyUserSessions } from '../auth/sessions';
import { loadConfig } from '../config';
import { openDatabase } from '../db/client';
import { users } from '../db/schema';
import { createUser, findUserByName } from '../modules/accounts/service';

const { values } = parseArgs({
  options: {
    username: { type: 'string' },
    password: { type: 'string' },
    reset: { type: 'boolean', default: false },
  },
});

async function main() {
  const username = usernameSchema.parse(values.username ?? '');
  const password = passwordSchema.parse(values.password ?? process.env.ADMIN_PASSWORD ?? '');
  const { db, close } = await openDatabase(loadConfig());
  try {
    const existing = await findUserByName(db, username);
    if (existing && !values.reset)
      throw new Error(`"${username}" exists. Pass --reset to make it an admin with this password.`);
    if (existing) {
      await db
        .update(users)
        .set({ role: 'admin', disabledAt: null, passwordHash: await hashPassword(password) })
        .where(eq(users.id, existing.id));
      await destroyUserSessions(db, existing.id);
      console.log(`Reset "${username}": admin, enabled, new password, signed out everywhere.`);
    } else {
      await createUser(db, { username, password, role: 'admin' });
      console.log(`Created admin "${username}".`);
    }
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
