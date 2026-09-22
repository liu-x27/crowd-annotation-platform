import { type Span, spanSetKey, type TrainJobParams } from '@crowd/shared';
import { sql } from 'drizzle-orm';
import { type Db, rows } from '../../db/client';
import type { ProjectRow } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { rng, shuffle, stratifiedSplit } from './rng';

export interface Example {
  text: string;
  label: string | null;
  spans: Span[] | null;
}

export interface TrainingInput {
  kind: 'classification' | 'ner';
  labels: string[];
  params: TrainJobParams;
  train: Example[];
  test: (Example & { teacher: { label: string | null; spans: Span[] | null } | null })[];
  trainBySource: Record<string, number>;
}

interface ItemFacts {
  id: number;
  text: string;
  final_label: string | null;
  final_spans: Span[] | null;
  finalized: boolean;
  human: { label: string | null; spans: Span[] | null }[] | null;
  llm_label: string | null;
  llm_spans: Span[] | null;
  llm_ok: boolean;
  imp_label: string | null;
  imp_spans: Span[] | null;
  has_import: boolean;
}

function humanMajority(project: ProjectRow, human: ItemFacts['human']): Example | null {
  if (!human?.length) return null;
  const votes = new Map<string, { n: number; label: string | null; spans: Span[] | null }>();
  for (const h of human) {
    const key = project.type === 'ner' ? spanSetKey(h.spans ?? []) : String(h.label);
    const v = votes.get(key) ?? { n: 0, label: h.label, spans: h.spans };
    v.n++;
    votes.set(key, v);
  }
  const ranked = [...votes.values()].sort((a, b) => b.n - a.n);
  if (ranked.length > 1 && ranked[0]!.n === ranked[1]!.n) return null; // a tie decides nothing
  return { text: '', label: ranked[0]!.label, spans: ranked[0]!.spans };
}

/**
 * Build the train and test sets.
 *
 * The test set is drawn first, at the item level, from items that have a *reference* label
 * (final, or imported). Only then are training labels chosen, from whichever source was
 * asked for, over the remaining items. So an item's LLM draft can never train a model that
 * is then scored on that same item's human label — the split, not the source, decides.
 */
export async function buildTrainingInput(
  db: Db,
  project: ProjectRow,
  params: TrainJobParams,
): Promise<TrainingInput> {
  const facts = await rows<ItemFacts>(
    db,
    sql`
      select i.id, i.text, i.final_label, i.final_spans, i.finalized_at is not null as finalized,
        (select json_agg(json_build_object('label', a.label, 'spans', a.spans) order by a.id)
           from annotations a where a.item_id = i.id and a.source = 'human' and a.status = 'submitted') as human,
        d.label as llm_label, d.spans as llm_spans, coalesce(d.status = 'submitted', false) as llm_ok,
        m.label as imp_label, m.spans as imp_spans, m.id is not null as has_import
      from items i
      left join annotations d on d.item_id = i.id and d.source = 'llm'
      left join annotations m on m.item_id = i.id and m.source = 'import'
      where i.project_id = ${project.id}
      order by i.seq`,
  );
  const labels = project.labels.map((l) => l.name);
  const known = new Set(labels);
  const usable = (e: { label: string | null; spans: Span[] | null }) =>
    project.type === 'classification' ? e.label != null && known.has(e.label) : e.spans != null;

  const reference = (f: ItemFacts): Example | null => {
    const e =
      params.reference === 'import'
        ? f.has_import
          ? { text: f.text, label: f.imp_label, spans: f.imp_spans }
          : null
        : f.finalized
          ? { text: f.text, label: f.final_label, spans: f.final_spans }
          : null;
    return e && usable(e) ? e : null;
  };

  const withRef = facts.map((f, i) => ({ i, ref: reference(f) })).filter((x) => x.ref != null);
  if (withRef.length < 5) {
    throw new AppError(
      400,
      'not_enough_reference',
      `Only ${withRef.length} items have a ${params.reference} label; at least 5 are needed to score a model.`,
    );
  }
  const random = rng(params.seed);
  const testIdx =
    project.type === 'classification'
      ? stratifiedSplit(
          withRef.map((x) => x.ref!.label!),
          params.testFraction,
          random,
        ).held.map((k) => withRef[k]!.i)
      : shuffle(
          withRef.map((x) => x.i),
          random,
        ).slice(0, Math.max(1, Math.round(withRef.length * params.testFraction)));
  const inTest = new Set(testIdx);

  const trainBySource: Record<string, number> = {};
  const train: Example[] = [];
  facts.forEach((f, i) => {
    if (inTest.has(i)) return;
    const candidates: [string, Example | null][] = [];
    const final = f.finalized ? { text: f.text, label: f.final_label, spans: f.final_spans } : null;
    const human = humanMajority(project, f.human);
    const llm = f.llm_ok ? { text: f.text, label: f.llm_label, spans: f.llm_spans } : null;
    const imported = f.has_import ? { text: f.text, label: f.imp_label, spans: f.imp_spans } : null;
    switch (params.source) {
      case 'final':
        candidates.push(['final', final]);
        break;
      case 'human':
        candidates.push(['human', human && { ...human, text: f.text }]);
        break;
      case 'llm':
        candidates.push(['llm', llm]);
        break;
      case 'import':
        candidates.push(['import', imported]);
        break;
      case 'llm+human':
        candidates.push(
          ['final', final],
          ['human', human && { ...human, text: f.text }],
          ['llm', llm],
        );
        break;
    }
    const chosen = candidates.find(([, e]) => e && usable(e));
    if (!chosen) return;
    train.push(chosen[1]!);
    trainBySource[chosen[0]] = (trainBySource[chosen[0]] ?? 0) + 1;
  });

  if (train.length < 10) {
    throw new AppError(
      400,
      'not_enough_training',
      `Only ${train.length} training labels from "${params.source}"; at least 10 are needed.`,
    );
  }
  if (project.type === 'classification' && new Set(train.map((t) => t.label)).size < 2) {
    throw new AppError(400, 'one_class', 'The training labels use only one class.');
  }

  return {
    kind: project.type,
    labels,
    params,
    train,
    test: testIdx.map((i) => {
      const f = facts[i]!;
      const ref = reference(f)!;
      return { ...ref, teacher: f.llm_ok ? { label: f.llm_label, spans: f.llm_spans } : null };
    }),
    trainBySource,
  };
}
