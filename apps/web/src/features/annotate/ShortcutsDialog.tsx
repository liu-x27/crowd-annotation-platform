import type { ProjectType } from '@crowd/shared';
import { Kbd } from '../../components/ui/display';
import { Dialog } from '../../components/ui/overlay';
import { useI18n } from '../../i18n';

export function ShortcutsDialog({
  open,
  onOpenChange,
  type,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
  type: ProjectType;
}) {
  const { t } = useI18n();
  const rows: [string[], string][] =
    type === 'classification'
      ? [
          [['1', '…', '9'], t('annotate.keys.label')],
          [['Enter'], t('annotate.keys.submit')],
          [['Backspace'], t('annotate.keys.back')],
          [['S'], t('annotate.keys.skip')],
          [['F'], t('annotate.keys.flag')],
          [['G'], t('annotate.keys.guidelines')],
          [['?'], t('annotate.keys.help')],
        ]
      : [
          [['1', '…', '9'], t('annotate.keys.label')],
          [['A'], t('annotate.keys.accept')],
          [['Delete'], t('annotate.keys.remove')],
          [['Esc'], t('annotate.keys.clear')],
          [['Enter'], t('annotate.keys.submit')],
          [['Backspace'], t('annotate.keys.back')],
          [['S'], t('annotate.keys.skip')],
          [['F'], t('annotate.keys.flag')],
          [['G'], t('annotate.keys.guidelines')],
          [['?'], t('annotate.keys.help')],
        ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('annotate.shortcuts')}>
      <dl className="flex flex-col divide-y divide-line">
        {rows.map(([keys, label]) => (
          <div key={label} className="flex items-center justify-between py-2.5 text-[13px]">
            <dt className="text-ink-2">{label}</dt>
            <dd className="flex items-center gap-1">
              {keys.map((k) =>
                k === '…' ? (
                  <span key={k} className="text-ink-3">
                    …
                  </span>
                ) : (
                  <Kbd key={k}>{k}</Kbd>
                ),
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
