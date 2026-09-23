import type { LlmProviderId, LlmSettings, PrelabelJobInput, PreviewRow } from '@crowd/shared';
import { sameAnswer } from '@crowd/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Play, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BarList } from '../../components/charts/bars';
import { ConfusionHeatmap } from '../../components/charts/heatmap';
import { JobCard } from '../../components/jobs';
import { ProjectLabel } from '../../components/labels';
import { Button } from '../../components/ui/button';
import { Badge, Card, CardTitle, Stat } from '../../components/ui/display';
import { Field, Input, Segmented, Select, Textarea } from '../../components/ui/form';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { qk, useDraftQuality, useJobs, useProviders } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { cn } from '../../lib/utils';
import { EntityList } from '../annotate/NerCanvas';
import { useProjectContext } from '../projects/ProjectLayout';

export function LlmPage() {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const { can } = useSession();
  const qc = useQueryClient();
  const providers = useProviders();
  const jobs = useJobs(project.id);
  const [settings, setSettings] = useState<LlmSettings>(project.settings.llm);
  useEffect(() => setSettings(project.settings.llm), [project.settings.llm]);
  const provider = providers.data?.find((p) => p.id === settings.provider);
  const dirty = JSON.stringify(settings) !== JSON.stringify(project.settings.llm);

  const save = useMutation({
    mutationFn: () =>
      api.projects.update(project.id, { settings: { ...project.settings, llm: settings } }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      void qc.invalidateQueries({ queryKey: qk.project(project.id) });
    },
    onError: (e) => toast.error(e.message),
  });

  const [sample, setSample] = useState(3);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const run = useMutation({
    mutationFn: () =>
      api.llm.preview(project.id, {
        ...settings,
        ...(text.trim() ? { text: text.trim() } : { sample }),
      }),
    onSuccess: setPreview,
    onError: (e) => toast.error(e.message),
  });

  const [scope, setScope] = useState<NonNullable<PrelabelJobInput['scope']>>('missing');
  const [limit, setLimit] = useState('');
  const start = useMutation({
    mutationFn: () =>
      api.llm.start(project.id, { scope, limit: limit ? Number(limit) : undefined, ...settings }),
    onSuccess: () => {
      toast.success(t('llm.started'));
      void qc.invalidateQueries({ queryKey: qk.jobs(project.id) });
    },
    onError: (e) => toast.error(e.message),
  });

  const prelabelJobs = (jobs.data ?? []).filter((j) => j.kind === 'prelabel');
  const active = prelabelJobs.find((j) => j.status === 'running' || j.status === 'queued');

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[380px_1fr]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardTitle>{t('llm.settings')}</CardTitle>
          <div className="flex flex-col gap-4">
            <Field label={t('llm.provider')}>
              <Select<LlmProviderId>
                value={settings.provider}
                onChange={(v) => setSettings((s) => ({ ...s, provider: v, model: '' }))}
                options={(providers.data ?? []).map((p) => ({
                  value: p.id,
                  label: (
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'size-1.5 rounded-full',
                          p.available ? 'bg-success' : 'bg-ink-3',
                        )}
                      />
                      {t(`llm.providers.${p.id}`)}
                    </span>
                  ),
                  hint: p.available ? undefined : p.reason,
                }))}
              />
            </Field>
            {provider && !provider.available && (
              <p className="-mt-2 text-xs text-warning">{provider.reason}</p>
            )}
            <Field label={t('llm.model')}>
              {provider && provider.models.length > 0 ? (
                <Select
                  value={settings.model || provider.defaultModel}
                  onChange={(v) => setSettings((s) => ({ ...s, model: v }))}
                  options={provider.models.map((m) => ({
                    value: m.name,
                    label: m.name,
                    hint: m.detail ?? undefined,
                  }))}
                />
              ) : (
                <Input
                  value={settings.model}
                  onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
                  placeholder={provider?.defaultModel || t('llm.modelPlaceholder')}
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={t('llm.temperature')}
                hint={settings.provider === 'anthropic' ? t('llm.temperatureHelp') : undefined}
              >
                <Input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={settings.temperature}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, temperature: Number(e.target.value) }))
                  }
                />
              </Field>
              <Field label={t('llm.fewShot')}>
                <Input
                  type="number"
                  min={0}
                  max={16}
                  value={settings.fewShot}
                  onChange={(e) => setSettings((s) => ({ ...s, fewShot: Number(e.target.value) }))}
                />
              </Field>
            </div>
            <p className="-mt-2 text-xs leading-relaxed text-ink-3">{t('llm.fewShotHelp')}</p>
            <Field label={t('llm.instructions')}>
              <Textarea
                rows={3}
                value={settings.instructions}
                onChange={(e) => setSettings((s) => ({ ...s, instructions: e.target.value }))}
                placeholder={t('llm.instructionsPlaceholder')}
              />
            </Field>
            {can('project:manage') && (
              <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
                {t('llm.saveDefault')}
              </Button>
            )}
          </div>
        </Card>

        <Card>
          <CardTitle>{t('llm.jobTitle')}</CardTitle>
          <div className="flex flex-col gap-4">
            <Field label={t('llm.scope')}>
              <div className="grid grid-cols-2 gap-1.5">
                {(['missing', 'errors', 'unfinalized', 'all'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScope(s)}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-left text-[13px] transition-colors',
                      scope === s
                        ? 'border-accent bg-accent-soft text-ink'
                        : 'border-line text-ink-2 hover:border-line-2',
                    )}
                  >
                    {t(`llm.scopes.${s}`)}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={t('llm.limit')}>
              <Input
                type="number"
                min={1}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                placeholder={t('llm.limitPlaceholder')}
              />
            </Field>
            <Button
              variant="primary"
              icon={<Sparkles className="size-4" />}
              onClick={() => start.mutate()}
              loading={start.isPending}
              disabled={!!active}
            >
              {t('llm.start')}
            </Button>
          </div>
          <div className="mt-5 flex flex-col gap-2">
            {prelabelJobs.length === 0 ? (
              <p className="text-xs text-ink-3">{t('llm.noJobs')}</p>
            ) : (
              prelabelJobs
                .slice(0, 5)
                .map((j) => <JobCard key={j.id} job={j} compact={j.id !== active?.id} />)
            )}
          </div>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardTitle hint={t('llm.tryItHelp')}>{t('llm.tryIt')}</CardTitle>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('llm.sample')}>
              <Segmented
                value={String(sample)}
                onChange={(v) => setSample(Number(v))}
                options={['1', '3', '5'].map((v) => ({ value: v, label: v }))}
              />
            </Field>
            <Field label={t('llm.paste')} className="min-w-64 flex-1">
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('llm.pastePlaceholder')}
              />
            </Field>
            <Button
              variant="primary"
              icon={<Play className="size-4" />}
              onClick={() => run.mutate()}
              loading={run.isPending}
            >
              {run.isPending ? t('llm.running') : t('llm.run')}
            </Button>
          </div>
          {preview && (
            <div className="mt-5 flex flex-col gap-3">
              {preview.map((row, i) => (
                <PreviewCard key={`${row.itemId}-${i}`} row={row} />
              ))}
            </div>
          )}
        </Card>

        <DraftQualityCard />
      </div>
    </div>
  );
}

function PreviewCard({ row }: { row: PreviewRow }) {
  const { t, fmt } = useI18n();
  const { project } = useProjectContext();
  const [open, setOpen] = useState<'raw' | 'prompt' | null>(null);
  const ner = project.type === 'ner';
  const match =
    row.reference && row.parsed ? sameAnswer(project.type, row.parsed, row.reference) : null;
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-[14px] leading-relaxed text-ink">{row.text}</p>
        <span className="shrink-0 text-[11px] text-ink-3">{fmt.duration(row.latencyMs)}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
        {row.error ? (
          <Badge tone="danger" icon={<X />}>
            {row.error}
          </Badge>
        ) : ner ? (
          <EntityList
            text={row.text}
            labels={project.labels}
            spans={(row.parsed?.spans ?? []).map(({ start, end, label }) => ({
              start,
              end,
              label,
            }))}
          />
        ) : (
          <ProjectLabel labels={project.labels} name={row.parsed?.label} />
        )}
        {row.reference && (
          <>
            <span className="text-xs text-ink-3">{t('llm.reference')}:</span>
            {!ner && <ProjectLabel labels={project.labels} name={row.reference.label} size="sm" />}
            {match != null && (
              <Badge tone={match ? 'success' : 'warning'} icon={match ? <Check /> : <X />}>
                {match ? t('llm.match') : t('llm.mismatch')}
              </Badge>
            )}
          </>
        )}
        {row.unaligned.length > 0 && (
          <span className="text-xs text-warning">
            {t('llm.unplaced', {
              list: row.unaligned.map((u) => `${u.text} (${u.label})`).join(', '),
            })}
          </span>
        )}
      </div>
      <div className="mt-3 flex gap-3 text-[11px]">
        {(['raw', 'prompt'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setOpen((o) => (o === k ? null : k))}
            className="flex items-center gap-1 font-medium text-ink-3 hover:text-ink"
          >
            <ChevronDown
              className={cn('size-3 transition-transform', open !== k && '-rotate-90')}
            />
            {k === 'raw' ? t('llm.rawReply') : t('llm.prompt')}
          </button>
        ))}
      </div>
      {open === 'raw' && (
        <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px] whitespace-pre-wrap text-ink-2">
          {row.raw ?? '∅'}
        </pre>
      )}
      {open === 'prompt' && (
        <div className="mt-2 flex max-h-80 flex-col gap-2 overflow-auto rounded-lg bg-surface-2 p-3">
          {row.messages.map((m, i) => (
            <div key={i}>
              <div className="mb-0.5 font-mono text-[10px] tracking-wide text-ink-3 uppercase">
                {m.role}
              </div>
              <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-2">
                {m.content}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DraftQualityCard() {
  const { t, fmt } = useI18n();
  const { project } = useProjectContext();
  const [reference, setReference] = useState<'final' | 'human' | 'import'>('final');
  const q = useDraftQuality(project.id, reference);
  const d = q.data;
  const ner = project.type === 'ner';
  return (
    <Card>
      <CardTitle
        action={
          <Segmented
            size="sm"
            value={reference}
            onChange={setReference}
            options={(['final', 'human', 'import'] as const).map((r) => ({
              value: r,
              label: t(`llm.references.${r}`),
            }))}
          />
        }
      >
        {t('llm.quality')}
      </CardTitle>
      {!d || d.compared === 0 ? (
        <p className="rounded-lg bg-surface-2 px-4 py-8 text-center text-[13px] text-ink-3">
          {t('overview.noDrafts')}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {ner ? (
              <>
                <Stat label={t('overview.spanF1')} value={fmt.percent(d.f1)} />
                <Stat label={t('overview.precision')} value={fmt.percent(d.precision)} />
                <Stat label={t('overview.recall')} value={fmt.percent(d.recall)} />
              </>
            ) : (
              <>
                <Stat label={t('overview.accuracy')} value={fmt.percent(d.accuracy)} />
                <Stat label={t('overview.macroF1')} value={fmt.percent(d.f1)} />
              </>
            )}
            <Stat
              label={t('llm.compared')}
              value={fmt.number(d.compared)}
              sub={d.errors > 0 ? t('llm.failedCount', { n: d.errors }) : undefined}
            />
          </div>
          {d.errors > 0 && (
            <p className="-mt-3 text-xs text-ink-3">
              {t('llm.errorsNote', { n: fmt.number(d.errors) })}
            </p>
          )}
          <div>
            <h4 className="mb-3 text-[13px] font-medium">{t('llm.perLabel')} · F1</h4>
            <BarList
              max={1}
              rows={d.perLabel
                .filter((l) => l.support > 0)
                .map((l) => ({
                  key: l.label,
                  label: <ProjectLabel labels={project.labels} name={l.label} size="sm" />,
                  value: l.f1 ?? 0,
                  display: fmt.percent(l.f1),
                  sub: `n=${fmt.number(l.support)}`,
                }))}
            />
          </div>
          {d.confusion && (
            <div>
              <h4 className="mb-1 text-[13px] font-medium">{t('llm.confusion')}</h4>
              <p className="mb-3 text-xs text-ink-3">{t('llm.confusionHelp')}</p>
              <ConfusionHeatmap
                confusion={d.confusion}
                rowTitle={t('llm.reference')}
                colTitle={t('review.draft')}
              />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
