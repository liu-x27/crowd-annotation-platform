import {
  ArrowRight,
  FolderKanban,
  MessageSquareWarning,
  PenLine,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate, useOutletContext } from 'react-router';
import { DailyColumns, StateBar } from '../../components/charts/bars';
import { JobCard } from '../../components/jobs';
import { Button } from '../../components/ui/button';
import { Card, CardTitle, EmptyState, Skeleton, Stat } from '../../components/ui/display';
import { useI18n } from '../../i18n';
import { useJobs, useMyStats, useProjects } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { ProjectCard } from '../projects/ProjectsPage';

export function HomePage() {
  const { t, fmt } = useI18n();
  const { me, can } = useSession();
  const navigate = useNavigate();
  const projects = useProjects();
  const stats = useMyStats();
  const jobs = useJobs(undefined, can('project:read_all'));
  const { openNewProject } = useOutletContext<{ openNewProject(): void }>();

  const list = (projects.data ?? []).filter((p) => !p.archivedAt);
  const work = list.filter((p) => p.mine.available > 0 || p.mine.returned > 0);
  const review = can('review') ? list.filter((p) => p.counts.needsReview > 0) : [];
  const recentJobs = (jobs.data ?? []).slice(0, 4);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">
          {t('home.greeting', { name: me?.displayName ?? me?.username ?? '' })}
        </h1>
        <p className="mt-1 text-[14px] text-ink-3">{t('home.intro')}</p>
      </div>

      {projects.isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : work.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {work.map((p, i) => (
            <motion.button
              key={p.id}
              type="button"
              onClick={() => navigate(`/projects/${p.id}/annotate`)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="card group flex flex-col gap-4 p-5 text-left transition-shadow hover:shadow-float"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-ink">{p.name}</div>
                  <div className="mt-0.5 text-xs text-ink-3">{t(`project.types.${p.type}`)}</div>
                </div>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-bg transition-transform group-hover:translate-x-0.5">
                  <ArrowRight className="size-4" />
                </span>
              </div>
              <div className="flex items-end gap-4">
                <div>
                  <div className="text-3xl font-semibold tracking-tight">
                    {fmt.number(p.mine.available)}
                  </div>
                  <div className="text-xs text-ink-3">{t('home.toDo')}</div>
                </div>
                {p.mine.returned > 0 && (
                  <div className="mb-1 flex items-center gap-1.5 rounded-lg bg-warning/10 px-2 py-1 text-xs font-medium text-warning">
                    <MessageSquareWarning className="size-3.5" />
                    {t('home.returned', { n: p.mine.returned })}
                  </div>
                )}
              </div>
              <StateBar counts={p.counts} size="sm" />
            </motion.button>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={list.length ? <PenLine /> : <FolderKanban />}
            title={list.length ? t('home.nothingToDo') : t('home.noProjects')}
            body={
              !list.length
                ? can('project:manage')
                  ? t('home.noProjectsAdmin')
                  : t('home.noProjectsAnnotator')
                : undefined
            }
            action={
              !list.length &&
              can('project:manage') && (
                <Button
                  variant="primary"
                  icon={<Plus className="size-4" />}
                  onClick={openNewProject}
                >
                  {t('home.createFirst')}
                </Button>
              )
            }
          />
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="grid grid-cols-2 gap-3">
          <Stat label={t('home.today')} value={fmt.number(stats.data?.today ?? 0)} />
          <Stat label={t('home.thisWeek')} value={fmt.number(stats.data?.last7d ?? 0)} />
          <Stat label={t('home.medianTime')} value={fmt.duration(stats.data?.medianMs)} />
          <Stat label={t('home.agreement')} value={fmt.percent(stats.data?.agreeWithFinal)} />
        </div>
        <Card>
          <CardTitle>{t('home.activity')}</CardTitle>
          <DailyColumns
            data={stats.data?.daily ?? []}
            height={130}
            valueLabel={t('overview.submitted')}
          />
        </Card>
      </div>

      {review.length > 0 && (
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
            <ShieldCheck className="size-4 text-ink-3" />
            {t('home.attention')}
          </h2>
          <div className="card divide-y divide-line">
            {review.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => navigate(`/projects/${p.id}/review`)}
                className="flex w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-surface-2/60"
              >
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{p.name}</span>
                <span className="tabular text-[13px] text-warning">
                  {fmt.number(p.counts.needsReview)}
                </span>
                <ArrowRight className="size-4 text-ink-3" />
              </button>
            ))}
          </div>
        </div>
      )}

      {can('project:read_all') && list.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[14px] font-semibold">{t('home.projects')}</h2>
              <Button size="xs" variant="ghost" onClick={() => navigate('/projects')}>
                {t('home.manage')} <ArrowRight className="size-3.5" />
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {list.slice(0, 4).map((p, i) => (
                <ProjectCard key={p.id} p={p} index={i} />
              ))}
            </div>
          </div>
          <div>
            <h2 className="mb-3 text-[14px] font-semibold">{t('home.jobs')}</h2>
            <div className="flex flex-col gap-2">
              {recentJobs.length === 0 ? (
                <p className="text-[13px] text-ink-3">{t('home.noJobs')}</p>
              ) : (
                recentJobs.map((j) => <JobCard key={j.id} job={j} compact />)
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
