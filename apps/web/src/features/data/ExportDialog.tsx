import type { ExportFormat, ExportLabelSet } from '@crowd/shared';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Field, Segmented, Switch } from '../../components/ui/form';
import { Dialog } from '../../components/ui/overlay';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { cn, download } from '../../lib/utils';
import { useProjectContext } from '../projects/ProjectLayout';

export function ExportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
}) {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const [format, setFormat] = useState<ExportFormat>('jsonl');
  const [labels, setLabels] = useState<ExportLabelSet>('final');
  const [onlyFinalized, setOnlyFinalized] = useState(true);
  const [includeMeta, setIncludeMeta] = useState(false);

  const formats: { value: ExportFormat; label: string }[] = [
    { value: 'jsonl', label: 'JSONL' },
    { value: 'csv', label: 'CSV' },
    ...(project.type === 'ner' ? [{ value: 'conll' as const, label: 'CoNLL' }] : []),
  ];
  const sets: ExportLabelSet[] = ['final', 'human', 'llm', 'import', 'all'];
  const allowed = (s: ExportLabelSet) =>
    format === 'conll' ? s === 'final' : format === 'csv' ? s !== 'all' : true;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('export.title')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            icon={<Download className="size-4" />}
            onClick={() => {
              download(
                api.exportUrl(project.id, {
                  format,
                  labels: allowed(labels) ? labels : 'final',
                  onlyFinalized,
                  includeMeta,
                }),
              );
              onOpenChange(false);
            }}
          >
            {t('export.download')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field
          label={t('export.format')}
          hint={format === 'conll' ? t('export.conllHelp') : undefined}
        >
          <Segmented
            value={format}
            onChange={(f) => {
              setFormat(f);
              if (f === 'conll') setLabels('final');
              if (f === 'csv' && labels === 'all') setLabels('final');
            }}
            options={formats}
          />
        </Field>
        <Field label={t('export.labels')}>
          <div className="flex flex-col gap-1.5">
            {sets.map((s) => (
              <button
                key={s}
                type="button"
                disabled={!allowed(s)}
                onClick={() => setLabels(s)}
                className={cn(
                  'flex flex-col rounded-xl border px-3.5 py-2.5 text-left transition-colors disabled:opacity-40',
                  labels === s ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-2',
                )}
              >
                <span className="text-[13px] font-medium text-ink">{t(`export.sets.${s}`)}</span>
                <span className="text-xs text-ink-3">{t(`export.setHelp.${s}`)}</span>
              </button>
            ))}
          </div>
        </Field>
        <div className="flex flex-col gap-3">
          <Switch
            checked={onlyFinalized}
            onChange={setOnlyFinalized}
            label={t('export.onlyFinalized')}
          />
          <Switch
            checked={includeMeta}
            onChange={setIncludeMeta}
            label={t('export.includeMeta')}
            disabled={format === 'conll'}
          />
        </div>
      </div>
    </Dialog>
  );
}
