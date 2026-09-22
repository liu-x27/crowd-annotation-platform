import type { MyStats, Role, UserSummary } from '@crowd/shared';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { hashPassword } from '../../auth/password';
import { destroyUserSessions } from '../../auth/sessions';
import { type Db, rows } from '../../db/client';
import { type UserRow, users } from '../../db/schema';
import { iso } from '../../lib/dto';
import { AppError, conflict, notFound } from '../../lib/errors';

export async function findUserByName(db: Db, username: string): Promise<UserRow | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .limit(1);
  return user;
}

export async function createUser(
  db: Db,
  input: { username: string; password: string; role: Role; displayName?: string | null },
): Promise<UserRow> {
  if (await findUserByName(db, input.username)) {
    throw conflict('username_taken', `The username "${input.username}" is taken.`);
  }
  const passwordHash = await hashPassword(input.password);
  try {
    const [user] = await db
      .insert(users)
      .values({
        username: input.username,
        displayName: input.displayName || null,
        passwordHash,
        role: input.role,
      })
      .returning();
    return user!;
  } catch (err) {
    // Lost a race with another insert of the same name.
    if (String(err).includes('users_username_lower_idx')) {
      throw conflict('username_taken', `The username "${input.username}" is taken.`);
    }
    throw err;
  }
}

async function activeAdminCount(db: Db, excluding?: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(
        eq(users.role, 'admin'),
        isNull(users.disabledAt),
        excluding != null ? ne(users.id, excluding) : undefined,
      ),
    );
  return row?.n ?? 0;
}

export async function updateUser(
  db: Db,
  actor: UserRow,
  userId: number,
  patch: { role?: Role; displayName?: string | null; disabled?: boolean; password?: string },
): Promise<UserRow> {
  const [target] = await db.select().from(users).where(eq(users.id, userId));
  if (!target) throw notFound('User');

  const losesAdmin =
    target.role === 'admin' &&
    !target.disabledAt &&
    ((patch.role != null && patch.role !== 'admin') || patch.disabled === true);
  if (losesAdmin && (await activeAdminCount(db, target.id)) === 0) {
    throw conflict('last_admin', 'This is the last active admin. Promote someone else first.');
  }
  if (patch.disabled && target.id === actor.id) {
    throw new AppError(400, 'self_disable', 'You cannot disable your own account.');
  }

  const set: Partial<typeof users.$inferInsert> = {};
  if (patch.role) set.role = patch.role;
  if (patch.displayName !== undefined) set.displayName = patch.displayName || null;
  if (patch.disabled !== undefined) set.disabledAt = patch.disabled ? new Date() : null;
  if (patch.password) set.passwordHash = await hashPassword(patch.password);

  const [updated] = await db.update(users).set(set).where(eq(users.id, userId)).returning();
  // A disabled account or a reset password signs the user out everywhere.
  if (patch.disabled || patch.password) await destroyUserSessions(db, userId);
  return updated!;
}

export async function listUsers(db: Db): Promise<UserSummary[]> {
  const found = await rows<{
    id: number;
    username: string;
    display_name: string | null;
    role: Role;
    disabled_at: Date | null;
    created_at: Date;
    last_seen_at: Date | null;
    submitted: number;
    last7d: number;
    projects: number;
  }>(
    db,
    sql`
      select u.id, u.username, u.display_name, u.role, u.disabled_at, u.created_at, u.last_seen_at,
             coalesce(s.submitted, 0)::int as submitted,
             coalesce(s.last7d, 0)::int as last7d,
             coalesce(s.projects, 0)::int as projects
      from users u
      left join (
        select user_id,
               count(*) filter (where status = 'submitted') as submitted,
               count(*) filter (where status = 'submitted' and submitted_at > now() - interval '7 days') as last7d,
               count(distinct project_id) as projects
        from annotations
        where source = 'human'
        group by user_id
      ) s on s.user_id = u.id
      order by u.created_at, u.id`,
  );
  return found.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    disabled: u.disabled_at != null,
    createdAt: iso(u.created_at)!,
    lastSeenAt: iso(u.last_seen_at),
    stats: { submitted: u.submitted, last7d: u.last7d, projects: u.projects },
  }));
}

export async function myStats(db: Db, userId: number, timeZone: string): Promise<MyStats> {
  const [totals] = await rows<{
    submitted: number;
    skipped: number;
    today: number;
    last7d: number;
    median_ms: number | null;
    agree: number | null;
  }>(
    db,
    sql`
      select
        count(*) filter (where a.status = 'submitted')::int as submitted,
        count(*) filter (where a.status = 'skipped')::int as skipped,
        count(*) filter (where a.status = 'submitted'
          and (a.submitted_at at time zone ${timeZone})::date = (now() at time zone ${timeZone})::date)::int as today,
        count(*) filter (where a.status = 'submitted' and a.submitted_at > now() - interval '7 days')::int as last7d,
        percentile_cont(0.5) within group (order by a.duration_ms)
          filter (where a.status = 'submitted' and a.duration_ms is not null) as median_ms,
        avg(case when i.finalized_at is null then null
                 when p.type = 'classification' then (a.label = i.final_label)::int
                 else (a.spans = i.final_spans)::int end)
          filter (where a.status = 'submitted') as agree
      from annotations a
      join items i on i.id = a.item_id
      join projects p on p.id = a.project_id
      where a.source = 'human' and a.user_id = ${userId}`,
  );
  const daily = await rows<{ day: string; submitted: number }>(
    db,
    sql`
      select to_char((submitted_at at time zone ${timeZone})::date, 'YYYY-MM-DD') as day, count(*)::int as submitted
      from annotations
      where source = 'human' and user_id = ${userId} and status = 'submitted'
        and submitted_at > now() - interval '30 days'
      group by 1 order by 1`,
  );
  return {
    submitted: totals?.submitted ?? 0,
    skipped: totals?.skipped ?? 0,
    today: totals?.today ?? 0,
    last7d: totals?.last7d ?? 0,
    medianMs: totals?.median_ms != null ? Math.round(Number(totals.median_ms)) : null,
    agreeWithFinal: totals?.agree != null ? Number(totals.agree) : null,
    daily,
  };
}
