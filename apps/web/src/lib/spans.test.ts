import { describe, expect, it } from 'vitest';
import { rangeFromSelection, segment, trimRange } from './spans';

/** Render text the way the NER canvas does: one element per code point, badges without data-i. */
function render(text: string, badgeAfter?: number): HTMLElement {
  const root = document.createElement('div');
  Array.from(text).forEach((ch, i) => {
    const el = document.createElement('span');
    el.dataset.i = String(i);
    el.textContent = ch;
    root.appendChild(el);
    if (badgeAfter === i) {
      const badge = document.createElement('sup');
      badge.textContent = 'ORG ×'; // the kind of decoration v1 counted as text
      root.appendChild(badge);
    }
  });
  document.body.appendChild(root);
  return root;
}

function select(root: HTMLElement, from: number, to: number) {
  const nodes = root.querySelectorAll<HTMLElement>('[data-i]');
  const range = document.createRange();
  range.setStart(nodes[from]!.firstChild!, 0);
  range.setEnd(nodes[to - 1]!.firstChild!, 1);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return sel;
}

describe('rangeFromSelection', () => {
  it('reads offsets from data-i, not from rendered text length', () => {
    // "该组织成立于2023年": a badge follows "该组织" (index 2); select "2023年" (6..11).
    const root = render('该组织成立于2023年', 2);
    const sel = select(root, 6, 11);
    expect(sel.toString()).toContain('2023年');
    expect(rangeFromSelection(root, sel)).toEqual({ start: 6, end: 11 });
  });

  it('counts an emoji as one position', () => {
    const root = render('a😀北京');
    expect(rangeFromSelection(root, select(root, 2, 4))).toEqual({ start: 2, end: 4 });
  });

  it('ignores selections outside the container', () => {
    const root = render('abc');
    const other = render('xyz');
    expect(rangeFromSelection(root, select(other, 0, 2))).toBeNull();
  });
});

describe('helpers', () => {
  it('trims whitespace off a range', () => {
    expect(trimRange(Array.from('  hi  '), { start: 0, end: 6 })).toEqual({ start: 2, end: 4 });
    expect(trimRange(Array.from('   '), { start: 0, end: 3 })).toBeNull();
  });

  it('segments text around spans and uncovered drafts', () => {
    const segs = segment(
      10,
      [{ start: 2, end: 4, label: 'A' }],
      [
        { start: 3, end: 5, label: 'B' },
        { start: 6, end: 8, label: 'C' },
      ],
    );
    expect(segs.map((s) => [s.kind, s.start, s.end])).toEqual([
      ['text', 0, 2],
      ['span', 2, 4],
      ['text', 4, 6],
      ['draft', 6, 8],
      ['text', 8, 10],
    ]);
  });
});
