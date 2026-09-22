import type { Confusion } from '@crowd/shared';
import { useState } from 'react';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/utils';
import { SrTable } from './core';

const LEVELS = 7;
const CJK = /[⺀-鿿가-힯＀-￯]/;
/** Rough rendered width of a column header at 10.5px: CJK glyphs are square, Latin ~0.6em. */
const headerWidth = (s: string) =>
  Array.from(s).reduce((w, ch) => w + (CJK.test(ch) ? 10.5 : 6.2), 0);

/**
 * Confusion matrix as a one-hue sequential heatmap. Colour encodes the share of each
 * reference row (so rare classes are as readable as common ones); the cell shows the raw
 * count. Cell text switches between ink and white by the fill's lightness, per theme (CSS).
 */
export function ConfusionHeatmap({
  confusion,
  rowTitle,
  colTitle,
}: {
  confusion: Confusion;
  rowTitle: string;
  colTitle: string;
}) {
  const { fmt } = useI18n();
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const { labels, matrix } = confusion;
  const rowSums = matrix.map((row) => row.reduce((s, v) => s + v, 0));
  const n = labels.length;
  const cell = n <= 6 ? 44 : n <= 10 ? 34 : 26;
  // Headers stay horizontal when they fit the column; otherwise they run vertically, with
  // CJK upright (its natural vertical form) and Latin turned to read bottom-up.
  const horizontal = labels.every((l) => headerWidth(l) <= cell - 6);
  const headerHeight = horizontal
    ? undefined
    : Math.min(80, Math.max(...labels.map(headerWidth)) + 8);
  const level = (share: number) =>
    share <= 0 ? -1 : Math.min(LEVELS - 1, Math.floor(share * LEVELS));

  const detail = hover
    ? `${labels[hover.r]} → ${labels[hover.c]}: ${fmt.number(matrix[hover.r]![hover.c]!)} (${fmt.percent(
        rowSums[hover.r] ? matrix[hover.r]![hover.c]! / rowSums[hover.r]! : 0,
      )})`
    : null;

  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <div
          className="inline-grid gap-[2px]"
          style={{ gridTemplateColumns: `auto repeat(${n}, ${cell}px)` }}
        >
          <div className="flex items-end justify-end pr-2 pb-1 text-[10px] font-medium tracking-wide text-ink-3 uppercase">
            {rowTitle} ↓ · {colTitle} →
          </div>
          {labels.map((l, c) => (
            <div
              key={`h${l}`}
              title={l}
              className={cn(
                'flex items-end justify-center pb-1 text-[10.5px]',
                hover?.c === c ? 'text-ink' : 'text-ink-3',
              )}
              style={{ height: headerHeight }}
            >
              {horizontal ? (
                <span className="truncate">{l}</span>
              ) : (
                <span
                  className={cn(
                    'max-h-20 truncate [writing-mode:vertical-rl]',
                    !CJK.test(l) && 'rotate-180',
                  )}
                >
                  {l}
                </span>
              )}
            </div>
          ))}
          {matrix.map((row, r) => (
            <div key={`r${labels[r]}`} className="contents">
              <div
                title={labels[r]}
                className={`flex max-w-40 items-center justify-end truncate pr-2 text-[11.5px] ${hover?.r === r ? 'text-ink' : 'text-ink-2'}`}
              >
                <span className="truncate">{labels[r]}</span>
              </div>
              {row.map((v, c) => {
                const share = rowSums[r] ? v / rowSums[r]! : 0;
                const lv = level(share);
                const isHover = hover?.r === r && hover.c === c;
                return (
                  <button
                    type="button"
                    key={c}
                    data-level={lv}
                    aria-label={`${labels[r]} → ${labels[c]}: ${v}`}
                    onPointerEnter={() => setHover({ r, c })}
                    onPointerLeave={() => setHover(null)}
                    onFocus={() => setHover({ r, c })}
                    onBlur={() => setHover(null)}
                    className="heat-cell tabular flex items-center justify-center rounded-[4px] text-[10.5px] font-medium transition-[filter]"
                    style={{
                      height: cell,
                      background: lv < 0 ? 'var(--surface-2)' : `var(--seq-${lv})`,
                      outline: r === c ? '1.5px solid var(--ink-3)' : undefined,
                      outlineOffset: -1.5,
                      filter: isHover ? 'brightness(1.08)' : undefined,
                    }}
                  >
                    {v > 0 ? (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v) : ''}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="h-5 text-xs text-ink-2">{detail}</div>
        <div className="flex items-center gap-2 text-[10.5px] text-ink-3">
          <span>0%</span>
          <div className="flex gap-[2px]">
            {Array.from({ length: LEVELS }, (_, i) => (
              <span
                key={i}
                className="h-2.5 w-4 rounded-[2px]"
                style={{ background: `var(--seq-${i})` }}
              />
            ))}
          </div>
          <span>100%</span>
        </div>
      </div>
      <SrTable
        caption={`${rowTitle} × ${colTitle}`}
        head={['', ...labels]}
        rows={matrix.map((row, r) => [labels[r]!, ...row])}
      />
    </div>
  );
}
