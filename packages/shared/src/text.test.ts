import { describe, expect, it } from 'vitest';
import {
  alignEntities,
  cpLength,
  cpSlice,
  cpToUtf16,
  normalizeText,
  reanchorSpan,
  spansEqual,
  utf16ToCp,
  validateSpans,
} from './text';

describe('code point helpers', () => {
  const text = 'a😀b中文';

  it('count code points, not UTF-16 units', () => {
    expect(text.length).toBe(6);
    expect(cpLength(text)).toBe(5);
    expect(cpSlice(text, 1, 3)).toBe('😀b');
  });

  it('convert between UTF-16 and code point indices', () => {
    expect(utf16ToCp(text, 3)).toBe(2); // after the emoji
    expect(cpToUtf16(text, 2)).toBe(3);
    expect(cpToUtf16(text, 5)).toBe(6);
  });
});

describe('validateSpans', () => {
  const text = '张伟在北京工作';
  const labels = ['PER', 'LOC'];

  it('accepts valid spans, sorts them and derives their text from the offsets', () => {
    const result = validateSpans(
      text,
      [
        { start: 3, end: 5, label: 'LOC' },
        { start: 0, end: 2, label: 'PER' },
      ],
      labels,
    );
    expect(result).toEqual({
      ok: true,
      spans: [
        { start: 0, end: 2, label: 'PER', text: '张伟' },
        { start: 3, end: 5, label: 'LOC', text: '北京' },
      ],
    });
  });

  it('rejects offsets past the end of the text', () => {
    // The shape of v1's corrupted spans: offsets inflated by the width of label badges.
    const result = validateSpans(text, [{ start: 7, end: 9, label: 'LOC' }], labels);
    expect(result.ok).toBe(false);
  });

  it('rejects overlaps, unknown labels and whitespace-only spans', () => {
    expect(
      validateSpans(
        text,
        [
          { start: 0, end: 3, label: 'PER' },
          { start: 2, end: 5, label: 'LOC' },
        ],
        labels,
      ).ok,
    ).toBe(false);
    expect(validateSpans(text, [{ start: 0, end: 2, label: 'ORG' }], labels).ok).toBe(false);
    expect(validateSpans('a  b', [{ start: 1, end: 3, label: 'PER' }], labels).ok).toBe(false);
  });

  it('counts emoji as one character', () => {
    const result = validateSpans('I ❤️ 北京', [{ start: 5, end: 7, label: 'LOC' }], labels);
    // "I", " ", "❤", "️", " ", "北", "京"
    expect(result).toEqual({ ok: true, spans: [{ start: 5, end: 7, label: 'LOC', text: '北京' }] });
  });
});

describe('alignEntities', () => {
  const labels = ['PER', 'LOC', 'ORG'];

  it('places repeated mentions on successive occurrences', () => {
    const text = '北京很大，我爱北京';
    const { spans, unaligned, conflicts } = alignEntities(
      text,
      [
        { text: '北京', label: 'LOC' },
        { text: '北京', label: 'LOC' },
      ],
      labels,
    );
    expect(spans.map((s) => [s.start, s.end])).toEqual([
      [0, 2],
      [7, 9],
    ]);
    expect(unaligned).toEqual([]);
    expect(conflicts).toEqual([]);
  });

  it('reports entities that are not in the text instead of dropping them', () => {
    const { spans, unaligned } = alignEntities(
      '张伟在腾讯工作',
      [
        { text: '张伟', label: 'PER' },
        { text: '阿里巴巴', label: 'ORG' },
      ],
      labels,
    );
    expect(spans).toHaveLength(1);
    expect(unaligned).toEqual([{ text: '阿里巴巴', label: 'ORG' }]);
  });

  it('reports overlapping proposals as conflicts', () => {
    const { spans, conflicts } = alignEntities(
      '北京大学',
      [
        { text: '北京大学', label: 'ORG' },
        { text: '北京', label: 'LOC' },
      ],
      labels,
    );
    expect(spans).toEqual([{ start: 0, end: 4, label: 'ORG', text: '北京大学' }]);
    expect(conflicts).toEqual([{ text: '北京', label: 'LOC' }]);
  });

  it('rejects labels outside the label set and uses code point offsets', () => {
    const { spans, unaligned } = alignEntities(
      '😀 Alice met Bob',
      [
        { text: 'Alice', label: 'PER' },
        { text: 'Bob', label: 'CITY' },
      ],
      labels,
    );
    expect(spans).toEqual([{ start: 2, end: 7, label: 'PER', text: 'Alice' }]);
    expect(unaligned).toEqual([{ text: 'Bob', label: 'CITY' }]);
  });

  it('trims padded surface strings when the padded form does not occur', () => {
    const { spans } = alignEntities('在上海出差', [{ text: ' 上海 ', label: 'LOC' }], labels);
    expect(spans).toEqual([{ start: 1, end: 3, label: 'LOC', text: '上海' }]);
  });
});

describe('reanchorSpan', () => {
  it('moves an inflated span back onto its text', () => {
    // A 10-character sentence with a span stored at [10, 12) — past the end — whose text
    // does occur earlier. This is the pattern found in the v1 database.
    const text = '那段岁月让我成长了';
    const fixed = reanchorSpan(text, { start: 10, label: 'TIME', text: '岁月' });
    expect(fixed).toEqual({ start: 2, end: 4, label: 'TIME' });
  });

  it('prefers the nearest occurrence at or before the claimed start', () => {
    const text = '年龄，年龄，年龄';
    expect(reanchorSpan(text, { start: 4, label: 'AGE', text: '年龄' })).toEqual({
      start: 3,
      end: 5,
      label: 'AGE',
    });
  });

  it('returns null when the text is not there', () => {
    expect(reanchorSpan('abc', { start: 0, label: 'X', text: 'zz' })).toBeNull();
  });
});

describe('misc', () => {
  it('compares span sets regardless of order', () => {
    expect(
      spansEqual(
        [
          { start: 3, end: 5, label: 'LOC' },
          { start: 0, end: 2, label: 'PER' },
        ],
        [
          { start: 0, end: 2, label: 'PER' },
          { start: 3, end: 5, label: 'LOC' },
        ],
      ),
    ).toBe(true);
  });

  it('normalises width and whitespace for duplicate detection', () => {
    expect(normalizeText('  ＡＢＣ   1２3\n')).toBe('ABC 123');
  });
});
