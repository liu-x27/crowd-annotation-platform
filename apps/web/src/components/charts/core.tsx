import {
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

/** Width of an element, kept current with a ResizeObserver. Charts render to it. */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Clean axis ticks: 0, 1, 2, 5 × 10ⁿ steps covering [0, max]. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

export const compact = (n: number) =>
  n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString('en-US');

export interface TipRow {
  color?: string;
  line?: boolean;
  label: ReactNode;
  value: ReactNode;
}

export interface TipState {
  x: number;
  y: number;
  title?: ReactNode;
  rows: TipRow[];
}

/** One tooltip per chart: the value leads, the series name follows, keyed by a short stroke. */
export function useTip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const show = useCallback((t: TipState) => setTip(t), []);
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, hide };
}

export function ChartTip({ tip, width }: { tip: TipState | null; width: number }) {
  if (!tip) return null;
  const flip = tip.x > width - 180;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 min-w-32 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-float"
      style={{
        left: flip ? undefined : tip.x + 12,
        right: flip ? width - tip.x + 12 : undefined,
        top: Math.max(0, tip.y - 12),
      }}
    >
      {tip.title && <div className="mb-1.5 font-medium text-ink-2">{tip.title}</div>}
      <div className="flex flex-col gap-1">
        {tip.rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            {r.color && (
              <span
                className={r.line ? 'h-0.5 w-3 rounded-full' : 'size-2 rounded-sm'}
                style={{ background: r.color }}
              />
            )}
            <span className="tabular font-semibold text-ink">{r.value}</span>
            <span className="text-ink-3">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A legend that mirrors the mark: a swatch for bars, a stroke for lines. */
export function Legend({
  items,
  className,
}: {
  items: { color: string; label: ReactNode; line?: boolean }[];
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-2 ${className ?? ''}`}
    >
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span
            className={it.line ? 'h-0.5 w-3.5 rounded-full' : 'size-2.5 rounded-[3px]'}
            style={{ background: it.color }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** The table twin every chart carries for screen readers. */
export function SrTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Path for a bar whose data end is rounded (4px) and whose baseline end is square. */
export function barPath(
  x: number,
  y: number,
  w: number,
  h: number,
  dir: 'up' | 'right',
  r = 4,
): string {
  if (w <= 0 || h <= 0) return '';
  if (dir === 'up') {
    const rr = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
  }
  const rr = Math.min(r, h / 2, w);
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
}
