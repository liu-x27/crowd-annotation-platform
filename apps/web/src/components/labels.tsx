import { LABEL_PALETTE_DARK, type LabelDef } from '@crowd/shared';
import type { CSSProperties, ReactNode } from 'react';
import { useTheme } from '../lib/theme';
import { cn } from '../lib/utils';

/** The label's colour for the current theme: the dark step of a palette hue in dark mode. */
export function useLabelColor() {
  const { dark } = useTheme();
  return (hex: string | undefined) => {
    if (!hex) return 'var(--ink-3)';
    return dark ? (LABEL_PALETTE_DARK[hex.toLowerCase()] ?? hex) : hex;
  };
}

export function useLabelLookup(labels: LabelDef[]) {
  const color = useLabelColor();
  const byName = new Map(labels.map((l) => [l.name, l]));
  return (name: string | null | undefined) => {
    const def = name ? byName.get(name) : undefined;
    return { def, color: color(def?.color) };
  };
}

export function LabelChip({
  name,
  color,
  size = 'md',
  className,
  hotkey,
  suffix,
  strike,
}: {
  name: ReactNode;
  color: string;
  size?: 'sm' | 'md';
  className?: string;
  hotkey?: string | null;
  suffix?: ReactNode;
  strike?: boolean;
}) {
  return (
    <span
      className={cn(
        'chip inline-flex max-w-full items-center gap-1.5 rounded-md font-medium',
        size === 'sm' ? 'h-5 px-1.5 text-[11px]' : 'h-6 px-2 text-xs',
        strike && 'line-through opacity-60',
        className,
      )}
      style={{ '--c': color } as CSSProperties}
    >
      <span
        className={cn('chip-dot shrink-0 rounded-full', size === 'sm' ? 'size-1.5' : 'size-2')}
      />
      <span className="truncate">{name}</span>
      {hotkey && <span className="font-mono text-[10px] text-ink-3">{hotkey}</span>}
      {suffix}
    </span>
  );
}

/** A label by name, resolved against the project's label definitions. */
export function ProjectLabel({
  labels,
  name,
  size,
  className,
  strike,
  suffix,
}: {
  labels: LabelDef[];
  name: string | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
  strike?: boolean;
  suffix?: ReactNode;
}) {
  const lookup = useLabelLookup(labels);
  if (!name) return <span className="text-ink-3">—</span>;
  const { color } = lookup(name);
  return (
    <LabelChip
      name={name}
      color={color}
      size={size}
      className={className}
      strike={strike}
      suffix={suffix}
    />
  );
}
