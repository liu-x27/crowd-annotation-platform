import { fnv1a32, type Span } from '@crowd/shared';
import { shuffle } from './rng';

/** Tag set for flat BIO: 0 = O, then B-x / I-x for each label. */
export function tagSet(labels: string[]): string[] {
  return ['O', ...labels.flatMap((l) => [`B-${l}`, `I-${l}`])];
}

export function spansToTags(length: number, spans: Span[], labels: string[]): Int32Array {
  const tags = new Int32Array(length);
  for (const s of spans) {
    const k = labels.indexOf(s.label);
    if (k < 0) continue;
    for (let i = s.start; i < s.end && i < length; i++)
      tags[i] = i === s.start ? 1 + 2 * k : 2 + 2 * k;
  }
  return tags;
}

export function tagsToSpans(tags: ArrayLike<number>, labels: string[]): Span[] {
  const spans: Span[] = [];
  let open: { start: number; k: number } | null = null;
  const close = (end: number) => {
    if (open) spans.push({ start: open.start, end, label: labels[open.k]! });
    open = null;
  };
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t === 0) close(i);
    else if ((t - 1) % 2 === 0) {
      close(i);
      open = { start: i, k: (t - 1) / 2 };
    } else {
      const k = (t - 2) / 2;
      if (!open || open.k !== k) {
        close(i);
        open = { start: i, k }; // a stray I- starts an entity rather than being dropped
      }
    }
  }
  close(tags.length);
  return spans;
}

function charType(ch: string | undefined): string {
  if (ch === undefined) return 'EDGE';
  if (/\s/u.test(ch)) return 'SP';
  if (/\p{Script=Han}/u.test(ch)) return 'HAN';
  if (/\p{Lu}/u.test(ch)) return 'UP';
  if (/\p{Ll}/u.test(ch)) return 'LO';
  if (/\p{N}/u.test(ch)) return 'NUM';
  if (/\p{P}/u.test(ch)) return 'P';
  return 'OT';
}

/** Hashed feature buckets for every position of a sentence. */
export function positionFeatures(chars: string[], bits: number): Int32Array[] {
  const mask = (1 << bits) - 1;
  const h = (s: string) => fnv1a32(s) & mask;
  const at = (i: number) => chars[i] ?? (i < 0 ? '<s>' : '</s>');
  return chars.map((_, i) => {
    const c0 = at(i);
    const lower = c0.toLowerCase();
    return Int32Array.from([
      h('bias'),
      h(`c0=${lower}`),
      h(`c-1=${at(i - 1).toLowerCase()}`),
      h(`c+1=${at(i + 1).toLowerCase()}`),
      h(`c-2=${at(i - 2).toLowerCase()}`),
      h(`c+2=${at(i + 2).toLowerCase()}`),
      h(`b-1=${at(i - 1).toLowerCase()}${lower}`),
      h(`b+1=${lower}${at(i + 1).toLowerCase()}`),
      h(`t0=${charType(chars[i])}`),
      h(`t-1=${charType(chars[i - 1])}`),
      h(`t+1=${charType(chars[i + 1])}`),
      h(`t-1t0=${charType(chars[i - 1])}|${charType(chars[i])}`),
    ]);
  });
}

export interface TaggerModel {
  bits: number;
  tags: number;
  emission: Float32Array; // (1 << bits) × tags
  transition: Float32Array; // (tags + 1) × tags; row `tags` is the start state
}

/** Transitions BIO forbids: I-x may only follow B-x or I-x. */
function allowed(prev: number, next: number): boolean {
  if (next === 0 || (next - 1) % 2 === 0) return true; // O or B-x
  const k = (next - 2) / 2;
  return prev === 1 + 2 * k || prev === 2 + 2 * k;
}

export function viterbi(model: TaggerModel, feats: Int32Array[]): Int32Array {
  const n = feats.length;
  const T = model.tags;
  const out = new Int32Array(n);
  if (n === 0) return out;
  const score = new Float64Array(n * T);
  const back = new Int32Array(n * T);
  const emit = (i: number, t: number) => {
    let s = 0;
    for (const f of feats[i]) s += model.emission[f * T + t];
    return s;
  };
  for (let t = 0; t < T; t++) {
    score[t] = allowed(-1, t) ? model.transition[T * T + t] + emit(0, t) : -Infinity;
  }
  for (let i = 1; i < n; i++) {
    for (let t = 0; t < T; t++) {
      const e = emit(i, t);
      let best = -Infinity;
      let arg = 0;
      for (let p = 0; p < T; p++) {
        if (!allowed(p, t)) continue;
        const s = score[(i - 1) * T + p] + model.transition[p * T + t];
        if (s > best) {
          best = s;
          arg = p;
        }
      }
      score[i * T + t] = best + e;
      back[i * T + t] = arg;
    }
  }
  let last = 0;
  for (let t = 1; t < T; t++) if (score[(n - 1) * T + t] > score[(n - 1) * T + last]) last = t;
  out[n - 1] = last;
  for (let i = n - 1; i > 0; i--) out[i - 1] = back[i * T + out[i]];
  return out;
}

export interface TaggerTrainer {
  epoch(data: { feats: Int32Array[]; gold: Int32Array }[], random: () => number): number;
  /** The averaged weights so far — what gets evaluated and saved. */
  averaged(): TaggerModel;
}

/**
 * Averaged structured perceptron (Collins 2002) with lazy averaging: alongside the weights
 * it keeps the sum of timestamped updates, so the average is `w - u / c` at any moment
 * without touching every weight on every step.
 */
export function taggerTrainer(bits: number, tags: number): TaggerTrainer {
  const size = (1 << bits) * tags;
  const w: TaggerModel = {
    bits,
    tags,
    emission: new Float32Array(size),
    transition: new Float32Array((tags + 1) * tags),
  };
  const uE = new Float32Array(size);
  const uT = new Float32Array((tags + 1) * tags);
  let c = 1;

  const update = (feats: Int32Array[], seq: ArrayLike<number>, delta: number) => {
    let prev = tags; // start row
    for (let i = 0; i < feats.length; i++) {
      const t = seq[i];
      for (const f of feats[i]) {
        w.emission[f * tags + t] += delta;
        uE[f * tags + t] += c * delta;
      }
      w.transition[prev * tags + t] += delta;
      uT[prev * tags + t] += c * delta;
      prev = t;
    }
  };

  return {
    epoch(data, random) {
      let wrong = 0;
      let total = 0;
      for (const ex of shuffle(data, random)) {
        const pred = viterbi(w, ex.feats);
        let differs = false;
        for (let i = 0; i < pred.length; i++) {
          if (pred[i] !== ex.gold[i]) {
            wrong++;
            differs = true;
          }
        }
        total += pred.length;
        if (differs) {
          update(ex.feats, ex.gold, 1);
          update(ex.feats, pred, -1);
        }
        c++;
      }
      return total ? wrong / total : 0;
    },
    averaged() {
      const emission = new Float32Array(size);
      for (let i = 0; i < size; i++) emission[i] = w.emission[i] - uE[i] / c;
      const transition = new Float32Array(w.transition.length);
      for (let i = 0; i < transition.length; i++) transition[i] = w.transition[i] - uT[i] / c;
      return { bits, tags, emission, transition };
    },
  };
}
