import { CALIBRATION_ANSWERS, type CalibrationReport, type IntervalView } from '@crowd/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Target, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ProjectLabel } from '../../components/labels';
import { Button } from '../../components/ui/button';
import { Avatar, Badge, Card, CardTitle, EmptyState, Stat } from '../../components/ui/display';
import { Field, Input, Segmented } from '../../components/ui/form';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { qk, useCalibration } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { useProjectContext } from '../projects/ProjectLayout';

/** The paper's suggested ε for each kind of annotator. */
const EPSILONS = { '0.1': 'crowd', '0.15': 'skilled', '0.2': 'experts' } as const;
type Epsilon = keyof typeof EPSILONS;

/** A proportion's interval, kept to [0, 1] for display; the API returns it unclipped. */
function useIntervalFormat() {
  const { t, fmt } = useI18n();
  return (i: IntervalView) =>
    t('calibration.interval', {
      low: fmt.percent(Math.max(0, i.low)),
      high: fmt.percent(Math.min(1, i.high)),
    });
}

export function CalibrationPage() {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const [epsilon, setEpsilon] = useState<Epsilon>('0.15');
  const q = useCalibration(project.id, Number(epsilon));
  const r = q.data;
  return (
    <div className="flex flex-col gap-6">
      <SetCard report={r} />
      {r && r.size > 0 && !r.supported && (
        <p className="rounded-lg bg-surface-2 px-4 py-6 text-center text-[13px] text-ink-3">
          {t('calibration.nerUnsupported')}
        </p>
      )}
      {r?.supported && r.size > 0 && (
        <>
          <AccuracyCard report={r} />
          <AltTestCard report={r} epsilon={epsilon} onEpsilon={setEpsilon} />
          <DistributionCard report={r} />
        </>
      )}
    </div>
  );
}

function SetCard({ report }: { report: CalibrationReport | undefined }) {
  const { t, fmt } = useI18n();
  const { project } = useProjectContext();
  const { can } = useSession();
  const qc = useQueryClient();
  const [size, setSize] = useState('50');
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.stats(project.id) });
  const draw = useMutation({
    mutationFn: () => api.calibration.draw(project.id, Number(size)),
    onSuccess: (res) => {
      toast.success(t('calibration.drawn', { n: fmt.number(res.drawn) }));
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const clear = useMutation({
    mutationFn: () => api.calibration.clear(project.id),
    onSuccess: () => {
      toast.success(t('calibration.cleared'));
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const manage = can('project:manage');

  return (
    <Card>
      <CardTitle
        hint={t('calibration.hint', { n: CALIBRATION_ANSWERS })}
        action={
          manage && report && report.size > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              loading={clear.isPending}
              onClick={() => clear.mutate()}
            >
              {t('calibration.clear')}
            </Button>
          ) : undefined
        }
      >
        {t('calibration.title')}
      </CardTitle>
      {!report ? null : report.size === 0 ? (
        manage ? (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              draw.mutate();
            }}
          >
            <Field label={t('calibration.drawSize')} hint={t('calibration.drawHelp')}>
              <Input
                type="number"
                min={1}
                max={5000}
                value={size}
                onChange={(e) => setSize(e.target.value)}
                className="w-32"
              />
            </Field>
            <Button type="submit" loading={draw.isPending} icon={<Target />}>
              {t('calibration.draw')}
            </Button>
          </form>
        ) : (
          <EmptyState icon={<Target />} title={t('calibration.none')} className="py-8" />
        )
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t('calibration.size')} value={fmt.number(report.size)} />
          <Stat
            label={t('calibration.complete', { n: CALIBRATION_ANSWERS })}
            value={fmt.number(report.complete)}
          />
          <Stat label={t('calibration.referenced')} value={fmt.number(report.referenced)} />
          <Stat label={t('calibration.ties')} value={fmt.number(report.ties)} />
        </div>
      )}
    </Card>
  );
}

function NotEnough() {
  const { t } = useI18n();
  return (
    <p className="rounded-lg bg-surface-2 px-4 py-6 text-center text-[13px] text-ink-3">
      {t('calibration.notEnough', { n: CALIBRATION_ANSWERS })}
    </p>
  );
}

function AccuracyCard({ report }: { report: CalibrationReport }) {
  const { t, fmt } = useI18n();
  const interval = useIntervalFormat();
  const a = report.draftAccuracy;
  return (
    <Card>
      <CardTitle hint={t('calibration.accuracyHint')}>{t('calibration.accuracy')}</CardTitle>
      {!a ? (
        <NotEnough />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label={t('calibration.accuracy')}
            value={fmt.percent(a.interval.estimate)}
            sub={interval(a.interval)}
          />
          <Stat
            label={t('calibration.compared')}
            value={t('calibration.accuracyOf', {
              correct: fmt.number(a.correct),
              n: fmt.number(a.n),
            })}
          />
        </div>
      )}
    </Card>
  );
}

function AltTestCard({
  report,
  epsilon,
  onEpsilon,
}: {
  report: CalibrationReport;
  epsilon: Epsilon;
  onEpsilon(e: Epsilon): void;
}) {
  const { t, fmt } = useI18n();
  const a = report.altTest;
  return (
    <Card padded={false}>
      <div className="px-5 pt-5">
        <CardTitle
          hint={t('calibration.altTestHint', { q: a?.q ?? 0.05 })}
          action={
            <Segmented
              size="sm"
              value={epsilon}
              onChange={onEpsilon}
              options={(Object.keys(EPSILONS) as Epsilon[]).map((e) => ({
                value: e,
                label: t(`calibration.epsilon.${EPSILONS[e]}`, { e }),
              }))}
            />
          }
        >
          {t('calibration.altTest')}
        </CardTitle>
      </div>
      {!a ? (
        <div className="px-5 pb-5">
          <p className="rounded-lg bg-surface-2 px-4 py-6 text-center text-[13px] text-ink-3">
            {t('calibration.needsAnnotators')}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 px-5 pb-4 md:grid-cols-4">
            <Stat
              label={t('calibration.verdict')}
              value={
                <Badge tone={a.passed ? 'success' : 'neutral'}>
                  {a.passed ? t('calibration.passed') : t('calibration.failed')}
                </Badge>
              }
            />
            <Stat label={t('calibration.winningRate')} value={fmt.percent(a.winningRate)} />
            <Stat label={t('calibration.advantage')} value={fmt.percent(a.advantageProbability)} />
          </div>
          {a.annotators.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-3">
                    <th className="px-5 pb-2.5 font-medium">{t('calibration.person')}</th>
                    <th className="px-3 pb-2.5 text-right font-medium">{t('calibration.items')}</th>
                    <th className="px-3 pb-2.5 text-right font-medium">
                      {t('calibration.modelAdvantage')}
                    </th>
                    <th className="px-3 pb-2.5 text-right font-medium">
                      {t('calibration.annotatorAdvantage')}
                    </th>
                    <th className="px-3 pb-2.5 text-right font-medium">p</th>
                    <th className="px-5 pb-2.5 text-right font-medium">
                      {t('calibration.modelWins')}
                    </th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {a.annotators.map((row) => (
                    <tr key={row.user.id} className="border-b border-line last:border-0">
                      <td className="px-5 py-2.5">
                        <span className="flex items-center gap-2.5">
                          <Avatar user={row.user} size={24} />
                          <span className="font-medium text-ink">
                            {row.user.displayName ?? row.user.username}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">{fmt.number(row.instances)}</td>
                      <td className="px-3 py-2.5 text-right">{fmt.percent(row.modelAdvantage)}</td>
                      <td className="px-3 py-2.5 text-right">
                        {fmt.percent(row.annotatorAdvantage)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-ink-2">
                        {row.pValue == null
                          ? '—'
                          : row.pValue < 0.001
                            ? '< 0.001'
                            : fmt.decimal(row.pValue, 3)}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        {row.modelWins ? (
                          <Check
                            className="ml-auto size-4 text-success"
                            aria-label={t('common.yes')}
                          />
                        ) : (
                          <X className="ml-auto size-4 text-ink-3" aria-label={t('common.no')} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {a.skipped.length > 0 && (
            <p className="px-5 py-4 text-xs text-ink-3">
              {t('calibration.skipped', {
                n: 30,
                people: a.skipped
                  .map(
                    (s) => `${s.user.displayName ?? s.user.username} (${fmt.number(s.instances)})`,
                  )
                  .join(', '),
              })}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function DistributionCard({ report }: { report: CalibrationReport }) {
  const { t, fmt } = useI18n();
  const { project } = useProjectContext();
  const interval = useIntervalFormat();
  const d = report.distribution;
  return (
    <Card padded={false}>
      <div className="px-5 pt-5">
        <CardTitle hint={t('calibration.distributionHint')}>
          {t('calibration.distribution')}
        </CardTitle>
      </div>
      {!d ? (
        <div className="px-5 pb-5">
          <NotEnough />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-3">
                  <th className="px-5 pb-2.5 font-medium">{t('calibration.label')}</th>
                  <th className="px-3 pb-2.5 text-right font-medium">{t('calibration.drafts')}</th>
                  <th className="px-3 pb-2.5 text-right font-medium">
                    {t('calibration.calibrationOnly')}
                  </th>
                  <th className="px-3 pb-2.5 text-right font-medium">PPI++</th>
                  <th className="px-5 pb-2.5 text-right font-medium">λ</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {d.labels.map((l) => (
                  <tr key={l.label} className="border-b border-line last:border-0">
                    <td className="px-5 py-2.5">
                      <ProjectLabel labels={project.labels} name={l.label} size="sm" />
                    </td>
                    <td className="px-3 py-2.5 text-right">{fmt.percent(l.drafts)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {fmt.percent(l.calibration.estimate)}
                      <span className="ml-1.5 text-xs text-ink-3">{interval(l.calibration)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-ink">
                      {fmt.percent(l.ppi.estimate)}
                      <span className="ml-1.5 text-xs font-normal text-ink-3">
                        {interval(l.ppi)}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right text-ink-2">
                      {fmt.decimal(l.ppi.lambda)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-4 text-xs text-ink-3">
            {t('calibration.sample', { n: fmt.number(d.n), N: fmt.number(d.N) })}
          </p>
        </>
      )}
    </Card>
  );
}
