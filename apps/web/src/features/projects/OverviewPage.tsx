import type { Overview } from '@crowd/shared';
import { ArrowRight, Download, PenLine, ShieldCheck, Upload, Users } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { BarList, DailyColumns, Meter, StateBar } from '../../components/charts/bars';
import { JobCard } from '../../components/jobs';
import { ProjectLabel } from '../../components/labels';
import { Button } from '../../components/ui/button';
import { Avatar, Card, CardTitle, EmptyState, Skeleton, Stat } from '../../components/ui/display';
import { Segmented } from '../../components/ui/form';
import { useI18n } from '../../i18n';
import { useAgreement, useDraftQuality, useJobs, useOverview } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { cn } from '../../lib/utils';
import { useProjectContext } from './ProjectLayout';

type Source = 'final' | 'human' | 'llm' | 'imported';

/**
 * One hero number, optional secondary ones, and a note. Two grid rows so the labels share a
 * line and the numbers share a baseline whatever their sizes.
 */
function StatRow({
  stats,
  note,
}: {
  stats: { label: string; value: string; hero?: boolean }[];
  note: string;
}) {
  return (
    <div
      className="grid grid-flow-col grid-rows-[auto_auto] items-baseline gap-x-8 gap-y-1"
      style={{ gridTemplateColumns: `${'max-content '.repeat(stats.length)}minmax(0, 1fr)` }}
    >
      {stats.map((s) => (
        <Fragment key={s.label}>
          <div className="text-xs text-ink-3">{s.label}</div>
          <div className={cn('font-semibold tracking-tight', s.hero ? 'text-4xl' : 'text-2xl')}>
            {s.value}
          </div>
        </Fragment>
      ))}
      <div />
      <div className="text-xs text-ink-3">{note}</div>
    </div>
  );
}

export function OverviewPage() {
  const { t, fmt } = useI18n();
  const { project } = useProjectContext();
  const { can } = useSession();
  const navigate = useNavigate();
  const overview = useOverview(project.id);
  const agreement = useAgreement(project.id);
  const drafts = useDraftQuality(project.id, 'human');
  const jobs = useJobs(project.id);
  const [source, setSource] = useState<Source>('final');

  if (overview.isLoading || !overview.data) {
    return (
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-[88px] rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }
  const o: Overview = overview.data;
  const c = o.counts;
  const running = (jobs.data ?? []).filter((j) => j.status === 'running' || j.status === 'queued');
  const labelRows = o.labels
    .map((l) => ({
      key: l.label,
      label: <ProjectLabel labels={project.labels} name={l.label} size="sm" />,
      value: l[source],
    }))
    .filter((r) => r.value > 0 || source === 'final');
  const sourceTotal = labelRows.reduce((s, r) => s + r.value, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {can('project:manage') && (
          <Button
            size="sm"
            icon={<Upload className="size-4" />}
            onClick={() => navigate('data?import=1')}
          >
            {t('data.import')}
          </Button>
        )}
        {can('data:export') && (
          <Button
            size="sm"
            icon={<Download className="size-4" />}
            onClick={() => navigate('data?export=1')}
          >
            {t('data.export')}
          </Button>
        )}
        {can('review') && c.needsReview > 0 && (
          <Button
            size="sm"
            icon={<ShieldCheck className="size-4" />}
            onClick={() => navigate('review')}
          >
            {t('project.tabs.review')} · {fmt.number(c.needsReview)}
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          icon={<PenLine className="size-4" />}
          onClick={() => navigate('annotate')}
          disabled={!!project.archivedAt}
        >
          {t('project.annotate')}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t('overview.kpi.items')} value={fmt.number(c.items)} />
        <Stat
          label={t('overview.kpi.finalized')}
          value={fmt.number(c.finalized)}
          sub={fmt.percent(c.items ? c.finalized / c.items : 0)}
        />
        <Stat
          label={t('overview.kpi.needsReview')}
          value={fmt.number(c.needsReview)}
          tone={c.needsReview > 0 ? 'warning' : undefined}
        />
        <Stat
          label={t('overview.kpi.human')}
          value={fmt.number(o.annotations.human)}
          sub={`${fmt.number(o.annotations.skipped)} ${t('overview.skipped').toLowerCase()}`}
        />
        <Stat
          label={t('overview.kpi.drafts')}
          value={fmt.number(o.annotations.llm)}
          sub={
            o.annotations.llmErrors > 0
              ? `${fmt.number(o.annotations.llmErrors)} ${t('overview.kpi.draftErrors')}`
              : undefined
          }
        />
      </div>

      <Card>
        <CardTitle>{t('overview.progress')}</CardTitle>
        <StateBar counts={c} size="lg" legend />
      </Card>

      {running.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {running.map((j) => (
            <JobCard key={j.id} job={j} />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle
            hint={t('overview.labelsHelp')}
            action={
              <Segmented
                size="sm"
                value={source}
                onChange={setSource}
                options={(['final', 'human', 'llm', 'imported'] as const).map((s) => ({
                  value: s,
                  label: t(`overview.source.${s === 'imported' ? 'import' : s}`),
                }))}
              />
            }
          >
            {t('overview.labels')}
          </CardTitle>
          <BarList
            rows={labelRows.map((r) => ({
              ...r,
              sub: sourceTotal ? fmt.percent(r.value / sourceTotal, 0) : undefined,
            }))}
            empty={
              <p className="py-6 text-center text-[13px] text-ink-3">{t('common.notAvailable')}</p>
            }
          />
        </Card>
        <Card>
          <CardTitle>{t('overview.throughput')}</CardTitle>
          {o.throughput.length === 0 ? (
            <p className="py-12 text-center text-[13px] text-ink-3">
              {t('overview.throughputEmpty')}
            </p>
          ) : (
            <DailyColumns data={o.throughput} valueLabel={t('overview.submitted')} />
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint={t('overview.alphaHelp')}>{t('overview.agreement')}</CardTitle>
          {!agreement.data || agreement.data.itemsCompared === 0 ? (
            <p className="rounded-lg bg-surface-2 px-4 py-6 text-center text-[13px] leading-relaxed text-ink-3">
              {t('overview.notEnoughOverlap')}
            </p>
          ) : (
            <>
              <StatRow
                stats={[
                  ...(agreement.data.alpha != null
                    ? [
                        {
                          label: t('overview.alpha'),
                          value: fmt.decimal(agreement.data.alpha),
                          hero: true,
                        },
                      ]
                    : []),
                  {
                    label:
                      project.type === 'ner' ? t('overview.observedNer') : t('overview.observed'),
                    value: fmt.percent(agreement.data.observed),
                    hero: agreement.data.alpha == null,
                  },
                ]}
                note={t('overview.compared', { n: fmt.number(agreement.data.itemsCompared) })}
              />
              <table className="mt-5 w-full text-[13px]">
                <thead>
                  <tr className="text-left text-xs text-ink-3">
                    <th className="pb-2 font-medium">{t('overview.pairs')}</th>
                    <th className="pb-2 text-right font-medium">{t('overview.items')}</th>
                    {project.type === 'classification' && (
                      <th className="pb-2 text-right font-medium">{t('overview.kappa')}</th>
                    )}
                    <th className="pb-2 text-right font-medium">
                      {project.type === 'ner' ? 'F1' : t('overview.observed')}
                    </th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {agreement.data.pairs.slice(0, 6).map((p) => (
                    <tr key={`${p.a.id}-${p.b.id}`} className="border-t border-line">
                      <td className="py-2">
                        <span className="flex items-center gap-1.5">
                          <Avatar user={p.a} size={20} />
                          <Avatar user={p.b} size={20} />
                          <span className="ml-1 truncate text-ink-2">
                            {p.a.displayName ?? p.a.username} · {p.b.displayName ?? p.b.username}
                          </span>
                        </span>
                      </td>
                      <td className="py-2 text-right text-ink-2">{fmt.number(p.items)}</td>
                      {project.type === 'classification' && (
                        <td className="py-2 text-right text-ink">{fmt.decimal(p.kappa)}</td>
                      )}
                      <td className="py-2 text-right text-ink-2">{fmt.percent(p.agreement)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Card>

        <Card>
          <CardTitle
            action={
              can('llm:run') && (
                <Link
                  to="llm"
                  className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  {t('overview.openQuality')}
                  <ArrowRight className="size-3" />
                </Link>
              )
            }
          >
            {t('overview.draftQuality')}
          </CardTitle>
          {!drafts.data || drafts.data.compared === 0 ? (
            <p className="rounded-lg bg-surface-2 px-4 py-6 text-center text-[13px] text-ink-3">
              {t('overview.noDrafts')}
            </p>
          ) : (
            <>
              <StatRow
                stats={[
                  {
                    label: project.type === 'ner' ? t('overview.spanF1') : t('overview.accuracy'),
                    value: fmt.percent(
                      project.type === 'ner' ? drafts.data.f1 : drafts.data.accuracy,
                    ),
                    hero: true,
                  },
                ]}
                note={t('overview.compared', { n: fmt.number(drafts.data.compared) })}
              />
              <div className="mt-6">
                <div className="text-[13px] font-medium text-ink">{t('overview.anchoring')}</div>
                <p className="mt-1 text-xs leading-relaxed text-ink-3">
                  {t('overview.anchoringHelp')}
                </p>
                {drafts.data.anchoring.hidden.n === 0 ? (
                  <p className="mt-3 text-xs text-ink-3">{t('overview.anchoringOff')}</p>
                ) : (
                  <div className="mt-4 flex flex-col gap-3">
                    {(['shown', 'hidden'] as const).map((k) => (
                      <div
                        key={k}
                        className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-[13px]"
                      >
                        <span className="text-ink-2">{t(`overview.${k}`)}</span>
                        <Meter value={drafts.data!.anchoring[k].agree} />
                        <span className="tabular w-24 text-right">
                          <span className="font-semibold text-ink">
                            {fmt.percent(drafts.data!.anchoring[k].agree)}
                          </span>
                          <span className="ml-1 text-xs text-ink-3">
                            n={fmt.number(drafts.data!.anchoring[k].n)}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardTitle>{t('overview.annotators')}</CardTitle>
        </div>
        {o.annotators.length === 0 ? (
          <EmptyState icon={<Users />} title={t('overview.noAnnotators')} className="py-10" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-3">
                  <th className="px-5 pb-2.5 font-medium">{t('overview.person')}</th>
                  <th className="px-3 pb-2.5 text-right font-medium">{t('overview.submitted')}</th>
                  <th className="px-3 pb-2.5 text-right font-medium">{t('overview.skipped')}</th>
                  <th className="px-3 pb-2.5 text-right font-medium">{t('overview.medianTime')}</th>
                  <th className="px-3 pb-2.5 text-right font-medium">{t('overview.agreeFinal')}</th>
                  <th className="px-3 pb-2.5 text-right font-medium">{t('overview.agreeDraft')}</th>
                  <th className="px-5 pb-2.5 text-right font-medium">{t('overview.lastActive')}</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {o.annotators.map((a) => (
                  <tr
                    key={a.user.id}
                    className="border-b border-line last:border-0 hover:bg-surface-2/50"
                  >
                    <td className="px-5 py-2.5">
                      <span className="flex items-center gap-2.5">
                        <Avatar user={a.user} size={24} />
                        <span className="font-medium text-ink">
                          {a.user.displayName ?? a.user.username}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-ink">{fmt.number(a.submitted)}</td>
                    <td className="px-3 py-2.5 text-right text-ink-3">{fmt.number(a.skipped)}</td>
                    <td className="px-3 py-2.5 text-right text-ink-2">
                      {fmt.duration(a.medianMs)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-ink-2">
                      {fmt.percent(a.agreeWithFinal)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-ink-2">
                      {fmt.percent(a.agreeWithDraft)}
                    </td>
                    <td className="px-5 py-2.5 text-right text-ink-3">{fmt.relative(a.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
