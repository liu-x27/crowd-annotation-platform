import type { ProjectType } from './constants';
import { compareSpans, type Span, spanSetKey } from './text';

/** One annotator's (or the draft's, or the final) answer to an item. */
export interface Answer {
  label: string | null;
  spans: readonly Span[] | null;
}

/**
 * The one definition of "the same answer".
 *
 * Classification answers are the same when their labels are. NER answers are the same
 * when they mark the same set of `(start, end, label)` triples, in any order. Consensus,
 * the review queue's disagreement and draft-overridden filters, the agreement report,
 * anchoring, and training's majority vote all decide agreement through this — or, in SQL,
 * through its twin `answerSql` on the server, which gives the same verdict only because
 * every write stores spans through `canonicalSpans`.
 */
export function answerKey(type: ProjectType, answer: Answer): string {
  return type === 'ner' ? spanSetKey(answer.spans ?? []) : String(answer.label);
}

export function sameAnswer(type: ProjectType, a: Answer, b: Answer): boolean {
  return answerKey(type, a) === answerKey(type, b);
}

/**
 * Spans in the form they are stored in: sorted, and `start`, `end`, `label` only — never
 * the derived `text`. Every path that writes spans to the database goes through this.
 *
 * It is what lets SQL compare answers at all. Two equal span sets stored this way are the
 * same jsonb value, so they print as the same text, so `answerSql` agrees with
 * `answerKey`. Store one unsorted, or with `text` attached, and the database would count
 * two identical answers as a disagreement, silently.
 */
export function canonicalSpans(spans: readonly Span[]): Span[] {
  return [...spans].sort(compareSpans).map(({ start, end, label }) => ({ start, end, label }));
}

export interface Tally<A extends Answer> {
  /** The most common answer, as first seen. */
  top: A;
  votes: number;
  total: number;
  /** Another answer has as many votes as `top`. */
  tie: boolean;
}

/** Count answers by `answerKey`. `null` when there is nothing to count. */
export function tally<A extends Answer>(type: ProjectType, answers: readonly A[]): Tally<A> | null {
  if (answers.length === 0) return null;
  const votes = new Map<string, { answer: A; n: number }>();
  for (const a of answers) {
    const key = answerKey(type, a);
    const v = votes.get(key) ?? { answer: a, n: 0 };
    v.n++;
    votes.set(key, v);
  }
  const ranked = [...votes.values()].sort((x, y) => y.n - x.n);
  const top = ranked[0]!;
  return {
    top: top.answer,
    votes: top.n,
    total: answers.length,
    tie: ranked.length > 1 && ranked[1]!.n === top.n,
  };
}
