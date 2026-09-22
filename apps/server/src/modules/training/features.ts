import { fnv1a32 } from '@crowd/shared';

export interface SparseVector {
  idx: Int32Array;
  val: Float32Array;
}

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

/**
 * The raw feature strings of a text: character 1–3-grams (script-agnostic, the backbone for
 * Chinese) plus dictionary word tokens from ICU's segmenter (which splits Chinese words and
 * English words alike).
 */
export function featureStrings(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase();
  const chars = Array.from(` ${normalized.replace(/\s+/g, ' ')} `);
  const out: string[] = [];
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= chars.length; i++) {
      const gram = chars.slice(i, i + n).join('');
      if (gram.trim() !== '') out.push(`c${n}:${gram}`);
    }
  }
  for (const seg of segmenter.segment(normalized)) {
    if (seg.isWordLike) out.push(`w:${seg.segment}`);
  }
  return out;
}

/** Term counts per hash bucket, sorted by bucket. */
export function hashedCounts(text: string, bits: number): Map<number, number> {
  const mask = (1 << bits) - 1;
  const counts = new Map<number, number>();
  for (const f of featureStrings(text)) {
    const b = fnv1a32(f) & mask;
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return counts;
}

/** Inverse document frequency per bucket, smoothed: ln((1 + N) / (1 + df)) + 1. */
export function fitIdf(docs: Map<number, number>[], bits: number): Float32Array {
  const df = new Float32Array(1 << bits);
  for (const d of docs) for (const b of d.keys()) df[b]!++;
  const n = docs.length;
  const idf = new Float32Array(1 << bits);
  for (let b = 0; b < idf.length; b++) idf[b] = Math.log((1 + n) / (1 + df[b]!)) + 1;
  return idf;
}

/** Sublinear TF × IDF, L2-normalised. */
export function tfidf(counts: Map<number, number>, idf: Float32Array): SparseVector {
  const entries = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  const idx = new Int32Array(entries.length);
  const val = new Float32Array(entries.length);
  let norm = 0;
  entries.forEach(([b, c], i) => {
    const v = (1 + Math.log(c)) * idf[b]!;
    idx[i] = b;
    val[i] = v;
    norm += v * v;
  });
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < val.length; i++) val[i]! /= norm;
  return { idx, val };
}
