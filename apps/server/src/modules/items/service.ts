import { createHash } from 'node:crypto';
import {
  canonicalSpans,
  defaultHotkey,
  defaultLabelColor,
  type FinalSource,
  type ImportResult,
  type ItemDetail,
  type ItemListQuery,
  type ItemPage,
  type ItemState,
  type importBatchSchema,
  itemListQuerySchema,
  type LabelDef,
  normalizeText,
  type Span,
  validateSpans,
} from '@crowd/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { type Db, rows } from '../../db/client';
import {
  annotations,
  items,
  type ProjectRow,
  projects,
  type UserRow,
  users,
} from '../../db/schema';
import { answerSql, finalAnswerSql, finalColumns } from '../../lib/answers';
import { annotationView, finalView, iso } from '../../lib/dto';
import { AppError, notFound } from '../../lib/errors';

export const textHash = (text: string) =>
  createHash('sha1').update(normalizeText(text)).digest('hex');

type ImportBatch = z.infer<typeof importBatchSchema>;

/**
 * Import one batch (the client splits large files). Items get consecutive sequence numbers
 * under a per-project lock, labels that arrive with the data are stored as `import`
 * annotations — never as human ones — and, if asked, become the items' final labels.
 */
export async function importBatch(
  db: Db,
  project: ProjectRow,
  input: ImportBatch,
): Promise<ImportResult> {
  const warnings: string[] = [];
  const warn = (msg: string) => {
    if (warnings.length < 20) warnings.push(msg);
  };
  const labels = [...project.labels];
  const known = () => new Set(labels.map((l) => l.name));

  // Unknown labels are decided up front, for the whole batch.
  const incoming = new Set<string>();
  for (const it of input.items) {
    if (project.type === 'classification' && it.label) incoming.add(it.label);
    if (project.type === 'ner') for (const s of it.spans ?? []) incoming.add(s.label);
  }
  const unknown = [...incoming].filter((l) => !known().has(l));
  const addedLabels: string[] = [];
  if (unknown.length) {
    if (input.unknownLabels === 'error') {
      throw new AppError(
        400,
        'unknown_labels',
        `Labels not in this project: ${unknown.slice(0, 10).join(', ')}`,
        {
          labels: unknown,
        },
      );
    }
    if (input.unknownLabels === 'add') {
      for (const name of unknown) {
        const used = new Set(labels.map((l) => l.hotkey));
        let hotkey: string | null = null;
        for (let k = 0; k < 40 && hotkey == null; k++) {
          const candidate = defaultHotkey(k);
          if (candidate && !used.has(candidate)) hotkey = candidate;
        }
        labels.push({
          name,
          color: defaultLabelColor(labels.length),
          hotkey,
          description: '',
        } satisfies LabelDef);
        addedLabels.push(name);
      }
    }
  }
  const names = known();

  type Prepared = {
    text: string;
    hash: string;
    meta: Record<string, unknown>;
    label: string | null;
    spans: Span[] | null;
  };
  const prepared: Prepared[] = [];
  let skipped = 0;
  let labelsDropped = 0;
  input.items.forEach((it, idx) => {
    const text = it.text.replace(/\r\n?/g, '\n');
    if (text.trim() === '') {
      skipped++;
      warn(`row ${idx + 1}: empty text`);
      return;
    }
    const meta: Record<string, unknown> = { ...(it.meta ?? {}) };
    if (it.externalId) meta.externalId = it.externalId;
    let label: string | null = null;
    let spans: Span[] | null = null;
    if (project.type === 'classification' && it.label) {
      if (names.has(it.label)) label = it.label;
      else labelsDropped++;
    }
    if (project.type === 'ner' && it.spans) {
      const kept = it.spans.filter((s) => names.has(s.label));
      if (kept.length !== it.spans.length) labelsDropped++;
      const check = validateSpans(text, kept, [...names]);
      if (check.ok) spans = canonicalSpans(check.spans);
      else {
        labelsDropped++;
        warn(`row ${idx + 1}: spans dropped (${check.error})`);
      }
    }
    prepared.push({ text, hash: textHash(text), meta, label, spans });
  });

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${project.id}::int, 0)`);
    if (addedLabels.length) {
      await tx
        .update(projects)
        .set({ labels, updatedAt: new Date() })
        .where(eq(projects.id, project.id));
    }

    let toInsert = prepared;
    let duplicates = 0;
    if (input.dedupe) {
      const seen = new Set<string>();
      const existing = new Set<string>();
      const hashes = [...new Set(prepared.map((p) => p.hash))];
      for (let i = 0; i < hashes.length; i += 1000) {
        const found = await tx
          .select({ h: items.textHash })
          .from(items)
          .where(
            sql`${items.projectId} = ${project.id} and ${inArray(items.textHash, hashes.slice(i, i + 1000))}`,
          );
        for (const f of found) existing.add(f.h);
      }
      toInsert = prepared.filter((p) => {
        if (existing.has(p.hash) || seen.has(p.hash)) {
          duplicates++;
          return false;
        }
        seen.add(p.hash);
        return true;
      });
    }

    const [max] = await rows<{ max: number | null }>(
      tx,
      sql`select max(seq)::int as max from items where project_id = ${project.id}`,
    );
    let seq = max?.max ?? 0;
    const firstSeq = toInsert.length ? seq + 1 : null;
    let labeled = 0;

    for (let i = 0; i < toInsert.length; i += 1000) {
      const chunk = toInsert.slice(i, i + 1000);
      const inserted = await tx
        .insert(items)
        .values(
          chunk.map((p) => ({
            projectId: project.id,
            seq: ++seq,
            text: p.text,
            textHash: p.hash,
            meta: p.meta,
            ...(input.finalizeImported && (p.label != null || p.spans != null)
              ? finalColumns(project.type, p, 'import', null)
              : {}),
          })),
        )
        .returning({ id: items.id });
      const labelled = chunk
        .map((p, j) => ({ p, id: inserted[j]!.id }))
        .filter(({ p }) => p.label != null || p.spans != null);
      labeled += labelled.length;
      if (labelled.length) {
        await tx.insert(annotations).values(
          labelled.map(({ p, id }) => ({
            projectId: project.id,
            itemId: id,
            source: 'import' as const,
            status: 'submitted' as const,
            label: p.label,
            spans: p.spans,
            submittedAt: new Date(),
          })),
        );
      }
    }

    return {
      inserted: toInsert.length,
      duplicates,
      skipped,
      labelsDropped,
      labeled,
      addedLabels,
      firstSeq,
      lastSeq: toInsert.length ? seq : null,
      warnings,
    };
  });
}

const likeEscape = (q: string) => q.replace(/[\\%_]/g, (m) => `\\${m}`);

export async function listItems(
  db: Db,
  project: ProjectRow,
  rawQuery: ItemListQuery,
): Promise<ItemPage> {
  const q = itemListQuerySchema.parse(rawQuery);
  const k = project.settings.redundancy;
  const conds = [sql`i.project_id = ${project.id}`];

  switch (q.state) {
    case 'unlabeled':
      conds.push(sql`i.finalized_at is null and i.human_count = 0`);
      break;
    case 'in_progress':
      conds.push(sql`i.finalized_at is null and i.human_count > 0 and i.human_count < ${k}`);
      break;
    case 'needs_review':
      conds.push(sql`i.finalized_at is null and i.human_count >= ${k}`);
      break;
    case 'finalized':
      conds.push(sql`i.finalized_at is not null`);
      break;
  }
  if (q.q) conds.push(sql`i.text ilike ${`%${likeEscape(q.q)}%`}`);
  if (q.label) {
    const pattern = JSON.stringify([{ label: q.label }]);
    conds.push(sql`(i.final_label = ${q.label} or i.final_spans @> ${pattern}::jsonb or exists (
      select 1 from annotations a where a.item_id = i.id and a.source = 'human' and a.status = 'submitted'
        and (a.label = ${q.label} or a.spans @> ${pattern}::jsonb)))`);
  }
  if (q.flagged) {
    conds.push(
      sql`exists (select 1 from annotations a where a.item_id = i.id and a.source = 'human' and a.flagged)`,
    );
  }
  if (q.disagreement) {
    conds.push(sql`(select count(distinct ${answerSql('a')}) from annotations a
      where a.item_id = i.id and a.source = 'human' and a.status = 'submitted') > 1`);
  }
  if (q.annotator) {
    conds.push(sql`exists (select 1 from annotations a where a.item_id = i.id and a.source = 'human'
      and a.user_id = ${q.annotator} and a.status = 'submitted')`);
  }
  switch (q.llm) {
    case 'missing':
      conds.push(
        sql`not exists (select 1 from annotations d where d.item_id = i.id and d.source = 'llm')`,
      );
      break;
    case 'ok':
      conds.push(
        sql`exists (select 1 from annotations d where d.item_id = i.id and d.source = 'llm' and d.status = 'submitted')`,
      );
      break;
    case 'error':
      conds.push(
        sql`exists (select 1 from annotations d where d.item_id = i.id and d.source = 'llm' and d.status = 'error')`,
      );
      break;
    case 'disagrees':
      conds.push(sql`i.finalized_at is not null and exists (select 1 from annotations d where d.item_id = i.id
        and d.source = 'llm' and d.status = 'submitted'
        and ${answerSql('d')} <> ${finalAnswerSql('i')})`);
      break;
  }
  const where = sql.join(conds, sql` and `);
  const order =
    q.sort === '-seq'
      ? sql`i.seq desc`
      : q.sort === 'updated'
        ? sql`i.finalized_at desc nulls last, i.seq`
        : sql`i.seq`;

  const [{ total } = { total: 0 }] = await rows<{ total: number }>(
    db,
    sql`select count(*)::int as total from items i where ${where}`,
  );
  const found = await rows<{
    id: number;
    seq: number;
    text: string;
    human_count: number;
    final_label: string | null;
    final_span_count: number | null;
    final_source: FinalSource | null;
    finalized: boolean;
    llm_label: string | null;
    llm_span_count: number | null;
    llm_status: 'submitted' | 'error' | null;
    imp_label: string | null;
    imp_span_count: number | null;
    human_labels: string[] | null;
    flagged: boolean | null;
    distinct_answers: number | null;
  }>(
    db,
    sql`
      select i.id, i.seq, left(i.text, 400) as text, i.human_count, i.final_label,
        case when i.final_spans is null then null else jsonb_array_length(i.final_spans) end as final_span_count,
        i.final_source, i.finalized_at is not null as finalized,
        d.label as llm_label,
        case when d.spans is null then null else jsonb_array_length(d.spans) end as llm_span_count,
        d.status as llm_status,
        m.label as imp_label,
        case when m.spans is null then null else jsonb_array_length(m.spans) end as imp_span_count,
        h.labels as human_labels, h.flagged, h.distinct_answers::int
      from items i
      left join annotations d on d.item_id = i.id and d.source = 'llm'
      left join annotations m on m.item_id = i.id and m.source = 'import'
      left join lateral (
        select array_agg(coalesce(a.label, '') order by a.id) filter (where a.status = 'submitted') as labels,
               bool_or(a.flagged) as flagged,
               count(distinct ${answerSql('a')}) filter (where a.status = 'submitted') as distinct_answers
        from annotations a where a.item_id = i.id and a.source = 'human'
      ) h on true
      where ${where}
      order by ${order}
      limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`,
  );

  const stateOf = (r: (typeof found)[number]): ItemState =>
    r.finalized
      ? 'finalized'
      : r.human_count === 0
        ? 'unlabeled'
        : r.human_count >= k
          ? 'needs_review'
          : 'in_progress';

  return {
    rows: found.map((r) => ({
      id: r.id,
      seq: r.seq,
      text: r.text,
      state: stateOf(r),
      final:
        r.finalized && r.final_source
          ? { label: r.final_label, spanCount: r.final_span_count, source: r.final_source }
          : null,
      humanCount: r.human_count,
      humanLabels: project.type === 'classification' ? (r.human_labels ?? []).filter(Boolean) : [],
      llm: r.llm_status
        ? { label: r.llm_label, spanCount: r.llm_span_count, status: r.llm_status }
        : null,
      imported:
        r.imp_label != null || r.imp_span_count != null
          ? { label: r.imp_label, spanCount: r.imp_span_count }
          : null,
      flagged: !!r.flagged,
      disagreement: (r.distinct_answers ?? 0) > 1,
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function itemDetail(db: Db, project: ProjectRow, itemId: number): Promise<ItemDetail> {
  const [item] = await db.select().from(items).where(eq(items.id, itemId));
  if (!item || item.projectId !== project.id) throw notFound('Item');
  const anns = await db
    .select()
    .from(annotations)
    .where(eq(annotations.itemId, itemId))
    .orderBy(annotations.id);
  const ids = new Set<number>();
  for (const a of anns) {
    if (a.userId) ids.add(a.userId);
    if (a.reviewedBy) ids.add(a.reviewedBy);
  }
  if (item.finalizedBy) ids.add(item.finalizedBy);
  const userMap = new Map<number, UserRow>();
  if (ids.size)
    for (const u of await db
      .select()
      .from(users)
      .where(inArray(users.id, [...ids])))
      userMap.set(u.id, u);
  const order = { import: 0, llm: 1, human: 2 } as const;
  return {
    item: {
      id: item.id,
      seq: item.seq,
      text: item.text,
      meta: item.meta,
      createdAt: iso(item.createdAt)!,
    },
    final: finalView(item, userMap),
    annotations: anns
      .sort((a, b) => order[a.source] - order[b.source] || a.id - b.id)
      .map((a) => annotationView(a, item.text, userMap, { includeRaw: true })),
  };
}

export async function deleteItems(db: Db, project: ProjectRow, itemIds: number[]): Promise<number> {
  if (!itemIds.length) return 0;
  const deleted = await db
    .delete(items)
    .where(sql`${items.projectId} = ${project.id} and ${inArray(items.id, itemIds)}`)
    .returning({ id: items.id });
  return deleted.length;
}
