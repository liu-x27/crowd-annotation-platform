import { describe, expect, it } from 'vitest';
import { answerKey, canonicalSpans, sameAnswer, tally } from './answers';

const per = { start: 0, end: 2, label: 'PER' };
const loc = { start: 3, end: 5, label: 'LOC' };
/** What a view carries: offsets plus the text they cover. Never stored. */
const locWithText = { ...loc, text: '北京' };

describe('answerKey', () => {
  it('ignores span order and derived text, but not offsets or labels', () => {
    const a = { label: null, spans: [per, loc] };
    expect(sameAnswer('ner', a, { label: null, spans: [loc, per] })).toBe(true);
    expect(sameAnswer('ner', a, { label: null, spans: [locWithText, per] })).toBe(true);
    expect(sameAnswer('ner', a, { label: null, spans: [per, { ...loc, end: 6 }] })).toBe(false);
    expect(sameAnswer('ner', a, { label: null, spans: [per, { ...loc, label: 'ORG' }] })).toBe(
      false,
    );
  });

  it('treats "no entities" as an answer, and a classification answer as its label', () => {
    expect(answerKey('ner', { label: null, spans: [] })).toBe(
      answerKey('ner', { label: null, spans: null }),
    );
    expect(
      sameAnswer('classification', { label: 'pos', spans: null }, { label: 'pos', spans: [] }),
    ).toBe(true);
  });
});

describe('canonicalSpans', () => {
  it('sorts, keeps only start/end/label, and is idempotent', () => {
    const once = canonicalSpans([locWithText, per]);
    expect(once).toEqual([per, loc]);
    expect(Object.keys(once[1]!)).toEqual(['start', 'end', 'label']);
    expect(canonicalSpans(once)).toEqual(once);
  });
});

describe('tally', () => {
  const ans = (label: string) => ({ label, spans: null });

  it('finds the most common answer and says when it is tied', () => {
    expect(tally('classification', [ans('pos'), ans('neg'), ans('pos')])).toMatchObject({
      top: { label: 'pos' },
      votes: 2,
      total: 3,
      tie: false,
    });
    expect(tally('classification', [ans('pos'), ans('neg')])).toMatchObject({
      votes: 1,
      tie: true,
    });
    expect(tally('classification', [])).toBeNull();
  });

  it('counts reordered span sets as one answer', () => {
    const t = tally('ner', [
      { label: null, spans: [per, loc] },
      { label: null, spans: [loc, per] },
      { label: null, spans: [per] },
    ]);
    expect(t).toMatchObject({ votes: 2, total: 3, tie: false });
  });
});
