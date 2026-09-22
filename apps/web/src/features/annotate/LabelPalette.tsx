import type { LabelDef } from '@crowd/shared';
import { Bot } from 'lucide-react';
import { motion } from 'motion/react';
import type { CSSProperties } from 'react';
import { useLabelColor } from '../../components/labels';
import { Kbd } from '../../components/ui/display';
import { Tooltip } from '../../components/ui/overlay';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/utils';

/** Big, keyboard-first label buttons. The draft's suggestion is marked, never selected for you unless the project says so. */
export function LabelPalette({
  labels,
  selected,
  suggested,
  onPick,
  disabled,
  flash,
}: {
  labels: LabelDef[];
  selected: string | null;
  suggested: string | null;
  onPick(label: string): void;
  disabled?: boolean;
  flash?: string | null;
}) {
  const { t } = useI18n();
  const color = useLabelColor();
  const cols =
    labels.length <= 2
      ? 'grid-cols-2'
      : labels.length <= 6
        ? 'grid-cols-2 sm:grid-cols-3'
        : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';
  return (
    <div className={cn('grid gap-2', cols)}>
      {labels.map((l) => {
        const c = color(l.color);
        const isSel = selected === l.name;
        const isSug = suggested === l.name;
        const button = (
          <motion.button
            key={l.name}
            type="button"
            disabled={disabled}
            onClick={() => onPick(l.name)}
            animate={flash === l.name ? { scale: [1, 0.96, 1] } : { scale: 1 }}
            transition={{ duration: 0.18 }}
            className={cn(
              'group relative flex h-14 items-center gap-3 rounded-xl border bg-surface px-3.5 text-left shadow-card transition-[border-color,background,box-shadow] disabled:opacity-50',
              isSel
                ? 'border-transparent ring-2'
                : 'border-line hover:border-line-2 hover:bg-surface-2',
              isSug && !isSel && 'border-dashed border-accent/60',
            )}
            style={
              {
                '--tw-ring-color': c,
                ...(isSel ? { background: `color-mix(in oklab, ${c} 10%, var(--surface))` } : {}),
              } as CSSProperties
            }
          >
            <span className="size-3 shrink-0 rounded-full" style={{ background: c }} />
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">
              {l.name}
            </span>
            {isSug && (
              <span className="flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-accent">
                <Bot className="size-3" />
                {t('annotate.draft')}
              </span>
            )}
            {l.hotkey && <Kbd>{l.hotkey.toUpperCase()}</Kbd>}
          </motion.button>
        );
        return l.description ? (
          <Tooltip key={l.name} content={l.description}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}
