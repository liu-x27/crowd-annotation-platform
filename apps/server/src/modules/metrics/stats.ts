import type { Confusion, LabelScore, Span } from '@crowd/shared';

/**
 * Krippendorff's alpha for nominal data. `units` holds, per item, the values the raters
 * gave; items with fewer than two values carry no pairing information and are ignored.
 * Handles any number of raters per item and missing ratings.
 */
export function krippendorffAlphaNominal(units: string[][]): number | null {
  const coincidence = new Map<string, Map<string, number>>();
  const add = (a: string, b: string, w: number) => {
    const row = coincidence.get(a) ?? new Map<string, number>();
    row.set(b, (row.get(b) ?? 0) + w);
    coincidence.set(a, row);
  };
  for (const values of units) {
    const m = values.length;
    if (m < 2) continue;
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) if (i !== j) add(values[i]!, values[j]!, 1 / (m - 1));
    }
  }
  const categories = [...coincidence.keys()];
  const nc = new Map(
    categories.map((c) => [c, [...coincidence.get(c)!.values()].reduce((s, v) => s + v, 0)]),
  );
  const n = [...nc.values()].reduce((s, v) => s + v, 0);
  if (n <= 1) return null;
  let disagreeObserved = 0;
  let disagreeExpected = 0;
  for (const c of categories) {
    for (const k of categories) {
      if (c === k) continue;
      disagreeObserved += coincidence.get(c)?.get(k) ?? 0;
      disagreeExpected += nc.get(c)! * nc.get(k)!;
    }
  }
  if (disagreeExpected === 0) return null; // one category only: agreement is undefined
  return 1 - ((n - 1) * disagreeObserved) / disagreeExpected;
}

/** Cohen's kappa for two raters over the same items. */
export function cohenKappa(a: string[], b: string[]): number | null {
  const n = a.length;
  if (n === 0 || n !== b.length) return null;
  let agree = 0;
  const ma = new Map<string, number>();
  const mb = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree++;
    ma.set(a[i]!, (ma.get(a[i]!) ?? 0) + 1);
    mb.set(b[i]!, (mb.get(b[i]!) ?? 0) + 1);
  }
  const po = agree / n;
  let pe = 0;
  for (const [label, count] of ma) pe += (count / n) * ((mb.get(label) ?? 0) / n);
  if (pe === 1) return null;
  return (po - pe) / (1 - pe);
}

const spanKey = (s: Span) => `${s.start}:${s.end}:${s.label}`;

export interface SpanCounts {
  tp: number;
  fp: number;
  fn: number;
}

/** Exact-match span counts (boundaries and label must both match). */
export function spanCounts(predicted: Span[], reference: Span[]): SpanCounts {
  const ref = new Set(reference.map(spanKey));
  let tp = 0;
  for (const s of predicted) if (ref.has(spanKey(s))) tp++;
  return { tp, fp: predicted.length - tp, fn: reference.length - tp };
}

export function prf(c: SpanCounts): {
  precision: number | null;
  recall: number | null;
  f1: number | null;
} {
  const precision = c.tp + c.fp > 0 ? c.tp / (c.tp + c.fp) : null;
  const recall = c.tp + c.fn > 0 ? c.tp / (c.tp + c.fn) : null;
  const f1 =
    precision != null && recall != null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : precision === 0 || recall === 0
        ? 0
        : null;
  return { precision, recall, f1 };
}

/** Span F1 between two annotators; symmetric. 1 when both marked nothing. */
export function spanAgreement(a: Span[], b: Span[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const { tp, fp, fn } = spanCounts(a, b);
  return (2 * tp) / (2 * tp + fp + fn);
}

export interface ClassificationScores {
  accuracy: number | null;
  macroF1: number | null;
  perLabel: LabelScore[];
  confusion: Confusion;
}

/** Scores for predicted vs reference labels. Confusion rows are the reference. */
export function classificationScores(
  labels: string[],
  reference: string[],
  predicted: string[],
): ClassificationScores {
  const index = new Map(labels.map((l, i) => [l, i]));
  const extra = [...new Set([...reference, ...predicted])].filter((l) => !index.has(l));
  const all = [...labels, ...extra];
  all.forEach((l, i) => {
    index.set(l, i);
  });
  const matrix = all.map(() => all.map(() => 0));
  let correct = 0;
  for (let i = 0; i < reference.length; i++) {
    matrix[index.get(reference[i]!)!]![index.get(predicted[i]!)!]!++;
    if (reference[i] === predicted[i]) correct++;
  }
  const perLabel: LabelScore[] = all.map((label, i) => {
    const tp = matrix[i]![i]!;
    const support = matrix[i]!.reduce((s, v) => s + v, 0);
    const predictedN = matrix.reduce((s, row) => s + row[i]!, 0);
    const { precision, recall, f1 } = prf({ tp, fp: predictedN - tp, fn: support - tp });
    return { label, precision, recall, f1, support };
  });
  const scored = perLabel.filter((p) => p.support > 0);
  const macroF1 = scored.length
    ? scored.reduce((s, p) => s + (p.f1 ?? 0), 0) / scored.length
    : null;
  return {
    accuracy: reference.length ? correct / reference.length : null,
    macroF1,
    perLabel,
    confusion: { labels: all, matrix },
  };
}

export interface NerScores {
  precision: number | null;
  recall: number | null;
  f1: number | null;
  macroF1: number | null;
  perLabel: LabelScore[];
}

export function nerScores(
  labels: string[],
  pairs: { predicted: Span[]; reference: Span[] }[],
): NerScores {
  const total: SpanCounts = { tp: 0, fp: 0, fn: 0 };
  const byLabel = new Map<string, SpanCounts>(labels.map((l) => [l, { tp: 0, fp: 0, fn: 0 }]));
  for (const { predicted, reference } of pairs) {
    const c = spanCounts(predicted, reference);
    total.tp += c.tp;
    total.fp += c.fp;
    total.fn += c.fn;
    for (const label of new Set([...predicted, ...reference].map((s) => s.label))) {
      const lc = spanCounts(
        predicted.filter((s) => s.label === label),
        reference.filter((s) => s.label === label),
      );
      const acc = byLabel.get(label) ?? { tp: 0, fp: 0, fn: 0 };
      acc.tp += lc.tp;
      acc.fp += lc.fp;
      acc.fn += lc.fn;
      byLabel.set(label, acc);
    }
  }
  const perLabel = [...byLabel.entries()].map(([label, c]) => ({
    label,
    ...prf(c),
    support: c.tp + c.fn,
  }));
  const scored = perLabel.filter((p) => p.support > 0);
  return {
    ...prf(total),
    macroF1: scored.length ? scored.reduce((s, p) => s + (p.f1 ?? 0), 0) / scored.length : null,
    perLabel,
  };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
