import {
  type AssignmentsView,
  type CreateProjectInput,
  can,
  createProjectSchema,
  type LabelDef,
  type ProjectCounts,
  type ProjectListEntry,
  type ProjectSettings,
  type UpdateProjectInput,
} from '@crowd/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import { type Db, type DbOrTx, rows } from '../../db/client';
import { assignments, type ProjectRow, projects, type UserRow, users } from '../../db/schema';
import { projectDto, userRef } from '../../lib/dto';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { availableCount } from '../annotate/queue';

export async function getProject(db: DbOrTx, id: number): Promise<ProjectRow> {
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) throw notFound('Project');
  return project;
}

/** The item-state breakdown that every progress bar in the UI is drawn from. */
export async function projectCounts(db: Db, ids: number[]): Promise<Map<number, ProjectCounts>> {
  const out = new Map<number, ProjectCounts>();
  if (ids.length === 0) return out;
  const found = await rows<{
    id: number;
    items: number;
    unlabeled: number;
    in_progress: number;
    needs_review: number;
    finalized: number;
  }>(
    db,
    sql`
      select p.id,
        count(i.id)::int as items,
        count(i.id) filter (where i.finalized_at is null and i.human_count = 0)::int as unlabeled,
        count(i.id) filter (where i.finalized_at is null and i.human_count > 0
          and i.human_count < (p.settings->>'redundancy')::int)::int as in_progress,
        count(i.id) filter (where i.finalized_at is null
          and i.human_count >= (p.settings->>'redundancy')::int)::int as needs_review,
        count(i.id) filter (where i.finalized_at is not null)::int as finalized
      from projects p
      left join items i on i.project_id = p.id
      where p.id in ${sql.raw(`(${ids.map(Number).join(',')})`)}
      group by p.id`,
  );
  for (const r of found) {
    out.set(r.id, {
      items: r.items,
      unlabeled: r.unlabeled,
      inProgress: r.in_progress,
      needsReview: r.needs_review,
      finalized: r.finalized,
    });
  }
  return out;
}

export async function listProjects(db: Db, user: UserRow): Promise<ProjectListEntry[]> {
  const seeAll = can(user.role, 'project:read_all');
  const found = await db
    .select()
    .from(projects)
    .where(seeAll ? undefined : sql`${projects.archivedAt} is null`)
    .orderBy(sql`${projects.archivedAt} is not null`, sql`${projects.createdAt} desc`);
  const ids = found.map((p) => p.id);
  const counts = await projectCounts(db, ids);

  const mine = new Map<number, { submitted: number; returned: number }>();
  const restricted = new Map<number, boolean>();
  if (ids.length > 0) {
    const mineRows = await rows<{ project_id: number; submitted: number; returned: number }>(
      db,
      sql`
        select project_id,
          count(*) filter (where status = 'submitted')::int as submitted,
          count(*) filter (where status = 'rejected')::int as returned
        from annotations
        where source = 'human' and user_id = ${user.id}
        group by project_id`,
    );
    for (const r of mineRows)
      mine.set(r.project_id, { submitted: r.submitted, returned: r.returned });
    const ranges = await rows<{ project_id: number; mine: boolean }>(
      db,
      sql`select project_id, bool_or(user_id = ${user.id}) as mine from assignments group by project_id`,
    );
    for (const r of ranges) restricted.set(r.project_id, !r.mine);
  }

  const entries: ProjectListEntry[] = [];
  for (const p of found) {
    entries.push({
      ...projectDto(p),
      counts: counts.get(p.id) ?? {
        items: 0,
        unlabeled: 0,
        inProgress: 0,
        needsReview: 0,
        finalized: 0,
      },
      mine: {
        submitted: mine.get(p.id)?.submitted ?? 0,
        returned: mine.get(p.id)?.returned ?? 0,
        available: p.archivedAt ? 0 : await availableCount(db, p, user.id),
        restricted: restricted.get(p.id) ?? false,
      },
    });
  }
  return entries;
}

export async function createProject(
  db: Db,
  input: CreateProjectInput,
  userId: number,
): Promise<ProjectRow> {
  const parsed = createProjectSchema.parse(input);
  const [project] = await db
    .insert(projects)
    .values({
      name: parsed.name,
      description: parsed.description,
      type: parsed.type,
      labels: parsed.labels as LabelDef[],
      guidelines: parsed.guidelines,
      settings: parsed.settings as ProjectSettings,
      createdBy: userId,
    })
    .returning();
  return project!;
}

async function labelUsage(db: DbOrTx, projectId: number, label: string): Promise<number> {
  const pattern = JSON.stringify([{ label }]);
  const [row] = await rows<{ n: number }>(
    db,
    sql`
      select (
        (select count(*) from annotations where project_id = ${projectId}
           and (label = ${label} or spans @> ${pattern}::jsonb))
        + (select count(*) from items where project_id = ${projectId}
           and (final_label = ${label} or final_spans @> ${pattern}::jsonb))
      )::int as n`,
  );
  return row?.n ?? 0;
}

async function renameLabel(tx: DbOrTx, projectId: number, from: string, to: string): Promise<void> {
  const pattern = JSON.stringify([{ label: from }]);
  const relabelSpans = (column: 'spans' | 'final_spans') => sql`
    ${sql.raw(column)} = (
      select coalesce(jsonb_agg(
        case when s->>'label' = ${from} then jsonb_set(s, '{label}', to_jsonb(${to}::text)) else s end
        order by ord), '[]'::jsonb)
      from jsonb_array_elements(${sql.raw(column)}) with ordinality as t(s, ord))`;
  await tx.execute(
    sql`update annotations set label = ${to} where project_id = ${projectId} and label = ${from}`,
  );
  await tx.execute(
    sql`update annotations set ${relabelSpans('spans')} where project_id = ${projectId} and spans @> ${pattern}::jsonb`,
  );
  await tx.execute(
    sql`update items set final_label = ${to} where project_id = ${projectId} and final_label = ${from}`,
  );
  await tx.execute(
    sql`update items set ${relabelSpans('final_spans')} where project_id = ${projectId} and final_spans @> ${pattern}::jsonb`,
  );
}

export async function updateProject(
  db: Db,
  projectId: number,
  patch: UpdateProjectInput,
): Promise<ProjectRow> {
  const project = await getProject(db, projectId);

  return db.transaction(async (tx) => {
    const set: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.guidelines !== undefined) set.guidelines = patch.guidelines;
    if (patch.settings !== undefined) set.settings = patch.settings as ProjectSettings;
    if (patch.archived !== undefined) set.archivedAt = patch.archived ? new Date() : null;

    if (patch.labels) {
      const next = patch.labels as LabelDef[];
      const nextNames = new Set(next.map((l) => l.name));
      const renames = patch.labelRenames ?? {};
      const oldNames = new Set(project.labels.map((l) => l.name));
      for (const [from, to] of Object.entries(renames)) {
        if (!oldNames.has(from)) throw badRequest(`Cannot rename "${from}": no such label.`);
        if (!nextNames.has(to))
          throw badRequest(`Rename target "${to}" is not in the new label list.`);
      }
      for (const old of oldNames) {
        if (nextNames.has(old) || renames[old]) continue;
        const used = await labelUsage(tx, projectId, old);
        if (used > 0) {
          throw conflict(
            'label_in_use',
            `"${old}" is used by ${used} labels and cannot be removed. Rename it instead.`,
            {
              label: old,
              used,
            },
          );
        }
      }
      for (const [from, to] of Object.entries(renames)) {
        if (from !== to) await renameLabel(tx, projectId, from, to);
      }
      set.labels = next;
    } else if (patch.labelRenames && Object.keys(patch.labelRenames).length > 0) {
      throw badRequest('labelRenames must be sent together with the new labels.');
    }

    const [updated] = await tx
      .update(projects)
      .set(set)
      .where(eq(projects.id, projectId))
      .returning();
    return updated!;
  });
}

export async function deleteProject(db: Db, projectId: number): Promise<void> {
  await getProject(db, projectId);
  await db.delete(projects).where(eq(projects.id, projectId));
}

export async function getAssignments(db: Db, projectId: number): Promise<AssignmentsView> {
  await getProject(db, projectId);
  const found = await db
    .select({ a: assignments, u: users })
    .from(assignments)
    .innerJoin(users, eq(users.id, assignments.userId))
    .where(eq(assignments.projectId, projectId))
    .orderBy(assignments.seqFrom, assignments.userId);
  const [max] = await rows<{ max: number | null }>(
    db,
    sql`select max(seq)::int as max from items where project_id = ${projectId}`,
  );
  return {
    ranges: found.map(({ a, u }) => ({
      userId: a.userId,
      seqFrom: a.seqFrom,
      seqTo: a.seqTo,
      user: userRef(u)!,
    })),
    maxSeq: max?.max ?? 0,
  };
}

/** Replace a project's assignment ranges wholesale. What the admin sees is exactly what is stored. */
export async function setAssignments(
  db: Db,
  projectId: number,
  ranges: { userId: number; seqFrom: number; seqTo: number }[],
): Promise<AssignmentsView> {
  const current = await getAssignments(db, projectId);
  const userIds = [...new Set(ranges.map((r) => r.userId))];
  if (userIds.length > 0) {
    const known = await db.select({ id: users.id }).from(users).where(inArray(users.id, userIds));
    const missing = userIds.filter((id) => !known.some((k) => k.id === id));
    if (missing.length) throw badRequest(`Unknown user ids: ${missing.join(', ')}`);
  }
  for (const r of ranges) {
    if (r.seqTo > current.maxSeq) {
      throw new AppError(
        400,
        'range_out_of_bounds',
        `Range ${r.seqFrom}–${r.seqTo} ends past the last item (${current.maxSeq}).`,
      );
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(assignments).where(eq(assignments.projectId, projectId));
    if (ranges.length)
      await tx.insert(assignments).values(ranges.map((r) => ({ ...r, projectId })));
  });
  return getAssignments(db, projectId);
}
