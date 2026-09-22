import type { ProjectCounts } from '@crowd/shared';
import { type ReactNode, useState } from 'react';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/utils';
import { Tooltip } from '../ui/overlay';
import { barPath, ChartTip, compact, niceTicks, SrTable, useTip, useWidth } from './core';

const STATES = [
  { key: 'finalized', color: 'var(--state-final)' },
  { key: 'needsReview', color: 'var(--state-review)' },
  { key: 'inProgress', color: 'var(--state-progress)' },
  { key: 'unlabeled', color: 'var(--state-track)' },
] as const;

/**
 * Where a project's items are, as one horizontal part-to-whole bar. The states are a
 * sequence, so they take one hue from light (just started) to dark (final); unlabeled is
 * the track. Segments are separated by a 2px surface gap, never a stroke.
 */
export function StateBar({
  counts,
  size = 'md',
  legend = false,
  className,
}: {
  counts: ProjectCounts;
  size?: 'sm' | 'md' | 'lg';
  legend?: boolean;
  className?: string;
}) {
  const { t, fmt } = useI18n();
  const total = counts.items || 1;
  const h = { sm: 'h-1.5', md: 'h-2.5', lg: 'h-3.5' }[size];
  const label = (k: (typeof STATES)[number]['key']) => t(`project.counts.${k}`);
  return (
    <div className={className}>
      <div
        className={cn('flex w-full gap-[2px] overflow-hidden rounded-full', h)}
        role="img"
        aria-label={t('overview.progress')}
      >
        {counts.items === 0 ? (
          <div className="h-full w-full bg-surface-3" />
        ) : (
          STATES.filter((s) => counts[s.key] > 0).map((s) => (
            <Tooltip
              key={s.key}
              content={`${label(s.key)}: ${fmt.number(counts[s.key])} (${fmt.percent(counts[s.key] / total)})`}
            >
              <div
                className="h-full min-w-[3px] transition-[flex-grow] duration-500"
                style={{ flexGrow: counts[s.key], flexBasis: 0, background: s.color }}
              />
            </Tooltip>
          ))
        )}
      </div>
      {legend && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {STATES.map((s) => (
            <div key={s.key} className="flex items-center gap-2 text-xs">
              <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
              <span className="text-ink-2">{label(s.key)}</span>
              <span className="tabular font-semibold text-ink">{fmt.number(counts[s.key])}</span>
            </div>
          ))}
        </div>
      )}
      <SrTable
        caption={t('overview.progress')}
        head={[t('data.columns.state'), t('project.counts.items')]}
        rows={STATES.map((s) => [label(s.key), counts[s.key]])}
      />
    </div>
  );
}

export interface BarRow {
  key: string;
  label: ReactNode;
  value: number;
  display?: string;
  sub?: ReactNode;
}

/**
 * Horizontal bars with the value at the tip. One series, so one colour and no legend box;
 * each row's label (a label chip, usually) carries identity.
 */
export function BarList({
  rows,
  max,
  color = 'var(--viz-1)',
  labelWidth = 'fit-content(40%)',
  empty,
}: {
  rows: BarRow[];
  max?: number;
  color?: string;
  labelWidth?: string;
  empty?: ReactNode;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <>{empty}</>;
  return (
    <div
      className="grid items-center gap-x-3 gap-y-2"
      style={{ gridTemplateColumns: `${labelWidth} 1fr auto` }}
    >
      {rows.map((r) => (
        <div key={r.key} className="contents">
          <div className="min-w-0 truncate text-[13px]">{r.label}</div>
          <div className="relative h-2.5 rounded-r-[4px]">
            <div
              className="h-full rounded-r-[4px] transition-[width] duration-500"
              style={{
                width: `${Math.max(r.value > 0 ? 0.6 : 0, (r.value / top) * 100)}%`,
                background: color,
              }}
            />
          </div>
          <div className="tabular min-w-12 text-right text-xs text-ink-2">
            {r.display ?? r.value.toLocaleString()}
            {r.sub && <span className="ml-1 text-ink-3">{r.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Daily columns over a fixed window; empty days are shown as empty, not skipped. */
export function DailyColumns({
  data,
  days = 30,
  height = 150,
  valueLabel,
}: {
  data: { day: string; submitted: number }[];
  days?: number;
  height?: number;
  valueLabel: string;
}) {
  const { fmt } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  const { tip, show, hide } = useTip();
  const [hover, setHover] = useState<number | null>(null);

  const byDay = new Map(data.map((d) => [d.day, d.submitted]));
  const series: { day: string; v: number }[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    series.push({ day: key, v: byDay.get(key) ?? 0 });
  }
  const maxV = Math.max(...series.map((s) => s.v));
  const ticks = niceTicks(maxV || 1, 3);
  const top = ticks.at(-1)!;
  const left = 34;
  const bottom = 20;
  const plotW = Math.max(0, width - left - 4);
  const plotH = height - bottom - 8;
  const band = plotW / series.length;
  const barW = Math.min(24, Math.max(2, band - 2));
  const y = (v: number) => 8 + plotH - (v / top) * plotH;
  const maxIndex = series.findIndex((s) => s.v === maxV && maxV > 0);

  return (
    <div
      ref={ref}
      className="relative"
      onPointerLeave={() => {
        hide();
        setHover(null);
      }}
    >
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible">
          {ticks.map((tk) => (
            <g key={tk}>
              <line
                x1={left}
                x2={width}
                y1={y(tk)}
                y2={y(tk)}
                stroke="var(--viz-grid)"
                strokeWidth={1}
              />
              <text
                x={left - 8}
                y={y(tk)}
                dy="0.32em"
                textAnchor="end"
                className="fill-ink-3 text-[10px]"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {compact(tk)}
              </text>
            </g>
          ))}
          {series.map((s, i) => {
            const x = left + i * band + (band - barW) / 2;
            return (
              <g key={s.day}>
                <path
                  d={barPath(x, y(s.v), barW, y(0) - y(s.v), 'up', Math.min(4, barW / 2))}
                  fill="var(--viz-1)"
                  opacity={hover != null && hover !== i ? 0.55 : 1}
                />
                <rect
                  x={left + i * band}
                  y={8}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onPointerMove={() => {
                    setHover(i);
                    show({
                      x: x + barW / 2,
                      y: y(s.v),
                      title: fmt.day(s.day),
                      rows: [{ value: fmt.number(s.v), label: valueLabel }],
                    });
                  }}
                />
                {i === maxIndex && (
                  <text
                    x={x + barW / 2}
                    y={y(s.v) - 5}
                    textAnchor="middle"
                    className="fill-ink-2 text-[10px] font-medium"
                  >
                    {compact(s.v)}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={left} x2={width} y1={y(0)} y2={y(0)} stroke="var(--viz-axis)" strokeWidth={1} />
          {[0, Math.floor(series.length / 2), series.length - 1].map((i) => (
            <text
              key={i}
              x={left + i * band + band / 2}
              y={height - 4}
              textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}
              className="fill-ink-3 text-[10px]"
            >
              {fmt.day(series[i]!.day)}
            </text>
          ))}
        </svg>
      )}
      <ChartTip tip={tip} width={width} />
      <SrTable
        caption={valueLabel}
        head={['day', valueLabel]}
        rows={series.map((s) => [s.day, s.v])}
      />
    </div>
  );
}

/**
 * A ratio against its limit. The unfilled track is a lighter step of the fill's own ramp,
 * so the whole bar reads as one quantity.
 */
export function Meter({ value, className }: { value: number | null; className?: string }) {
  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full', className)}
      style={{ background: 'var(--state-track)' }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700"
        style={{
          width: `${Math.max(0, Math.min(1, value ?? 0)) * 100}%`,
          background: 'var(--state-review)',
        }}
      />
    </div>
  );
}
