import { useState } from 'react';
import { ChartTip, Legend, niceTicks, SrTable, useTip, useWidth } from './core';

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  points: { x: number; y: number | null }[];
}

/**
 * Lines over a shared x (epochs). One y-scale only — measures of different scale go in
 * separate charts, never on a second axis. A crosshair snaps to the nearest x and the
 * tooltip lists every series there; end values are labelled only while they do not collide.
 */
export function LineChart({
  series,
  height = 190,
  yDomain,
  yFormat = (v) => v.toFixed(2),
  xLabel,
  marker,
  caption,
}: {
  series: LineSeries[];
  height?: number;
  yDomain?: [number, number];
  yFormat?: (v: number) => string;
  xLabel: (x: number) => string;
  marker?: { x: number; label: string };
  caption: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { tip, show, hide } = useTip();
  const [hoverX, setHoverX] = useState<number | null>(null);

  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
  const values = series.flatMap((s) =>
    s.points.map((p) => p.y).filter((v): v is number => v != null),
  );
  const maxY = yDomain ? yDomain[1] : Math.max(0.0001, ...values);
  const ticks = yDomain
    ? [0, 0.25, 0.5, 0.75, 1].map((t) => yDomain[0] + t * (yDomain[1] - yDomain[0]))
    : niceTicks(maxY, 4);
  const y0 = yDomain ? yDomain[0] : 0;
  const y1 = yDomain ? yDomain[1] : ticks.at(-1)!;

  const left = 40;
  const right = 56;
  const top = 10;
  const bottom = 22;
  const plotW = Math.max(0, width - left - right);
  const plotH = height - top - bottom;
  const xMin = xs[0] ?? 0;
  const xMax = xs.at(-1) ?? 1;
  const x = (v: number) =>
    left + (xMax === xMin ? plotW / 2 : ((v - xMin) / (xMax - xMin)) * plotW);
  const y = (v: number) => top + plotH - ((v - y0) / (y1 - y0 || 1)) * plotH;

  const path = (s: LineSeries) => {
    let d = '';
    let pen = false;
    for (const p of s.points) {
      if (p.y == null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  const ends = series
    .map((s) => {
      const last = [...s.points].reverse().find((p) => p.y != null);
      return last ? { s, px: x(last.x), py: y(last.y!), v: last.y! } : null;
    })
    .filter((e): e is NonNullable<typeof e> => e != null);
  const sortedEnds = [...ends].sort((a, b) => a.py - b.py);
  const endsCollide = sortedEnds.some((e, i) => i > 0 && e.py - sortedEnds[i - 1]!.py < 13);

  const onMove = (clientX: number, rectLeft: number) => {
    if (xs.length === 0) return;
    const px = clientX - rectLeft;
    const nearest = xs.reduce((a, b) => (Math.abs(x(b) - px) < Math.abs(x(a) - px) ? b : a));
    setHoverX(nearest);
    show({
      x: x(nearest),
      y: top + 4,
      title: xLabel(nearest),
      rows: series.map((s) => {
        const p = s.points.find((q) => q.x === nearest);
        return {
          color: s.color,
          line: true,
          label: s.label,
          value: p?.y != null ? yFormat(p.y) : '—',
        };
      }),
    });
  };

  return (
    <div>
      {series.length > 1 && (
        <Legend
          className="mb-2"
          items={series.map((s) => ({ color: s.color, label: s.label, line: true }))}
        />
      )}
      <div
        ref={ref}
        className="relative"
        onPointerMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect().left)}
        onPointerLeave={() => {
          hide();
          setHoverX(null);
        }}
      >
        {width > 0 && (
          <svg width={width} height={height} className="block overflow-visible">
            {ticks.map((tk) => (
              <g key={tk}>
                <line
                  x1={left}
                  x2={left + plotW}
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
                  {yFormat(tk)}
                </text>
              </g>
            ))}
            {xs.map((v, i) =>
              i === 0 ||
              i === xs.length - 1 ||
              (xs.length <= 12 ? true : i % Math.ceil(xs.length / 8) === 0) ? (
                <text
                  key={v}
                  x={x(v)}
                  y={height - 5}
                  textAnchor="middle"
                  className="fill-ink-3 text-[10px]"
                >
                  {v}
                </text>
              ) : null,
            )}
            {marker && (
              <g>
                <line
                  x1={x(marker.x)}
                  x2={x(marker.x)}
                  y1={top}
                  y2={top + plotH}
                  stroke="var(--ink-3)"
                  strokeWidth={1}
                  opacity={0.6}
                />
                <text x={x(marker.x) + 4} y={top + 9} className="fill-ink-3 text-[10px]">
                  {marker.label}
                </text>
              </g>
            )}
            {hoverX != null && (
              <line
                x1={x(hoverX)}
                x2={x(hoverX)}
                y1={top}
                y2={top + plotH}
                stroke="var(--ink-3)"
                strokeWidth={1}
              />
            )}
            {series.map((s) => (
              <path
                key={s.key}
                d={path(s)}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {hoverX != null &&
              series.map((s) => {
                const p = s.points.find((q) => q.x === hoverX);
                return p?.y != null ? (
                  <circle
                    key={s.key}
                    cx={x(p.x)}
                    cy={y(p.y)}
                    r={4}
                    fill={s.color}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                ) : null;
              })}
            {ends.map((e) => (
              <g key={e.s.key}>
                <circle
                  cx={e.px}
                  cy={e.py}
                  r={4}
                  fill={e.s.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
                {!endsCollide && (
                  <text
                    x={e.px + 8}
                    y={e.py}
                    dy="0.32em"
                    className="fill-ink-2 text-[10.5px] font-medium"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {yFormat(e.v)}
                  </text>
                )}
              </g>
            ))}
            <line
              x1={left}
              x2={left + plotW}
              y1={y(y0)}
              y2={y(y0)}
              stroke="var(--viz-axis)"
              strokeWidth={1}
            />
          </svg>
        )}
        <ChartTip tip={tip} width={width} />
      </div>
      <SrTable
        caption={caption}
        head={['x', ...series.map((s) => s.label)]}
        rows={xs.map((v) => [
          v,
          ...series.map((s) => s.points.find((p) => p.x === v)?.y?.toFixed(4) ?? ''),
        ])}
      />
    </div>
  );
}
