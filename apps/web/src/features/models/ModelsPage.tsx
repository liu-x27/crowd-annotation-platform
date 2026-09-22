import type {
  EpochStats,
  ModelSummary,
  Prediction,
  TrainJobInput,
  TrainReport,
  TrainSource,
} from '@crowd/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, FlaskConical, Play, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BarList, Meter } from '../../components/charts/bars';
import { ConfusionHeatmap } from '../../components/charts/heatmap';
import { LineChart } from '../../components/charts/line';
import { JobStatusBadge } from '../../components/jobs';
import { ProjectLabel } from '../../components/labels';
import { Button, IconButton } from '../../components/ui/button';
import { Badge, Card, CardTitle, EmptyState, Stat } from '../../components/ui/display';
import { Field, Input, Select } from '../../components/ui/form';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { qk, useJobs, useModels } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { cn } from '../../lib/utils';
import { NerCanvas } from '../annotate/NerCanvas';
import { useProjectContext } from '../projects/ProjectLayout';

const SOURCES: TrainSource[] = ['final', 'human', 'llm', 'llm+human', 'import'];

/** Epochs for a job: from the report once it finished, live from server events while it runs. */
function useEpochs(jobId: number | null, report: TrainReport | null): EpochStats[] {
  const live = useQuery<EpochStats[]>({
    queryKey: qk.epochs(jobId ?? 0),
    queryFn: () => [],
    enabled: false,
    initialData: [],
  });
  return report?.history ?? (jobId ? live.data : []);
}

export function ModelsPage() {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const { can } = useSession();
  const models = useModels(project.id);
  const jobs = useJobs(project.id);
  const qc = useQueryClient();
  const [selected, setSelected] = useState<number | null>(null);

  const runningJob = (jobs.data ?? []).find(
    (j) => j.kind === 'train' && (j.status === 'running' || j.status === 'queued'),
  );
  const list = models.data ?? [];
  const current = list.find((m) => m.jobId === selected) ?? list[0] ?? null;

  // When a training job finishes, refresh the list and focus the new run.
  useEffect(() => {
    if (runningJob) setSelected(runningJob.id);
  }, [runningJob]);
  useEffect(() => {
    if (!runningJob) void qc.invalidateQueries({ queryKey: qk.models(project.id) });
  }, [runningJob, qc, project.id]);

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-[13.5px] leading-relaxed text-ink-2">{t('models.intro')}</p>
      <div className="grid items-start gap-4 xl:grid-cols-[340px_1fr]">
        <div className="flex flex-col gap-4">
          {can('model:train') && <TrainForm disabled={!!runningJob} />}
          <Card padded={false}>
            <div className="px-5 pt-5">
              <CardTitle>{t('models.runs')}</CardTitle>
            </div>
            {list.length === 0 ? (
              <p className="px-5 pb-5 text-[13px] text-ink-3">{t('models.noRuns')}</p>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {list.map((m) => (
                  <RunRow
                    key={m.jobId}
                    m={m}
                    active={current?.jobId === m.jobId}
                    onSelect={() => setSelected(m.jobId)}
                  />
                ))}
              </ul>
            )}
          </Card>
        </div>
        {current ? (
          <RunDetail
            m={current}
            running={runningJob?.id === current.jobId ? runningJob.progress : null}
          />
        ) : (
          <Card>
            <EmptyState
              icon={<FlaskConical />}
              title={t('models.noRuns')}
              body={t('models.intro')}
            />
          </Card>
        )}
      </div>
    </div>
  );
}

function RunRow({ m, active, onSelect }: { m: ModelSummary; active: boolean; onSelect(): void }) {
  const { t, fmt } = useI18n();
  const score = m.report
    ? m.report.kind === 'classification'
      ? m.report.test.accuracy
      : m.report.test.microF1
    : null;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'w-full px-5 py-3 text-left transition-colors',
          active ? 'bg-accent-soft' : 'hover:bg-surface-2',
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-ink">
            {t(`models.sources.${m.params.source}`)}
          </span>
          {m.status !== 'succeeded' && (
            <JobStatusBadge
              job={{
                id: m.jobId,
                status: m.status,
                kind: 'train',
                projectId: null,
                params: {},
                progress: { done: 0, total: 0, failed: 0 },
                result: null,
                error: m.error,
                createdBy: null,
                createdAt: m.createdAt,
                startedAt: null,
                finishedAt: m.finishedAt,
              }}
            />
          )}
          <span className="tabular ml-auto text-[13px] font-semibold text-ink">
            {score != null ? fmt.percent(score) : ''}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between text-[11px] text-ink-3">
          <span>
            {m.params.epochs} {t('models.epochs').toLowerCase()} ·{' '}
            {t('models.hashing', { n: m.params.hashBits })}
          </span>
          <span>{fmt.relative(m.createdAt)}</span>
        </div>
      </button>
    </li>
  );
}

function TrainForm({ disabled }: { disabled: boolean }) {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const qc = useQueryClient();
  const [source, setSource] = useState<TrainSource>('final');
  const [reference, setReference] = useState<'final' | 'import'>('final');
  const [epochs, setEpochs] = useState(12);
  const [testFraction, setTestFraction] = useState(0.2);
  const [hashBits, setHashBits] = useState(17);
  const [seed, setSeed] = useState(42);
  const [advanced, setAdvanced] = useState(false);
  const train = useMutation({
    mutationFn: (body: TrainJobInput) => api.models.train(project.id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.jobs(project.id) }),
    onError: (e) => toast.error(e.message),
  });
  return (
    <Card>
      <CardTitle>{t('models.configure')}</CardTitle>
      <div className="flex flex-col gap-4">
        <Field label={t('models.source')} hint={t(`models.sourceHelp.${source}`)}>
          <Select
            value={source}
            onChange={setSource}
            options={SOURCES.map((s) => ({ value: s, label: t(`models.sources.${s}`) }))}
          />
        </Field>
        <Field label={t('models.reference')}>
          <Select
            value={reference}
            onChange={setReference}
            options={(['final', 'import'] as const).map((r) => ({
              value: r,
              label: t(`models.references.${r}`),
            }))}
          />
        </Field>
        <button
          type="button"
          onClick={() => setAdvanced((a) => !a)}
          className="flex items-center gap-1 text-xs font-medium text-ink-3 hover:text-ink"
        >
          <ChevronDown className={cn('size-3.5 transition-transform', !advanced && '-rotate-90')} />
          {t('models.advanced')}
        </button>
        {advanced && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('models.epochs')}>
              <Input
                type="number"
                min={1}
                max={60}
                value={epochs}
                onChange={(e) => setEpochs(Number(e.target.value))}
              />
            </Field>
            <Field label={t('models.testFraction')}>
              <Input
                type="number"
                min={0.05}
                max={0.5}
                step={0.05}
                value={testFraction}
                onChange={(e) => setTestFraction(Number(e.target.value))}
              />
            </Field>
            <Field label={t('models.hashBits')}>
              <Input
                type="number"
                min={12}
                max={20}
                value={hashBits}
                onChange={(e) => setHashBits(Number(e.target.value))}
              />
            </Field>
            <Field label={t('models.seed')}>
              <Input
                type="number"
                min={0}
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
              />
            </Field>
          </div>
        )}
        <Button
          variant="primary"
          icon={<FlaskConical className="size-4" />}
          loading={train.isPending}
          disabled={disabled}
          onClick={() => train.mutate({ source, reference, epochs, testFraction, hashBits, seed })}
        >
          {t('models.train')}
        </Button>
      </div>
    </Card>
  );
}

function RunDetail({
  m,
  running,
}: {
  m: ModelSummary;
  running: { done: number; total: number } | null;
}) {
  const { t, fmt } = useI18n();
  const { project } = useProjectContext();
  const { can } = useSession();
  const qc = useQueryClient();
  const r = m.report;
  const epochs = useEpochs(m.jobId, r);
  const ner = project.type === 'ner';
  const remove = useMutation({
    mutationFn: () => api.models.remove(project.id, m.jobId),
    onSuccess: () => {
      toast.success(t('models.deleted'));
      void qc.invalidateQueries({ queryKey: qk.models(project.id) });
    },
  });

  const lossSeries = [
    {
      key: 'train',
      label: ner ? t('models.tokenError') : t('models.trainLoss'),
      color: 'var(--viz-1)',
      points: epochs.map((e) => ({ x: e.epoch, y: e.trainLoss })),
    },
    ...(!ner && epochs.some((e) => e.valLoss != null)
      ? [
          {
            key: 'val',
            label: t('models.valLoss'),
            color: 'var(--viz-2)',
            points: epochs.map((e) => ({ x: e.epoch, y: e.valLoss })),
          },
        ]
      : []),
  ];
  const scoreSeries = [
    {
      key: 'acc',
      label: t('models.valAccuracy'),
      color: 'var(--viz-1)',
      points: epochs.map((e) => ({ x: e.epoch, y: e.valAccuracy })),
    },
    {
      key: 'f1',
      label: t('models.valF1'),
      color: 'var(--viz-2)',
      points: epochs.map((e) => ({ x: e.epoch, y: e.valF1 })),
    },
  ].filter((s) => s.points.some((p) => p.y != null));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardTitle
          hint={t('models.valHelp')}
          action={
            <div className="flex items-center gap-2">
              {running && (
                <Badge tone="accent">
                  {t('models.training', { epoch: running.done, total: running.total })}
                </Badge>
              )}
              {r && (
                <span className="text-xs text-ink-3">
                  {t('models.duration', { t: fmt.duration(r.durationMs) })}
                </span>
              )}
              {can('model:train') && !running && (
                <IconButton label={t('models.deleteRun')} onClick={() => remove.mutate()}>
                  <Trash2 className="size-4" />
                </IconButton>
              )}
            </div>
          }
        >
          {t('models.curves')}
        </CardTitle>
        {m.status === 'failed' ? (
          <p className="rounded-lg bg-danger/10 px-4 py-3 text-[13px] text-danger">{m.error}</p>
        ) : epochs.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-ink-3">
            {m.status === 'queued' ? t('models.queued') : t('common.loading')}
          </p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <LineChart
              caption={t('models.trainLoss')}
              series={lossSeries}
              xLabel={(x) => `${t('models.epochs')} ${x}`}
              yFormat={(v) => v.toFixed(ner ? 3 : 2)}
              marker={r ? { x: r.bestEpoch, label: 'best' } : undefined}
            />
            {scoreSeries.length > 0 && (
              <LineChart
                caption={t('models.valAccuracy')}
                series={scoreSeries}
                yDomain={[0, 1]}
                xLabel={(x) => `${t('models.epochs')} ${x}`}
                yFormat={(v) => `${Math.round(v * 100)}%`}
                marker={r ? { x: r.bestEpoch, label: 'best' } : undefined}
              />
            )}
          </div>
        )}
      </Card>

      {r && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <Stat
              label={ner ? t('models.microF1') : t('models.accuracy')}
              value={fmt.percent(ner ? r.test.microF1 : r.test.accuracy)}
              sub={t('models.bestEpoch', { n: r.bestEpoch })}
            />
            <Stat label={t('models.macroF1')} value={fmt.percent(r.test.macroF1)} />
            <Stat
              label={t('models.trainedOn')}
              value={fmt.number(r.data.train)}
              sub={t('models.splitSizes', {
                // trainBySource counts the whole training pool; `train` is what remained after
                // the validation split was carved from it.
                val: fmt.number(
                  Object.values(r.data.trainBySource).reduce((a, b) => a + b, 0) - r.data.train,
                ),
                test: fmt.number(r.data.test),
              })}
            />
          </div>

          <Card>
            <CardTitle>{t('models.baselines')}</CardTitle>
            <div className="grid grid-cols-[minmax(140px,220px)_1fr_auto] items-center gap-x-3 gap-y-3 text-[13px]">
              {[
                {
                  key: 'student',
                  label: t('models.student'),
                  value: ner ? r.test.microF1 : r.test.accuracy,
                  n: r.data.test,
                  strong: true,
                },
                {
                  key: 'simple',
                  label: t(`models.baseline.${r.baselines.simple.kind}`),
                  value: r.baselines.simple.score,
                  n: r.data.test,
                },
                {
                  key: 'teacher',
                  label: t('models.baseline.teacher'),
                  value: r.baselines.teacher.score,
                  n: r.baselines.teacher.n,
                },
              ]
                .filter((b) => b.value != null)
                .map((b) => (
                  <div key={b.key} className="contents">
                    <span className={b.strong ? 'font-medium text-ink' : 'text-ink-2'}>
                      {b.label}
                    </span>
                    <Meter value={b.value} />
                    <span className="tabular text-right whitespace-nowrap">
                      <span className="font-semibold text-ink">{fmt.percent(b.value)}</span>
                      <span className="ml-1 text-xs text-ink-3">
                        {t('models.baselineN', { n: fmt.number(b.n) })}
                      </span>
                    </span>
                  </div>
                ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5 text-xs text-ink-3">
              {Object.entries(r.data.trainBySource).map(([s, n]) => (
                <Badge key={s}>
                  {t(`models.sources.${s as TrainSource}`)}: {fmt.number(n)}
                </Badge>
              ))}
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardTitle>{t('models.perLabel')} · F1</CardTitle>
              <BarList
                max={1}
                rows={r.test.perLabel
                  .filter((l) => l.support > 0)
                  .map((l) => ({
                    key: l.label,
                    label: <ProjectLabel labels={project.labels} name={l.label} size="sm" />,
                    value: l.f1 ?? 0,
                    display: fmt.percent(l.f1),
                    sub: `n=${l.support}`,
                  }))}
              />
            </Card>
            <PredictCard jobId={m.jobId} />
          </div>

          {r.test.confusion && (
            <Card>
              <CardTitle>{t('models.confusion')}</CardTitle>
              <ConfusionHeatmap
                confusion={r.test.confusion}
                rowTitle={t('llm.reference')}
                colTitle={t('models.predict')}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function PredictCard({ jobId }: { jobId: number }) {
  const { t, fmt } = useI18n();
  const { project } = useProjectContext();
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ text: string; p: Prediction } | null>(null);
  const predict = useMutation({
    mutationFn: () => api.models.predict(project.id, jobId, text),
    onSuccess: (p) => setResult({ text, p }),
    onError: (e) => toast.error(e.message),
  });
  return (
    <Card>
      <CardTitle>{t('models.tryIt')}</CardTitle>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) predict.mutate();
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('models.tryPlaceholder')}
        />
        <Button
          type="submit"
          variant="primary"
          icon={<Play className="size-4" />}
          loading={predict.isPending}
          disabled={!text.trim()}
        >
          {t('models.predict')}
        </Button>
      </form>
      {result && (
        <div className="mt-4">
          {project.type === 'ner' ? (
            <NerCanvas
              text={result.text}
              labels={project.labels}
              spans={(result.p.spans ?? []).map(({ start, end, label }) => ({ start, end, label }))}
              onChange={() => {}}
              readOnly
              size="md"
            />
          ) : (
            <BarList
              max={1}
              rows={result.p.probabilities.slice(0, 6).map((p) => ({
                key: p.label,
                label: <ProjectLabel labels={project.labels} name={p.label} size="sm" />,
                value: p.p,
                display: fmt.percent(p.p),
              }))}
            />
          )}
        </div>
      )}
    </Card>
  );
}
