import {
  type ClaimView,
  type HistoryEntry,
  type ProjectType,
  type QueueView,
  type Span,
  type SubmitAnnotationInput,
  spanSetKey,
  unitHash,
  validateSpans,
  withText,
} from '@crowd/shared';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { type Db, type DbOrTx, one, rows } from '../../db/client';
import {
  type AnnotationRow,
  annotations,
  type ItemRow,
  items,
  type ProjectRow,
  type UserRow,
  users,
} from '../../db/schema';
import { iso, spansView, userRef } from '../../lib/dto';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors';

/**
 * Items user `u` may be served in `project`, as a WHERE clause over `items i`.
 *
 * - not finalised, and fewer than `redundancy` annotators have submitted or hold a live claim
 * - not already annotated, claimed or skipped by this user
 * - inside this user's assignment ranges if they have any; otherwise outside everyone's
 */
function eligible(project: ProjectRow, userId: number) {
  const k = project.settings.redundancy;
  return sql`
    i.project_id = ${project.id}
    and i.finalized_at is null
    and i.human_count < ${k}
    and (case
      when exists (select 1 from assignments r where r.project_id = ${project.id} and r.user_id = ${userId})
        then exists (select 1 from assignments r where r.project_id = ${project.id} and r.user_id = ${userId}
                     and i.seq between r.seq_from and r.seq_to)
      else not exists (select 1 from assignments r where r.project_id = ${project.id}
                       and i.seq between r.seq_from and r.seq_to)
    end)
    and not exists (select 1 from annotations a where a.item_id = i.id and a.source = 'human' and a.user_id = ${userId})
    and (select count(*) from annotations a
         where a.item_id = i.id and a.source = 'human'
           and (a.status = 'submitted' or (a.status = 'claimed' and a.lease_expires_at > now()))) < ${k}`;
}

export async function availableCount(
  db: DbOrTx,
  project: ProjectRow,
  userId: number,
): Promise<number> {
  const row = await one<{ n: number }>(
    db,
    sql`select count(*)::int as n from items i where ${eligible(project, userId)}`,
  );
  return row?.n ?? 0;
}

async function submittedCount(db: DbOrTx, projectId: number, userId: number): Promise<number> {
  const row = await one<{ n: number }>(
    db,
    sql`select count(*)::int as n from annotations
        where project_id = ${projectId} and source = 'human' and user_id = ${userId} and status = 'submitted'`,
  );
  return row?.n ?? 0;
}

/**
 * Whether the draft is on screen for this (item, annotator) pair. Deterministic, so a
 * reload shows the same thing, and recorded on the annotation so agreement with the draft
 * can later be split by it.
 */
function draftDecision(project: ProjectRow, itemId: number, userId: number): boolean {
  const { draftMode, blindRate } = project.settings;
  if (draftMode === 'hidden') return false;
  if (blindRate > 0 && unitHash(`blind:${project.id}:${itemId}:${userId}`) < blindRate)
    return false;
  return true;
}

async function draftFor(db: DbOrTx, itemId: number): Promise<AnnotationRow | undefined> {
  const [draft] = await db
    .select()
    .from(annotations)
    .where(
      and(
        eq(annotations.itemId, itemId),
        eq(annotations.source, 'llm'),
        eq(annotations.status, 'submitted'),
      ),
    )
    .limit(1);
  return draft;
}

async function claimView(
  db: DbOrTx,
  project: ProjectRow,
  ann: AnnotationRow,
  item: ItemRow,
): Promise<ClaimView> {
  let draft: ClaimView['draft'] = null;
  if (ann.draftShown) {
    const d = await draftFor(db, item.id);
    if (d) {
      draft = {
        label: d.label,
        spans: project.type === 'ner' ? withText(item.text, d.spans ?? []) : null,
        model: d.model,
      };
    }
  }
  let returned: ClaimView['returned'] = null;
  if (ann.status === 'claimed' && ann.reviewNote != null && ann.submittedAt != null) {
    const reviewer =
      ann.reviewedBy != null
        ? (await db.select().from(users).where(eq(users.id, ann.reviewedBy)))[0]
        : undefined;
    returned = { note: ann.reviewNote, reviewer: userRef(reviewer) };
  }
  const hasAnswer = ann.label != null || ann.spans != null;
  return {
    annotationId: ann.id,
    item: { id: item.id, seq: item.seq, text: item.text, meta: item.meta },
    draft,
    current: hasAnswer
      ? {
          label: ann.label,
          spans: project.type === 'ner' ? withText(item.text, ann.spans ?? []) : [],
          flagged: ann.flagged,
          note: ann.note,
        }
      : null,
    returned,
    leaseExpiresAt: iso(ann.leaseExpiresAt)!,
  };
}

const leaseInterval = (project: ProjectRow) =>
  sql`now() + make_interval(mins => ${project.settings.leaseMinutes}::int)`;

/**
 * Serve the next item. In order of preference: the user's own open claim, work a reviewer
 * returned to them, then a fresh item. A fresh item is claimed in one statement with
 * `FOR UPDATE SKIP LOCKED`, so two annotators asking at the same moment get different items.
 */
export async function claimNext(
  db: Db,
  project: ProjectRow,
  user: UserRow,
): Promise<ClaimView | null> {
  if (project.archivedAt) return null;
  return db.transaction(async (tx) => {
    // One claim decision at a time per (project, user): two tabs cannot open two claims.
    await tx.execute(sql`select pg_advisory_xact_lock(${project.id}::int, ${user.id}::int)`);

    // 1. An open claim: resume it, unless the item has moved on without this user.
    const open = await tx
      .select({ a: annotations, i: items })
      .from(annotations)
      .innerJoin(items, eq(items.id, annotations.itemId))
      .where(
        and(
          eq(annotations.projectId, project.id),
          eq(annotations.userId, user.id),
          eq(annotations.source, 'human'),
          eq(annotations.status, 'claimed'),
        ),
      )
      .orderBy(annotations.id);
    for (const { a, i } of open) {
      const stale =
        i.finalizedAt != null ||
        (a.leaseExpiresAt != null &&
          a.leaseExpiresAt.getTime() < Date.now() &&
          (await othersHolding(tx, i.id, user.id)) >= project.settings.redundancy);
      if (stale) {
        await releaseRow(tx, a);
        continue;
      }
      const [renewed] = await tx
        .update(annotations)
        .set({ leaseExpiresAt: leaseInterval(project), updatedAt: new Date() })
        .where(eq(annotations.id, a.id))
        .returning();
      return claimView(tx, project, renewed!, i);
    }

    // 2. Returned work.
    const [returned] = await tx
      .select({ a: annotations, i: items })
      .from(annotations)
      .innerJoin(items, eq(items.id, annotations.itemId))
      .where(
        and(
          eq(annotations.projectId, project.id),
          eq(annotations.userId, user.id),
          eq(annotations.source, 'human'),
          eq(annotations.status, 'rejected'),
          sql`${items.finalizedAt} is null`,
        ),
      )
      .orderBy(annotations.reviewedAt)
      .limit(1);
    if (returned) {
      const [reopened] = await tx
        .update(annotations)
        .set({ status: 'claimed', leaseExpiresAt: leaseInterval(project), updatedAt: new Date() })
        .where(eq(annotations.id, returned.a.id))
        .returning();
      return claimView(tx, project, reopened!, returned.i);
    }

    // 3. A fresh item.
    const claimed = await rows<{ id: number; item_id: number }>(
      tx,
      sql`
        with candidate as (
          select i.id from items i
          where ${eligible(project, user.id)}
          order by i.seq
          limit 1
          for update of i skip locked
        )
        insert into annotations (project_id, item_id, source, user_id, status, lease_expires_at)
        select ${project.id}, id, 'human', ${user.id}, 'claimed', ${leaseInterval(project)} from candidate
        on conflict (item_id, user_id) where source = 'human' do nothing
        returning id, item_id`,
    );
    const hit = claimed[0];
    if (!hit) return null;
    const draft = await draftFor(tx, hit.item_id);
    const [ann] = await tx
      .update(annotations)
      .set({ draftShown: draft ? draftDecision(project, hit.item_id, user.id) : null })
      .where(eq(annotations.id, hit.id))
      .returning();
    const [item] = await tx.select().from(items).where(eq(items.id, hit.item_id));
    return claimView(tx, project, ann!, item!);
  });
}

async function othersHolding(db: DbOrTx, itemId: number, userId: number): Promise<number> {
  const row = await one<{ n: number }>(
    db,
    sql`select count(*)::int as n from annotations
        where item_id = ${itemId} and source = 'human' and user_id <> ${userId}
          and (status = 'submitted' or (status = 'claimed' and lease_expires_at > now()))`,
  );
  return row?.n ?? 0;
}

/** Give a claim back. Returned work goes back to `rejected` so it stays in the user's queue. */
async function releaseRow(db: DbOrTx, a: AnnotationRow): Promise<void> {
  if (a.reviewNote != null && a.submittedAt != null) {
    await db
      .update(annotations)
      .set({ status: 'rejected', leaseExpiresAt: null, updatedAt: new Date() })
      .where(eq(annotations.id, a.id));
  } else {
    await db.delete(annotations).where(eq(annotations.id, a.id));
  }
}

export async function queueView(db: Db, project: ProjectRow, user: UserRow): Promise<QueueView> {
  const claim = await claimNext(db, project, user);
  const [remaining, submitted] = await Promise.all([
    availableCount(db, project, user.id),
    submittedCount(db, project.id, user.id),
  ]);
  return { claim, remaining, submitted };
}

/** Check an answer against the project and item. NER spans come back without `text`. */
export function validateAnswer(
  type: ProjectType,
  labelNames: string[],
  text: string,
  input: { label?: string; spans?: Span[] },
): { label: string | null; spans: Span[] | null } {
  if (type === 'classification') {
    if (!input.label) throw badRequest('A label is required.');
    if (!labelNames.includes(input.label)) throw badRequest(`Unknown label "${input.label}".`);
    return { label: input.label, spans: null };
  }
  if (!input.spans) throw badRequest('Spans are required (send an empty list for "no entities").');
  const check = validateSpans(text, input.spans, labelNames);
  if (!check.ok) throw new AppError(400, 'invalid_spans', check.error);
  return {
    label: null,
    spans: check.spans.map(({ start, end, label }) => ({ start, end, label })),
  };
}

/**
 * Finalise an item automatically if the project allows it, enough annotators have
 * submitted, all of them agree, and nobody flagged it.
 */
export async function maybeAutoFinalize(
  tx: DbOrTx,
  project: ProjectRow,
  itemId: number,
): Promise<boolean> {
  if (project.settings.autoFinalize !== 'unanimous') return false;
  const subs = await tx
    .select({ label: annotations.label, spans: annotations.spans, flagged: annotations.flagged })
    .from(annotations)
    .where(
      and(
        eq(annotations.itemId, itemId),
        eq(annotations.source, 'human'),
        eq(annotations.status, 'submitted'),
      ),
    );
  if (subs.length < project.settings.redundancy || subs.some((s) => s.flagged)) return false;
  const keys = new Set(
    subs.map((s) => (project.type === 'ner' ? spanSetKey(s.spans ?? []) : String(s.label))),
  );
  if (keys.size !== 1) return false;
  const first = subs[0]!;
  const done = await tx
    .update(items)
    .set({
      finalLabel: project.type === 'classification' ? first.label : null,
      finalSpans: project.type === 'ner' ? (first.spans ?? []) : null,
      finalSource: 'consensus',
      finalizedAt: new Date(),
      finalizedBy: null,
    })
    .where(and(eq(items.id, itemId), sql`${items.finalizedAt} is null`))
    .returning({ id: items.id });
  if (done.length) await dropOpenClaims(tx, itemId);
  return done.length > 0;
}

/** Once an item is final, open claims on it are moot. Returned work is left for the record. */
export async function dropOpenClaims(tx: DbOrTx, itemId: number): Promise<void> {
  await tx
    .delete(annotations)
    .where(
      and(
        eq(annotations.itemId, itemId),
        eq(annotations.source, 'human'),
        eq(annotations.status, 'claimed'),
        sql`${annotations.submittedAt} is null`,
      ),
    );
}

async function ownAnnotation(tx: DbOrTx, annotationId: number, user: UserRow) {
  const [row] = await tx
    .select({ a: annotations, i: items })
    .from(annotations)
    .innerJoin(items, eq(items.id, annotations.itemId))
    .where(eq(annotations.id, annotationId))
    .for('update');
  if (!row) throw notFound('Annotation');
  if (row.a.source !== 'human' || row.a.userId !== user.id)
    throw forbidden('That annotation is not yours.');
  return row;
}

export async function submitAnnotation(
  db: Db,
  project: ProjectRow,
  user: UserRow,
  annotationId: number,
  input: SubmitAnnotationInput,
): Promise<{ finalized: boolean }> {
  return db.transaction(async (tx) => {
    const { a, i } = await ownAnnotation(tx, annotationId, user);
    if (a.projectId !== project.id) throw notFound('Annotation');
    if (a.status === 'submitted')
      throw conflict('already_submitted', 'Already submitted. Edit it from your history instead.');
    if (a.status !== 'claimed')
      throw conflict('not_claimed', 'This item is no longer claimed by you.');
    if (i.finalizedAt) {
      await releaseRow(tx, a);
      throw conflict(
        'item_finalized',
        'A reviewer finalised this item while you were working on it.',
      );
    }
    const answer = validateAnswer(
      project.type,
      project.labels.map((l) => l.name),
      i.text,
      input,
    );
    await tx
      .update(annotations)
      .set({
        status: 'submitted',
        label: answer.label,
        spans: answer.spans,
        flagged: input.flagged ?? false,
        note: input.note?.trim() || null,
        durationMs: input.durationMs ?? null,
        submittedAt: new Date(),
        updatedAt: new Date(),
        leaseExpiresAt: null,
      })
      .where(eq(annotations.id, a.id));
    await tx
      .update(items)
      .set({ humanCount: sql`${items.humanCount} + 1` })
      .where(eq(items.id, i.id));
    return { finalized: await maybeAutoFinalize(tx, project, i.id) };
  });
}

/** Change a submitted answer, while the item is still open. */
export async function editAnnotation(
  db: Db,
  project: ProjectRow,
  user: UserRow,
  annotationId: number,
  input: SubmitAnnotationInput,
): Promise<{ finalized: boolean }> {
  return db.transaction(async (tx) => {
    const { a, i } = await ownAnnotation(tx, annotationId, user);
    if (a.projectId !== project.id) throw notFound('Annotation');
    if (a.status !== 'submitted')
      throw conflict('not_submitted', 'Only submitted answers can be edited.');
    if (i.finalizedAt)
      throw conflict('item_finalized', 'This item is final. Ask a reviewer to reopen it.');
    const answer = validateAnswer(
      project.type,
      project.labels.map((l) => l.name),
      i.text,
      input,
    );
    await tx
      .update(annotations)
      .set({
        label: answer.label,
        spans: answer.spans,
        flagged: input.flagged ?? a.flagged,
        note: input.note !== undefined ? input.note.trim() || null : a.note,
        updatedAt: new Date(),
      })
      .where(eq(annotations.id, a.id));
    return { finalized: await maybeAutoFinalize(tx, project, i.id) };
  });
}

export async function skipAnnotation(
  db: Db,
  project: ProjectRow,
  user: UserRow,
  annotationId: number,
  reason?: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const { a } = await ownAnnotation(tx, annotationId, user);
    if (a.projectId !== project.id) throw notFound('Annotation');
    if (a.status !== 'claimed')
      throw conflict('not_claimed', 'This item is no longer claimed by you.');
    if (a.reviewNote != null && a.submittedAt != null) {
      throw conflict(
        'returned_work',
        'A reviewer returned this item to you; fix and resubmit it instead of skipping.',
      );
    }
    await tx
      .update(annotations)
      .set({
        status: 'skipped',
        note: reason?.trim() || null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(annotations.id, a.id));
  });
}

/** Take back a skipped item. */
export async function reclaimAnnotation(
  db: Db,
  project: ProjectRow,
  user: UserRow,
  annotationId: number,
): Promise<ClaimView> {
  return db.transaction(async (tx) => {
    const { a, i } = await ownAnnotation(tx, annotationId, user);
    if (a.projectId !== project.id) throw notFound('Annotation');
    if (a.status !== 'skipped')
      throw conflict('not_skipped', 'Only skipped items can be taken back.');
    if (i.finalizedAt) throw conflict('item_finalized', 'This item has been finalised meanwhile.');
    const [ann] = await tx
      .update(annotations)
      .set({ status: 'claimed', leaseExpiresAt: leaseInterval(project), updatedAt: new Date() })
      .where(eq(annotations.id, a.id))
      .returning();
    return claimView(tx, project, ann!, i);
  });
}

export async function releaseAnnotation(
  db: Db,
  user: UserRow,
  annotationId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const { a } = await ownAnnotation(tx, annotationId, user);
    if (a.status === 'claimed') await releaseRow(tx, a);
  });
}

export async function history(
  db: Db,
  project: ProjectRow,
  user: UserRow,
  opts: { limit: number; before?: number },
): Promise<HistoryEntry[]> {
  const found = await db
    .select({ a: annotations, i: items })
    .from(annotations)
    .innerJoin(items, eq(items.id, annotations.itemId))
    .where(
      and(
        eq(annotations.projectId, project.id),
        eq(annotations.userId, user.id),
        eq(annotations.source, 'human'),
        inArray(annotations.status, ['submitted', 'skipped', 'rejected']),
        opts.before ? lt(annotations.id, opts.before) : undefined,
      ),
    )
    .orderBy(desc(annotations.updatedAt), desc(annotations.id))
    .limit(opts.limit);
  return found.map(({ a, i }) => ({
    annotationId: a.id,
    itemId: i.id,
    seq: i.seq,
    text: i.text,
    status: a.status as HistoryEntry['status'],
    label: a.label,
    spans: spansView(i.text, a.spans),
    submittedAt: iso(a.submittedAt),
    updatedAt: iso(a.updatedAt)!,
    final: i.finalizedAt
      ? { label: i.finalLabel, spans: spansView(i.text, i.finalSpans), source: i.finalSource! }
      : null,
  }));
}
