import type { Span } from '@crowd/shared';

/**
 * Selection → offsets, without ever measuring text.
 *
 * v1 computed offsets from `Range.toString()` over the container, which counted the label
 * badges drawn inside highlighted entities as part of the sentence — so every span marked
 * after an existing one was stored too far right (three such spans are in the v1 data).
 * Here each code point is its own element carrying `data-i`; decorations carry none. The
 * offsets are read off those attributes, so nothing rendered around the text can move them.
 */
export function rangeFromSelection(
  container: HTMLElement,
  selection: Selection | null,
): { start: number; end: number } | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const indices: number[] = [];
  for (const el of container.querySelectorAll<HTMLElement>('[data-i]')) {
    if (range.intersectsNode(el)) {
      // A range can touch an element at its boundary without covering any of its text.
      const r = document.createRange();
      r.selectNodeContents(el);
      const startsAfter = range.compareBoundaryPoints(Range.START_TO_END, r) <= 0;
      const endsBefore = range.compareBoundaryPoints(Range.END_TO_START, r) >= 0;
      if (!startsAfter && !endsBefore) indices.push(Number(el.dataset.i));
    }
  }
  if (indices.length === 0) return null;
  return { start: Math.min(...indices), end: Math.max(...indices) + 1 };
}

/** Trim whitespace code points off both ends of a range. */
export function trimRange(
  chars: string[],
  r: { start: number; end: number },
): { start: number; end: number } | null {
  let { start, end } = r;
  while (start < end && /\s/.test(chars[start]!)) start++;
  while (end > start && /\s/.test(chars[end - 1]!)) end--;
  return end > start ? { start, end } : null;
}

export const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end;

export interface Segment {
  kind: 'text' | 'span' | 'draft';
  start: number;
  end: number;
  span?: Span;
}

/**
 * Cut the text into runs: accepted spans, draft suggestions not covered by an accepted
 * span, and plain text between them.
 */
export function segment(length: number, spans: Span[], drafts: Span[]): Segment[] {
  const accepted = [...spans].sort((a, b) => a.start - b.start);
  const visibleDrafts = drafts
    .filter((d) => !accepted.some((s) => overlaps(s, d)))
    .sort((a, b) => a.start - b.start);
  const marks = [
    ...accepted.map((s) => ({ kind: 'span' as const, s })),
    ...visibleDrafts.map((s) => ({ kind: 'draft' as const, s })),
  ].sort((a, b) => a.s.start - b.s.start);
  const out: Segment[] = [];
  let cursor = 0;
  for (const m of marks) {
    if (m.s.start < cursor) continue; // overlapping drafts: first one wins on screen
    if (m.s.start > cursor) out.push({ kind: 'text', start: cursor, end: m.s.start });
    out.push({ kind: m.kind, start: m.s.start, end: m.s.end, span: m.s });
    cursor = m.s.end;
  }
  if (cursor < length) out.push({ kind: 'text', start: cursor, end: length });
  return out;
}

export const sameSpan = (a: Span, b: Span) =>
  a.start === b.start && a.end === b.end && a.label === b.label;
