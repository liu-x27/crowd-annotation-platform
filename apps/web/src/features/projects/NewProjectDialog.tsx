import { labelsFromNames, type ProjectType } from '@crowd/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Highlighter, Tags } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Field, Input, Textarea } from '../../components/ui/form';
import { Dialog } from '../../components/ui/overlay';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { qk } from '../../lib/queries';
import { cn } from '../../lib/utils';
import { type EditableLabel, LabelEditor } from './LabelEditor';

const TEMPLATES: Record<string, { type: ProjectType; labels: string[] }> = {
  sentiment: { type: 'classification', labels: ['positive', 'negative', 'neutral'] },
  topics: {
    type: 'classification',
    labels: ['sports', 'finance', 'tech', 'entertainment', 'education'],
  },
  ner: { type: 'ner', labels: ['PER', 'ORG', 'LOC'] },
};

export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ProjectType>('classification');
  const [labels, setLabels] = useState<EditableLabel[]>([]);

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setType('classification');
      setLabels(labelsFromNames(TEMPLATES.sentiment!.labels));
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () =>
      api.projects.create({
        name: name.trim(),
        description,
        type,
        labels: labels.map(({ original: _, ...l }) => l),
      }),
    onSuccess: (project) => {
      void qc.invalidateQueries({ queryKey: qk.projects });
      toast.success(t('project.created'));
      onOpenChange(false);
      navigate(`/projects/${project.id}/data?import=1`);
    },
    onError: (e) => toast.error(e.message),
  });

  const applyTemplate = (key: string) => {
    if (key === 'blank') {
      setLabels([]);
      return;
    }
    const tpl = TEMPLATES[key]!;
    setType(tpl.type);
    setLabels(labelsFromNames(tpl.labels));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('project.newTitle')}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={!name.trim() || labels.length === 0}
          >
            {t('project.create')}
          </Button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-4">
          <Field label={t('project.name')} htmlFor="p-name">
            <Input
              id="p-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('project.namePlaceholder')}
            />
          </Field>
          <Field
            label={t('project.description')}
            htmlFor="p-desc"
            aside={<span className="text-xs text-ink-3">{t('common.optional')}</span>}
          >
            <Textarea
              id="p-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label={t('project.type')}>
            <div className="grid grid-cols-2 gap-2">
              {(['classification', 'ner'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setType(k)}
                  className={cn(
                    'flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-colors',
                    type === k ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-2',
                  )}
                >
                  {k === 'classification' ? (
                    <Tags className="size-4 text-ink-2" />
                  ) : (
                    <Highlighter className="size-4 text-ink-2" />
                  )}
                  <span className="text-[13px] font-medium text-ink">
                    {t(`project.types.${k}`)}
                  </span>
                  <span className="text-xs leading-snug text-ink-3">
                    {t(`project.typeHelp.${k}`)}
                  </span>
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div className="flex flex-col gap-3">
          <Field label={t('project.template')}>
            <div className="flex flex-wrap gap-1.5">
              {(['blank', 'sentiment', 'topics', 'ner'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => applyTemplate(k)}
                  className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 transition-colors hover:border-line-2 hover:text-ink"
                >
                  {t(`project.templates.${k}`)}
                </button>
              ))}
            </div>
          </Field>
          <Field
            label={type === 'ner' ? t('project.entityTypes') : t('project.labels')}
            hint={t('project.labelsHint')}
          >
            <LabelEditor labels={labels} onChange={setLabels} entity={type === 'ner'} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
