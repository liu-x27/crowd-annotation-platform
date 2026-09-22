import type { LabelDef, Span } from '@crowd/shared';
import { Check, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  type CSSProperties,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { LabelChip, useLabelLookup } from '../../components/labels';
import { Kbd } from '../../components/ui/display';
import { useI18n } from '../../i18n';
import { overlaps, rangeFromSelection, sameSpan, segment, trimRange } from '../../lib/spans';
import { cn } from '../../lib/utils';

export interface NerCanvasHandle {
  /** Apply a label to the pending selection, or relabel the selected span. Returns true if it did something. */
  applyLabel(label: string): boolean;
  removeSelected(): boolean;
  clear(): boolean;
  acceptAllDrafts(): void;
}

/**
 * Text you can mark up. Every code point is its own element with a data-i index; the
 * offsets of a selection are read from those indices (see lib/spans.ts), so the badges and
 * highlights drawn around entities never affect them.
 */
export const NerCanvas = forwardRef<
  NerCanvasHandle,
  {
    text: string;
    labels: LabelDef[];
    spans: Span[];
    onChange(spans: Span[]): void;
    drafts?: Span[];
    readOnly?: boolean;
    size?: 'md' | 'lg';
  }
>(function NerCanvas({ text, labels, spans, onChange, drafts = [], readOnly, size = 'lg' }, ref) {
  const { t } = useI18n();
  const lookup = useLabelLookup(labels);
  const container = useRef<HTMLDivElement>(null);
  const chars = Array.from(text);
  const [pending, setPending] = useState<{
    start: number;
    end: number;
    x: number;
    y: number;
  } | null>(null);
  const [selected, setSelected] = useState<Span | null>(null);

  const add = useCallback(
    (span: Span) => {
      if (spans.some((s) => overlaps(s, span))) {
        toast.error(t('annotate.overlap'));
        return false;
      }
      onChange([...spans, span].sort((a, b) => a.start - b.start));
      return true;
    },
    [spans, onChange, t],
  );

  useImperativeHandle(
    ref,
    () => ({
      applyLabel(label) {
        if (pending) {
          const ok = add({ start: pending.start, end: pending.end, label });
          setPending(null);
          window.getSelection()?.removeAllRanges();
          return ok;
        }
        if (selected) {
          onChange(spans.map((s) => (sameSpan(s, selected) ? { ...s, label } : s)));
          setSelected({ ...selected, label });
          return true;
        }
        return false;
      },
      removeSelected() {
        if (!selected) return false;
        onChange(spans.filter((s) => !sameSpan(s, selected)));
        setSelected(null);
        return true;
      },
      clear() {
        if (!pending && !selected) return false;
        setPending(null);
        setSelected(null);
        window.getSelection()?.removeAllRanges();
        return true;
      },
      acceptAllDrafts() {
        const accepted = [...spans];
        for (const d of drafts) if (!accepted.some((s) => overlaps(s, d))) accepted.push(d);
        onChange(accepted.sort((a, b) => a.start - b.start));
      },
    }),
    [pending, selected, spans, drafts, onChange, add],
  );

  // A new item resets transient state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the text is the trigger, not an input
  useEffect(() => {
    setPending(null);
    setSelected(null);
  }, [text]);

  const onMouseUp = () => {
    if (readOnly || !container.current) return;
    const raw = rangeFromSelection(container.current, window.getSelection());
    const r = raw && trimRange(chars, raw);
    if (!r) return;
    const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    const box = container.current.getBoundingClientRect();
    setSelected(null);
    setPending({ ...r, x: rect.left - box.left + rect.width / 2, y: rect.bottom - box.top + 6 });
  };

  const segments = segment(chars.length, spans, readOnly ? [] : drafts);
  const glyphs = (start: number, end: number) =>
    chars.slice(start, end).map((ch, k) => (
      <span key={start + k} data-i={start + k}>
        {ch}
      </span>
    ));

  return (
    <div className="relative">
      <div
        ref={container}
        onMouseUp={onMouseUp}
        className={cn(
          'leading-[2.6] break-words whitespace-pre-wrap text-ink selection:bg-accent/25',
          size === 'lg' ? 'text-[20px]' : 'text-[16px]',
          !readOnly && 'cursor-text',
        )}
      >
        {segments.map((seg) => {
          if (seg.kind === 'text') return glyphs(seg.start, seg.end);
          const span = seg.span!;
          const { color } = lookup(span.label);
          const isSelected = selected && sameSpan(selected, span);
          const isDraft = seg.kind === 'draft';
          return (
            <span
              key={`${seg.kind}-${seg.start}-${span.label}`}
              className={cn(
                'relative mx-[1px] rounded-[3px] px-[1px] transition-shadow',
                isDraft ? 'mark-draft cursor-pointer' : 'mark',
                isSelected && 'ring-2 ring-offset-1 ring-offset-surface',
              )}
              style={{ '--c': color, '--tw-ring-color': color } as CSSProperties}
              onMouseDown={(e) => {
                if (readOnly) return;
                // Clicking a mark selects it (or accepts a draft) instead of starting a text selection.
                if (window.getSelection()?.isCollapsed !== false) {
                  e.preventDefault();
                  if (isDraft) add(span);
                  else setSelected(isSelected ? null : span);
                  setPending(null);
                }
              }}
              title={isDraft ? `${span.label} · ${t('annotate.draft')}` : span.label}
            >
              {glyphs(seg.start, seg.end)}
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none absolute -top-[13px] left-0 rounded-[3px] px-1 text-[9.5px] leading-[13px] font-semibold tracking-wide whitespace-nowrap select-none',
                  isDraft ? 'border border-dashed bg-surface text-ink-2' : 'text-white',
                )}
                style={isDraft ? { borderColor: color } : { background: color }}
              >
                {span.label}
              </span>
            </span>
          );
        })}
      </div>

      <AnimatePresence>
        {pending && !readOnly && (
          <motion.div
            className="absolute z-20 flex max-w-sm -translate-x-1/2 flex-wrap items-center gap-1 rounded-xl border border-line bg-surface p-1.5 shadow-float"
            style={{ left: pending.x, top: pending.y }}
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {labels.map((l) => (
              <button
                key={l.name}
                type="button"
                onClick={() => {
                  add({ start: pending.start, end: pending.end, label: l.name });
                  setPending(null);
                  window.getSelection()?.removeAllRanges();
                }}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-ink hover:bg-surface-2"
              >
                <span
                  className="size-2 rounded-full"
                  style={{ background: lookup(l.name).color }}
                />
                {l.name}
                {l.hotkey && <Kbd className="h-4 min-w-4 text-[9.5px]">{l.hotkey}</Kbd>}
              </button>
            ))}
            <button
              type="button"
              className="rounded-lg p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
              onClick={() => setPending(null)}
              aria-label={t('common.cancel')}
            >
              <X className="size-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

/** The entities of an answer as removable chips, in text order. */
export function EntityList({
  text,
  labels,
  spans,
  onChange,
  drafts = [],
  onAcceptAll,
}: {
  text: string;
  labels: LabelDef[];
  spans: Span[];
  onChange?(spans: Span[]): void;
  drafts?: Span[];
  onAcceptAll?(): void;
}) {
  const { t } = useI18n();
  const lookup = useLabelLookup(labels);
  const chars = Array.from(text);
  const pendingDrafts = drafts.filter((d) => !spans.some((s) => overlaps(s, d)));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-7 flex-wrap items-center gap-1.5">
        {spans.length === 0 && (
          <span className="text-[13px] text-ink-3">{t('annotate.noEntities')}</span>
        )}
        {spans.map((s) => (
          <LabelChip
            key={`${s.start}-${s.end}`}
            name={
              <>
                <span className="text-ink-3">{s.label}</span> {chars.slice(s.start, s.end).join('')}
              </>
            }
            color={lookup(s.label).color}
            suffix={
              onChange && (
                <button
                  type="button"
                  className="-mr-1 rounded p-0.5 text-ink-3 hover:bg-surface-3 hover:text-ink"
                  onClick={() => onChange(spans.filter((x) => !sameSpan(x, s)))}
                  aria-label={t('common.remove')}
                >
                  <X className="size-3" />
                </button>
              )
            }
          />
        ))}
      </div>
      {pendingDrafts.length > 0 && onAcceptAll && (
        <button
          type="button"
          onClick={onAcceptAll}
          className="flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-line-2 px-2.5 py-1 text-xs text-ink-2 transition-colors hover:border-accent hover:text-accent"
        >
          <Check className="size-3.5" />
          {t('annotate.acceptDraft')} · {t('annotate.suggestions', { n: pendingDrafts.length })}
          <Kbd className="ml-1 h-4 min-w-4 text-[9.5px]">A</Kbd>
        </button>
      )}
    </div>
  );
}
