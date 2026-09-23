import {
  answerKey,
  type FinalizeInput,
  type Majority,
  type ReviewEntry,
  type ReviewQueue,
  tally,
  withText,
} from '@crowd/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { type Db, type DbOrTx, rows } from '../../db/client';
import {
  type AnnotationRow,
  annotations,
  type ItemRow,
  items,
  type ProjectRow,
  type UserRow,
  users,
} from '../../db/schema';
import { answerSql, finalizeOpenItem } from '../../lib/answers';
import { annotationView, finalView } from '../../lib/dto';
import { conflict, notFound } from '../../lib/errors';
import { validateAnswer } from '../annotate/queue';

type Filter = 'all' | 'disagreement' | 'flagged' | 'draft_overridden';

export function majorityOf(
  project: ProjectRow,
  text: string,
  submitted: Pick<AnnotationRow, 'label' | 'spans'>[],
): Majority | null {
  const t = tally(project.type, submitted);
  if (!t) return null;
  return {
    label: t.top.label,
    spans: project.type === 'ner' ? withText(text, t.top.spans ?? []) : null,
    votes: t.votes,
    total: t.total,
    tie: t.tie,
  };
}

/**
 * The per-item facts every review filter is built from. Computed in SQL so the queue can
 * be filtered, counted and paged in the database; `reviewEntries` recomputes the same
 * three facts in JS, from the same definition of a same answer, for the page shown.
 */
const candidates = (project: ProjectRow) => sql`
  select i.id, i.seq, i.human_count,
    (select count(distinct ${answerSql('a')}) from annotations a
       where a.item_id = i.id and a.source = 'human' and a.status = 'submitted') as distinct_answers,
    exists(select 1 from annotations a
       where a.item_id = i.id and a.source = 'human' and a.status = 'submitted' and a.flagged) as flagged,
    exists(select 1 from annotations a
       join annotations d on d.item_id = a.item_id and d.source = 'llm' and d.status = 'submitted'
       where a.item_id = i.id and a.source = 'human' and a.status = 'submitted'
         and ${answerSql('a')} <> ${answerSql('d')}
    ) as overridden
  from items i
  where i.project_id = ${project.id} and i.finalized_at is null and i.human_count > 0`;

const inQueue = (project: ProjectRow) =>
  sql`(c.human_count >= ${project.settings.redundancy} or c.flagged)`;

const filterSql = (filter: Filter) => {
  switch (filter) {
    case 'disagreement':
      return sql`and c.distinct_answers > 1`;
    case 'flagged':
      return sql`and c.flagged`;
    case 'draft_overridden':
      return sql`and c.overridden`;
    default:
      return sql``;
  }
};

export async function reviewQueue(
  db: Db,
  project: ProjectRow,
  opts: { filter: Filter; limit: number; offset: number },
): Promise<ReviewQueue> {
  const [counts] = await rows<{
    all: number;
    disagreement: number;
    flagged: number;
    overridden: number;
  }>(
    db,
    sql`
      with c as (${candidates(project)})
      select count(*) filter (where ${inQueue(project)})::int as all,
             count(*) filter (where ${inQueue(project)} and c.distinct_answers > 1)::int as disagreement,
             count(*) filter (where c.flagged)::int as flagged,
             count(*) filter (where ${inQueue(project)} and c.overridden)::int as overridden
      from c`,
  );
  const page = await rows<{ id: number }>(
    db,
    sql`
      with c as (${candidates(project)})
      select c.id from c
      where ${opts.filter === 'flagged' ? sql`true` : inQueue(project)} ${filterSql(opts.filter)}
      order by (c.distinct_answers > 1) desc, c.flagged desc, c.seq
      limit ${opts.limit} offset ${opts.offset}`,
  );
  const total =
    opts.filter === 'disagreement'
      ? (counts?.disagreement ?? 0)
      : opts.filter === 'flagged'
        ? (counts?.flagged ?? 0)
        : opts.filter === 'draft_overridden'
          ? (counts?.overridden ?? 0)
          : (counts?.all ?? 0);

  const entries = await reviewEntries(
    db,
    project,
    page.map((p) => p.id),
  );
  return {
    entries,
    total,
    counts: {
      all: counts?.all ?? 0,
      disagreement: counts?.disagreement ?? 0,
      flagged: counts?.flagged ?? 0,
      draftOverridden: counts?.overridden ?? 0,
    },
  };
}

/** Everything a reviewer needs about a set of items, in the order given. */
export async function reviewEntries(
  db: Db,
  project: ProjectRow,
  itemIds: number[],
): Promise<ReviewEntry[]> {
  if (itemIds.length === 0) return [];
  const itemRows = await db.select().from(items).where(inArray(items.id, itemIds));
  const anns = await db
    .select()
    .from(annotations)
    .where(
      and(
        inArray(annotations.itemId, itemIds),
        inArray(annotations.status, ['submitted', 'rejected', 'error']),
      ),
    );
  const userIds = new Set<number>();
  for (const a of anns) {
    if (a.userId != null) userIds.add(a.userId);
  }
  for (const i of itemRows) {
    if (i.finalizedBy != null) userIds.add(i.finalizedBy);
  }
  const userMap = new Map<number, UserRow>();
  if (userIds.size) {
    for (const u of await db
      .select()
      .from(users)
      .where(inArray(users.id, [...userIds])))
      userMap.set(u.id, u);
  }
  const byItem = new Map<number, AnnotationRow[]>();
  for (const a of anns) byItem.set(a.itemId, [...(byItem.get(a.itemId) ?? []), a]);
  const itemById = new Map<number, ItemRow>(itemRows.map((i) => [i.id, i]));

  return itemIds
    .map((id) => itemById.get(id))
    .filter((i): i is ItemRow => !!i)
    .map((i) => {
      const list = byItem.get(i.id) ?? [];
      const human = list.filter((a) => a.source === 'human').sort((a, b) => a.id - b.id);
      const submitted = human.filter((a) => a.status === 'submitted');
      const draft = list.find((a) => a.source === 'llm');
      const imported = list.find((a) => a.source === 'import');
      const majority = majorityOf(project, i.text, submitted);
      const draftKey = draft?.status === 'submitted' ? answerKey(project.type, draft) : null;
      return {
        item: { id: i.id, seq: i.seq, text: i.text, meta: i.meta },
        human: human.map((a) => annotationView(a, i.text, userMap)),
        draft: draft ? annotationView(draft, i.text, userMap, { includeRaw: true }) : null,
        imported: imported ? annotationView(imported, i.text, userMap) : null,
        final: finalView(i, userMap),
        majority,
        disagreement: new Set(submitted.map((a) => answerKey(project.type, a))).size > 1,
        flagged: submitted.some((a) => a.flagged),
        draftOverridden:
          draftKey != null && submitted.some((a) => answerKey(project.type, a) !== draftKey),
      };
    });
}

async function lockedItem(tx: DbOrTx, project: ProjectRow, itemId: number): Promise<ItemRow> {
  const [item] = await tx.select().from(items).where(eq(items.id, itemId)).for('update');
  if (!item || item.projectId !== project.id) throw notFound('Item');
  return item;
}

export async function finalizeItem(
  db: Db,
  project: ProjectRow,
  reviewer: UserRow,
  itemId: number,
  input: FinalizeInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const item = await lockedItem(tx, project, itemId);
    // Rather than overwrite: a second reviewer deciding the same item should learn that
    // someone already has, not silently replace their answer.
    if (item.finalizedAt) {
      throw conflict(
        'item_finalized',
        'This item is already final. Reopen it to change the answer.',
      );
    }
    const answer = validateAnswer(
      project.type,
      project.labels.map((l) => l.name),
      item.text,
      input,
    );
    await finalizeOpenItem(tx, project.type, item.id, answer, 'review', reviewer.id);
  });
}

export async function reopenItem(db: Db, project: ProjectRow, itemId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const item = await lockedItem(tx, project, itemId);
    if (!item.finalizedAt) return;
    await tx
      .update(items)
      .set({
        finalLabel: null,
        finalSpans: null,
        finalSource: null,
        finalizedBy: null,
        finalizedAt: null,
      })
      .where(eq(items.id, item.id));
  });
}

/** Send one annotator's answer back to them with a note. It reappears first in their queue. */
export async function rejectAnnotation(
  db: Db,
  project: ProjectRow,
  reviewer: UserRow,
  annotationId: number,
  note: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [ann] = await tx
      .select()
      .from(annotations)
      .where(eq(annotations.id, annotationId))
      .for('update');
    if (!ann || ann.projectId !== project.id) throw notFound('Annotation');
    if (ann.source !== 'human' || ann.status !== 'submitted') {
      throw conflict('not_rejectable', 'Only submitted human answers can be returned.');
    }
    const item = await lockedItem(tx, project, ann.itemId);
    if (item.finalizedAt)
      throw conflict('item_finalized', 'Reopen the item before returning answers on it.');
    await tx
      .update(annotations)
      .set({
        status: 'rejected',
        reviewNote: note,
        reviewedBy: reviewer.id,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(annotations.id, ann.id));
    await tx
      .update(items)
      .set({ humanCount: sql`greatest(${items.humanCount} - 1, 0)` })
      .where(eq(items.id, item.id));
  });
}

export async function bulkFinalize(
  db: Db,
  project: ProjectRow,
  reviewer: UserRow,
  strategy: 'unanimous' | 'majority',
  itemIds?: number[],
): Promise<{ finalized: number; skipped: number }> {
  const ids = itemIds?.length
    ? itemIds
    : (
        await rows<{ id: number }>(
          db,
          sql`with c as (${candidates(project)}) select c.id from c where ${inQueue(project)} order by c.seq`,
        )
      ).map((r) => r.id);
  let finalized = 0;
  let skipped = 0;
  for (let start = 0; start < ids.length; start += 500) {
    const chunk = ids.slice(start, start + 500);
    await db.transaction(async (tx) => {
      // Lock the items, then read their answers. Submitting, editing, returning and
      // finalising all lock the item too, so nothing read below can change before this
      // commits. Reading first and writing later, as this used to, let a majority taken
      // from stale answers overwrite a reviewer's decision, or miss an answer submitted
      // in between. Locked in id order, so overlapping bulk runs queue, not deadlock.
      const itemRows = await tx
        .select()
        .from(items)
        .where(and(inArray(items.id, chunk), eq(items.projectId, project.id)))
        .orderBy(items.id)
        .for('update');
      const subs = itemRows.length
        ? await tx
            .select()
            .from(annotations)
            .where(
              and(
                inArray(
                  annotations.itemId,
                  itemRows.map((i) => i.id),
                ),
                eq(annotations.source, 'human'),
                eq(annotations.status, 'submitted'),
              ),
            )
        : [];
      for (const item of itemRows) {
        const mine = subs.filter((s) => s.itemId === item.id);
        const m = majorityOf(project, item.text, mine);
        const ok =
          !item.finalizedAt &&
          m != null &&
          !mine.some((s) => s.flagged) &&
          (strategy === 'unanimous' ? m.votes === m.total : !m.tie && m.votes * 2 > m.total);
        if (ok && (await finalizeOpenItem(tx, project.type, item.id, m, 'review', reviewer.id))) {
          finalized++;
        } else {
          skipped++;
        }
      }
    });
  }
  return { finalized, skipped };
}
