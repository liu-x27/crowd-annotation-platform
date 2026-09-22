import {
  DEFAULT_HOTKEYS,
  LABEL_PALETTE,
  type LabelDefInput,
  RESERVED_HOTKEYS,
} from '@crowd/shared';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import { useLabelColor } from '../../components/labels';
import { Button, IconButton } from '../../components/ui/button';
import { Input } from '../../components/ui/form';
import { Popover } from '../../components/ui/overlay';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/utils';

export interface EditableLabel extends LabelDefInput {
  /** The name this label had when loaded, for rename tracking. Absent for new labels. */
  original?: string;
}

export function nextHotkey(labels: EditableLabel[]): string | null {
  const used = new Set(labels.map((l) => l.hotkey));
  return DEFAULT_HOTKEYS.find((k) => !used.has(k)) ?? null;
}

export function nextColor(labels: EditableLabel[]): string {
  const used = new Set(labels.map((l) => l.color.toLowerCase()));
  return (
    LABEL_PALETTE.find((c) => !used.has(c)) ?? LABEL_PALETTE[labels.length % LABEL_PALETTE.length]!
  );
}

/** Edit an ordered list of labels: colour, name, hotkey and (optionally) a description. */
export function LabelEditor({
  labels,
  onChange,
  withDescriptions = false,
  entity = false,
}: {
  labels: EditableLabel[];
  onChange(labels: EditableLabel[]): void;
  withDescriptions?: boolean;
  entity?: boolean;
}) {
  const { t } = useI18n();
  const display = useLabelColor();
  const [draft, setDraft] = useState('');
  const [dragging, setDragging] = useState<number | null>(null);

  const update = (i: number, patch: Partial<EditableLabel>) =>
    onChange(labels.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const add = () => {
    const name = draft.trim();
    if (!name || labels.some((l) => l.name === name)) return;
    onChange([
      ...labels,
      { name, color: nextColor(labels), hotkey: nextHotkey(labels), description: '' },
    ]);
    setDraft('');
  };
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...labels];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  };
  const dupNames = new Set(labels.map((l) => l.name).filter((n, i, all) => all.indexOf(n) !== i));
  const dupKeys = new Set(
    labels.map((l) => l.hotkey).filter((k, i, all) => k && all.indexOf(k) !== i),
  );

  return (
    <div className="flex flex-col gap-1.5">
      {labels.map((l, i) => (
        <div
          key={l.original ?? `new-${i}`}
          draggable
          onDragStart={() => setDragging(i)}
          onDragOver={(e) => {
            e.preventDefault();
            if (dragging != null && dragging !== i) {
              move(dragging, i);
              setDragging(i);
            }
          }}
          onDragEnd={() => setDragging(null)}
          className={cn('group flex items-start gap-2 rounded-lg', dragging === i && 'opacity-50')}
        >
          <GripVertical className="mt-2.5 size-4 shrink-0 cursor-grab text-ink-3 opacity-0 group-hover:opacity-100" />
          <Popover
            trigger={
              <button
                type="button"
                className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface hover:border-line-2"
                aria-label={t('settings.color')}
              >
                <span className="size-3.5 rounded-full" style={{ background: display(l.color) }} />
              </button>
            }
          >
            <div className="grid grid-cols-4 gap-1.5">
              {LABEL_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => update(i, { color: c })}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-lg border',
                    l.color === c ? 'border-ink' : 'border-transparent hover:border-line-2',
                  )}
                >
                  <span className="size-4 rounded-full" style={{ background: display(c) }} />
                </button>
              ))}
            </div>
          </Popover>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex gap-2">
              <Input
                value={l.name}
                onChange={(e) => update(i, { name: e.target.value })}
                className={cn('h-9 flex-1', dupNames.has(l.name) && 'border-danger')}
                placeholder={t('settings.labelName')}
                style={{ '--c': display(l.color) } as CSSProperties}
              />
              <Input
                value={l.hotkey ?? ''}
                onChange={(e) => {
                  const k = e.target.value.slice(-1).toLowerCase();
                  update(i, {
                    hotkey:
                      /^[0-9a-z]$/.test(k) && !(RESERVED_HOTKEYS as readonly string[]).includes(k)
                        ? k
                        : null,
                  });
                }}
                className={cn(
                  'h-9 w-12 text-center font-mono',
                  dupKeys.has(l.hotkey ?? '') && 'border-danger',
                )}
                aria-label={t('settings.hotkey')}
                title={t('settings.hotkey')}
              />
            </div>
            {withDescriptions && (
              <Input
                value={l.description ?? ''}
                onChange={(e) => update(i, { description: e.target.value })}
                className="h-8 text-[13px]"
                placeholder={t('settings.labelDescription')}
              />
            )}
          </div>
          <IconButton
            label={t('common.remove')}
            className="mt-0.5"
            onClick={() => onChange(labels.filter((_, j) => j !== i))}
          >
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      ))}
      <div className="mt-1 flex gap-2 pl-6">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={entity ? 'PER, ORG, LOC…' : t('settings.addLabel')}
          className="h-9 flex-1"
        />
        <Button onClick={add} icon={<Plus className="size-4" />} disabled={!draft.trim()}>
          {t('common.add')}
        </Button>
      </div>
    </div>
  );
}
