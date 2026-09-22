import type { AgreementReport, DraftQuality, Overview, Span, UserRef } from '@crowd/shared';
import { spanSetKey } from '@crowd/shared';
import { inArray, sql } from 'drizzle-orm';
import { type Db, rows } from '../../db/client';
import { type ProjectRow, users } from '../../db/schema';
import { userRef } from '../../lib/dto';
import { projectCounts } from '../projects/service';
import {
  classificationScores,
  cohenKappa,
  krippendorffAlphaNominal,
  median,
  nerScores,
  spanAgreement,
} from './stats';

const answerKey = (project: ProjectRow, label: string | null, spans: Span[] | null) =>
  project.type === 'ner' ? spanSetKey(spans ?? []) : String(label);

async function userRefs(db: Db, ids: number[]): Promise<Map<number, UserRef>> {
  const out = new Map<number, UserRef>();
  if (ids.length === 0) return out;
  for (const u of await db.select().from(users).where(inArray(users.id, ids)))
    out.set(u.id, userRef(u)!);
  return out;
}

export async function overview(db: Db, project: ProjectRow, timeZone: string): Promise<Overview> {
  const counts = (await projectCounts(db, [project.id])).get(project.id)!;

  const [a] = await rows<Overview['annotations']>(
    db,
    sql`
      select
        count(*) filter (where source = 'human' and status = 'submitted')::int as human,
        count(*) filter (where source = 'human' and status = 'skipped')::int as skipped,
        count(*) filter (where source = 'human' and status = 'claimed' and lease_expires_at > now())::int as claimed,
        count(*) filter (where source = 'llm' and status = 'submitted')::int as llm,
        count(*) filter (where source = 'llm' and status = 'error')::int as "llmErrors",
        count(*) filter (where source = 'import')::int as imported
      from annotations where project_id = ${project.id}`,
  );

  const labelRows =
    project.type === 'classification'
      ? await rows<{ label: string; final: number; human: number; llm: number; imported: number }>(
          db,
          sql`
            with l as (
              select final_label as label, 'final' as src from items where project_id = ${project.id} and final_label is not null
              union all
              select label, source from annotations
              where project_id = ${project.id} and label is not null and status = 'submitted'
            )
            select label,
              count(*) filter (where src = 'final')::int as final,
              count(*) filter (where src = 'human')::int as human,
              count(*) filter (where src = 'llm')::int as llm,
              count(*) filter (where src = 'import')::int as imported
            from l group by label`,
        )
      : await rows<{ label: string; final: number; human: number; llm: number; imported: number }>(
          db,
          sql`
            with l as (
              select s->>'label' as label, 'final' as src
              from items i, jsonb_array_elements(i.final_spans) s
              where i.project_id = ${project.id} and i.final_spans is not null
              union all
              select s->>'label', a.source
              from annotations a, jsonb_array_elements(a.spans) s
              where a.project_id = ${project.id} and a.spans is not null and a.status = 'submitted'
            )
            select label,
              count(*) filter (where src = 'final')::int as final,
              count(*) filter (where src = 'human')::int as human,
              count(*) filter (where src = 'llm')::int as llm,
              count(*) filter (where src = 'import')::int as imported
            from l group by label`,
        );
  const order = new Map(project.labels.map((l, i) => [l.name, i]));
  labelRows.sort((x, y) => (order.get(x.label) ?? 999) - (order.get(y.label) ?? 999));

  const throughput = await rows<{ day: string; submitted: number }>(
    db,
    sql`
      select to_char((submitted_at at time zone ${timeZone})::date, 'YYYY-MM-DD') as day, count(*)::int as submitted
      from annotations
      where project_id = ${project.id} and source = 'human' and status = 'submitted'
        and submitted_at > now() - interval '30 days'
      group by 1 order by 1`,
  );

  const perAnnotator = await rows<{
    user_id: number;
    submitted: number;
    skipped: number;
    median_ms: number | null;
    agree_final: number | null;
    agree_draft: number | null;
    last_at: Date | null;
  }>(
    db,
    sql`
      select a.user_id,
        count(*) filter (where a.status = 'submitted')::int as submitted,
        count(*) filter (where a.status = 'skipped')::int as skipped,
        percentile_cont(0.5) within group (order by a.duration_ms)
          filter (where a.status = 'submitted' and a.duration_ms is not null) as median_ms,
        avg(case when i.finalized_at is null then null
                 else (coalesce(a.label, '') || coalesce(a.spans::text, '')
                       = coalesce(i.final_label, '') || coalesce(i.final_spans::text, ''))::int end)
          filter (where a.status = 'submitted') as agree_final,
        avg(case when d.id is null then null
                 else (coalesce(a.label, '') || coalesce(a.spans::text, '')
                       = coalesce(d.label, '') || coalesce(d.spans::text, ''))::int end)
          filter (where a.status = 'submitted') as agree_draft,
        max(a.submitted_at) as last_at
      from annotations a
      join items i on i.id = a.item_id
      left join annotations d on d.item_id = a.item_id and d.source = 'llm' and d.status = 'submitted'
      where a.project_id = ${project.id} and a.source = 'human' and a.user_id is not null
      group by a.user_id
      order by submitted desc`,
  );
  const refs = await userRefs(
    db,
    perAnnotator.map((r) => r.user_id),
  );

  return {
    counts,
    annotations: a ?? { human: 0, skipped: 0, claimed: 0, llm: 0, llmErrors: 0, imported: 0 },
    labels: labelRows,
    throughput,
    annotators: perAnnotator
      .filter((r) => refs.has(r.user_id))
      .map((r) => ({
        user: refs.get(r.user_id)!,
        submitted: r.submitted,
        skipped: r.skipped,
        medianMs: r.median_ms != null ? Math.round(Number(r.median_ms)) : null,
        agreeWithFinal: r.agree_final != null ? Number(r.agree_final) : null,
        agreeWithDraft: r.agree_draft != null ? Number(r.agree_draft) : null,
        lastAt: r.last_at ? new Date(r.last_at).toISOString() : null,
      })),
  };
}

export async function agreement(db: Db, project: ProjectRow): Promise<AgreementReport> {
  const subs = await rows<{
    item_id: number;
    user_id: number;
    label: string | null;
    spans: Span[] | null;
  }>(
    db,
    sql`
      select a.item_id, a.user_id, a.label, a.spans from annotations a
      where a.project_id = ${project.id} and a.source = 'human' and a.status = 'submitted' and a.user_id is not null
        and a.item_id in (
          select item_id from annotations
          where project_id = ${project.id} and source = 'human' and status = 'submitted'
          group by item_id having count(*) >= 2)
      order by a.item_id, a.user_id`,
  );
  const byItem = new Map<number, typeof subs>();
  for (const s of subs) byItem.set(s.item_id, [...(byItem.get(s.item_id) ?? []), s]);

  const pairStats = new Map<
    string,
    { a: number; b: number; xs: string[]; ys: string[]; agreeSum: number; n: number }
  >();
  let pairAgreeSum = 0;
  let pairN = 0;
  for (const list of byItem.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const x = list[i]!;
        const y = list[j]!;
        const agree =
          project.type === 'ner'
            ? spanAgreement(x.spans ?? [], y.spans ?? [])
            : x.label === y.label
              ? 1
              : 0;
        pairAgreeSum += agree;
        pairN++;
        const key = `${x.user_id}:${y.user_id}`;
        const p = pairStats.get(key) ?? {
          a: x.user_id,
          b: y.user_id,
          xs: [],
          ys: [],
          agreeSum: 0,
          n: 0,
        };
        p.xs.push(answerKey(project, x.label, x.spans));
        p.ys.push(answerKey(project, y.label, y.spans));
        p.agreeSum += agree;
        p.n++;
        pairStats.set(key, p);
      }
    }
  }
  const refs = await userRefs(db, [...new Set(subs.map((s) => s.user_id))]);
  return {
    kind: project.type,
    itemsCompared: byItem.size,
    alpha:
      project.type === 'classification'
        ? krippendorffAlphaNominal(
            [...byItem.values()].map((list) => list.map((s) => String(s.label))),
          )
        : null,
    observed: pairN ? pairAgreeSum / pairN : null,
    pairs: [...pairStats.values()]
      .filter((p) => refs.has(p.a) && refs.has(p.b))
      .map((p) => ({
        a: refs.get(p.a)!,
        b: refs.get(p.b)!,
        items: p.n,
        kappa: project.type === 'classification' ? cohenKappa(p.xs, p.ys) : null,
        agreement: p.agreeSum / p.n,
      }))
      .sort((x, y) => y.items - x.items),
  };
}

/**
 * How good the LLM drafts are, against a chosen reference: every submitted human answer
 * (`human`), the items' final labels (`final`), or labels that arrived with the data
 * (`import`). Also: how often annotators agreed with the draft when they could see it,
 * against when it was hidden from them.
 */
export async function draftQuality(
  db: Db,
  project: ProjectRow,
  reference: 'human' | 'final' | 'import',
): Promise<DraftQuality> {
  const [totals] = await rows<{ drafts: number; errors: number }>(
    db,
    sql`select count(*) filter (where status = 'submitted')::int as drafts,
               count(*) filter (where status = 'error')::int as errors
        from annotations where project_id = ${project.id} and source = 'llm'`,
  );

  const refRows =
    reference === 'final'
      ? sql`select i.id as item_id, i.final_label as label, i.final_spans as spans from items i
            where i.project_id = ${project.id} and i.finalized_at is not null`
      : sql`select a.item_id, a.label, a.spans from annotations a
            where a.project_id = ${project.id} and a.source = ${reference} and a.status = 'submitted'`;
  const pairs = await rows<{
    label: string | null;
    spans: Span[] | null;
    d_label: string | null;
    d_spans: Span[] | null;
  }>(
    db,
    sql`
      with r as (${refRows})
      select r.label, r.spans, d.label as d_label, d.spans as d_spans
      from r join annotations d on d.item_id = r.item_id and d.source = 'llm' and d.status = 'submitted'`,
  );

  const anchoring = await rows<{ shown: boolean; n: number; agree: number | null }>(
    db,
    sql`
      select a.draft_shown as shown, count(*)::int as n,
        avg((coalesce(a.label, '') || coalesce(a.spans::text, '')
             = coalesce(d.label, '') || coalesce(d.spans::text, ''))::int) as agree
      from annotations a
      join annotations d on d.item_id = a.item_id and d.source = 'llm' and d.status = 'submitted'
      where a.project_id = ${project.id} and a.source = 'human' and a.status = 'submitted' and a.draft_shown is not null
      group by a.draft_shown`,
  );
  const side = (shown: boolean) => {
    const r = anchoring.find((x) => x.shown === shown);
    return { n: r?.n ?? 0, agree: r?.agree != null ? Number(r.agree) : null };
  };

  const labels = project.labels.map((l) => l.name);
  const base = {
    kind: project.type,
    reference,
    drafts: totals?.drafts ?? 0,
    errors: totals?.errors ?? 0,
    compared: pairs.length,
    anchoring: { shown: side(true), hidden: side(false) },
  };
  if (project.type === 'classification') {
    const valid = pairs.filter((p) => p.label != null && p.d_label != null);
    if (valid.length === 0) {
      return {
        ...base,
        accuracy: null,
        precision: null,
        recall: null,
        f1: null,
        perLabel: [],
        confusion: null,
      };
    }
    const s = classificationScores(
      labels,
      valid.map((p) => p.label!),
      valid.map((p) => p.d_label!),
    );
    return {
      ...base,
      accuracy: s.accuracy,
      precision: null,
      recall: null,
      f1: s.macroF1,
      perLabel: s.perLabel,
      confusion: s.confusion,
    };
  }
  const s = nerScores(
    labels,
    pairs.map((p) => ({ predicted: p.d_spans ?? [], reference: p.spans ?? [] })),
  );
  return {
    ...base,
    accuracy: null,
    precision: s.precision,
    recall: s.recall,
    f1: s.f1,
    perLabel: s.perLabel,
    confusion: null,
  };
}

export { median };
