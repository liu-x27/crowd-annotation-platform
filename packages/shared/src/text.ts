/**
 * Span offsets.
 *
 * Every offset stored or sent by this platform is a Unicode *code point* index into the
 * item text, half-open: `[start, end)`. Not UTF-16 units (what JavaScript's `slice` uses)
 * and not bytes. For CJK text the three coincide; for emoji they do not, and a Python
 * consumer indexes by code point. The server derives each span's `text` from its offsets
 * and never trusts a client-supplied one, so an offset that points at the wrong characters
 * is rejected instead of stored.
 */

export interface Span {
  start: number;
  end: number;
  label: string;
}

export interface SpanWithText extends Span {
  text: string;
}

export function codePoints(text: string): string[] {
  return Array.from(text);
}

export function cpLength(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

export function cpSlice(text: string, start: number, end?: number): string {
  return Array.from(text).slice(start, end).join('');
}

/** Code point index of a UTF-16 index. */
export function utf16ToCp(text: string, utf16Index: number): number {
  return cpLength(text.slice(0, utf16Index));
}

/** UTF-16 index of a code point index. */
export function cpToUtf16(text: string, cpIndex: number): number {
  let units = 0;
  let cp = 0;
  for (const ch of text) {
    if (cp === cpIndex) return units;
    units += ch.length;
    cp++;
  }
  return units;
}

export type SpanCheck = { ok: true; spans: SpanWithText[] } | { ok: false; error: string };

/**
 * Validate spans against a text and a label set: integer offsets inside the text, known
 * labels, no overlap (flat NER), no whitespace-only spans. Returns the spans sorted and
 * with `text` derived from the offsets.
 */
export function validateSpans(
  text: string,
  spans: readonly Span[],
  labels: readonly string[],
): SpanCheck {
  const chars = Array.from(text);
  const allowed = new Set(labels);
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: SpanWithText[] = [];
  let prevEnd = -1;
  for (const s of sorted) {
    if (!Number.isInteger(s.start) || !Number.isInteger(s.end)) {
      return { ok: false, error: 'span offsets must be integers' };
    }
    if (s.start < 0 || s.end > chars.length || s.end <= s.start) {
      return {
        ok: false,
        error: `span [${s.start}, ${s.end}) does not fit a text of ${chars.length} characters`,
      };
    }
    if (!allowed.has(s.label)) {
      return { ok: false, error: `unknown label "${s.label}"` };
    }
    if (s.start < prevEnd) {
      return { ok: false, error: `span [${s.start}, ${s.end}) overlaps the previous span` };
    }
    const surface = chars.slice(s.start, s.end).join('');
    if (surface.trim() === '') {
      return { ok: false, error: `span [${s.start}, ${s.end}) covers only whitespace` };
    }
    out.push({ start: s.start, end: s.end, label: s.label, text: surface });
    prevEnd = s.end;
  }
  return { ok: true, spans: out };
}

/** Attach `text` to spans that are already known to be valid for `text`. */
export function withText(text: string, spans: readonly Span[]): SpanWithText[] {
  const chars = Array.from(text);
  return [...spans]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((s) => ({
      start: s.start,
      end: s.end,
      label: s.label,
      text: chars.slice(s.start, s.end).join(''),
    }));
}

/** The order spans are kept in: by start, then end, then label. */
export function compareSpans(a: Span, b: Span): number {
  return a.start - b.start || a.end - b.end || a.label.localeCompare(b.label);
}

/** Order-independent identity of a span set. */
export function spanSetKey(spans: readonly Span[]): string {
  return [...spans]
    .sort(compareSpans)
    .map((s) => `${s.start}:${s.end}:${s.label}`)
    .join('|');
}

export function spansEqual(a: readonly Span[], b: readonly Span[]): boolean {
  return spanSetKey(a) === spanSetKey(b);
}

export function spansOverlap(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

export interface EntityGuess {
  text: string;
  label: string;
}

export interface AlignResult {
  spans: SpanWithText[];
  /** Entities whose surface text does not occur in the input (the model made it up or reworded it). */
  unaligned: EntityGuess[];
  /** Entities that occur, but only where another entity was already placed. */
  conflicts: EntityGuess[];
}

/**
 * Place model-proposed entities onto the text. The model reports surface strings, never
 * offsets; offsets are computed here. Entities are matched in the order given, each one
 * searched from the end of the previous match so repeated mentions land on successive
 * occurrences, falling back to any non-overlapping occurrence. Nothing is silently
 * dropped: every entity ends up in `spans`, `unaligned` or `conflicts`.
 */
export function alignEntities(
  text: string,
  entities: readonly EntityGuess[],
  labels: readonly string[],
): AlignResult {
  const allowed = new Set(labels);
  const spans: SpanWithText[] = [];
  const unaligned: EntityGuess[] = [];
  const conflicts: EntityGuess[] = [];
  let cursor = 0; // UTF-16 index

  const place = (utf16Pos: number, surface: string, label: string): boolean => {
    const start = utf16ToCp(text, utf16Pos);
    const end = start + cpLength(surface);
    if (spans.some((s) => start < s.end && s.start < end)) return false;
    spans.push({ start, end, label, text: surface });
    return true;
  };

  for (const entity of entities) {
    const surface = typeof entity.text === 'string' ? entity.text : '';
    if (surface.trim() === '' || !allowed.has(entity.label)) {
      unaligned.push(entity);
      continue;
    }
    const candidates = surface === surface.trim() ? [surface] : [surface, surface.trim()];
    let placed = false;
    let occurs = false;
    for (const s of candidates) {
      const sequential = text.indexOf(s, cursor);
      if (sequential !== -1) {
        occurs = true;
        if (place(sequential, s, entity.label)) {
          cursor = sequential + s.length;
          placed = true;
          break;
        }
      }
      let p = text.indexOf(s);
      while (p !== -1) {
        occurs = true;
        if (place(p, s, entity.label)) {
          placed = true;
          break;
        }
        p = text.indexOf(s, p + 1);
      }
      if (placed) break;
    }
    if (!placed) (occurs ? conflicts : unaligned).push(entity);
  }

  spans.sort((a, b) => a.start - b.start);
  return { spans, unaligned, conflicts };
}

/**
 * Re-anchor a span whose stored offsets no longer point at its stored text, by finding the
 * text in the item. Prefers the nearest occurrence at or before the claimed start: the one
 * known way offsets went wrong in v1 (the selection code counting label badges as text)
 * could only push them later, never earlier.
 */
export function reanchorSpan(
  text: string,
  span: { start: number; label: string; text: string },
): Span | null {
  if (!span.text) return null;
  const occurrences: number[] = [];
  let p = text.indexOf(span.text);
  while (p !== -1) {
    occurrences.push(utf16ToCp(text, p));
    p = text.indexOf(span.text, p + 1);
  }
  if (occurrences.length === 0) return null;
  const before = occurrences.filter((o) => o <= span.start);
  const pool = before.length > 0 ? before : occurrences;
  const best = pool.reduce((a, b) => (Math.abs(b - span.start) < Math.abs(a - span.start) ? b : a));
  return { start: best, end: best + cpLength(span.text), label: span.label };
}

/** Canonical form used to detect duplicate items on import. */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim();
}
