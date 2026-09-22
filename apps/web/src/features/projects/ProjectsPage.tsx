import type { ProjectListEntry } from '@crowd/shared';
import { ArrowRight, FolderKanban, Highlighter, Plus, Tags } from 'lucide-react';
import { motion } from 'motion/react';
import { Link, useNavigate, useOutletContext } from 'react-router';
import { StateBar } from '../../components/charts/bars';
import { LabelChip, useLabelColor } from '../../components/labels';
import { Button } from '../../components/ui/button';
import { Badge, EmptyState, PageHeader, Skeleton } from '../../components/ui/display';
import { useI18n } from '../../i18n';
import { useProjects } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { cn } from '../../lib/utils';

export function ProjectTypeIcon({
  type,
  className,
}: {
  type: ProjectListEntry['type'];
  className?: string;
}) {
  return type === 'ner' ? (
    <Highlighter className={cn('size-4', className)} />
  ) : (
    <Tags className={cn('size-4', className)} />
  );
}

export function ProjectCard({ p, index = 0 }: { p: ProjectListEntry; index?: number }) {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const navigate = useNavigate();
  const color = useLabelColor();
  const finalShare = p.counts.items ? p.counts.finalized / p.counts.items : 0;
  const manager = can('project:read_all');

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.04, duration: 0.25 }}
      className={cn(
        'card group flex flex-col p-5 transition-[border-color,box-shadow] hover:border-line-2 hover:shadow-float',
        p.archivedAt && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink-2">
          <ProjectTypeIcon type={p.type} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              to={manager ? `/projects/${p.id}` : `/projects/${p.id}/annotate`}
              className="truncate text-[15px] font-semibold text-ink hover:underline"
            >
              {p.name}
            </Link>
            {p.archivedAt && <Badge>{t('project.archived')}</Badge>}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
            <span>{t(`project.types.${p.type}`)}</span>
            <span>·</span>
            <span>{t('common.items', { n: fmt.number(p.counts.items) })}</span>
          </div>
        </div>
      </div>
      {p.description && (
        <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-ink-2">{p.description}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {p.labels.slice(0, 6).map((l) => (
          <LabelChip key={l.name} name={l.name} color={color(l.color)} size="sm" />
        ))}
        {p.labels.length > 6 && (
          <span className="self-center text-[11px] text-ink-3">+{p.labels.length - 6}</span>
        )}
      </div>
      <div className="mt-auto pt-5">
        <StateBar counts={p.counts} />
        <div className="mt-2 flex items-center justify-between text-xs text-ink-3">
          <span>{t('project.finalPct', { pct: fmt.percent(finalShare) })}</span>
          {p.counts.needsReview > 0 && (
            <span>
              {fmt.number(p.counts.needsReview)} {t('project.counts.needsReview').toLowerCase()}
            </span>
          )}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button
            variant={p.mine.available > 0 || p.mine.returned > 0 ? 'primary' : 'secondary'}
            size="sm"
            className="flex-1"
            disabled={!!p.archivedAt}
            onClick={() => navigate(`/projects/${p.id}/annotate`)}
          >
            {t('project.annotate')}
            {p.mine.available > 0 && (
              <span className="tabular rounded bg-white/15 px-1 text-[11px]">
                {fmt.number(p.mine.available)}
              </span>
            )}
          </Button>
          {manager && (
            <Button size="sm" variant="ghost" onClick={() => navigate(`/projects/${p.id}`)}>
              {t('common.open')}
              <ArrowRight className="size-3.5" />
            </Button>
          )}
        </div>
        {p.mine.restricted && p.mine.available === 0 && !manager && (
          <p className="mt-2 text-[11px] text-ink-3">{t('project.restricted')}</p>
        )}
      </div>
    </motion.div>
  );
}

export function ProjectsPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const projects = useProjects();
  const { openNewProject } = useOutletContext<{ openNewProject(): void }>();
  const active = (projects.data ?? []).filter((p) => !p.archivedAt);
  const archived = (projects.data ?? []).filter((p) => p.archivedAt);

  return (
    <div>
      <PageHeader
        title={t('nav.projects')}
        actions={
          can('project:manage') && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={openNewProject}>
              {t('project.new')}
            </Button>
          )
        }
      />
      {projects.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      ) : active.length === 0 && archived.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FolderKanban />}
            title={t('home.noProjects')}
            body={can('project:manage') ? t('home.noProjectsAdmin') : t('home.noProjectsAnnotator')}
            action={
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
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {active.map((p, i) => (
              <ProjectCard key={p.id} p={p} index={i} />
            ))}
          </div>
          {archived.length > 0 && (
            <>
              <h2 className="mt-10 mb-3 text-[13px] font-medium text-ink-3">
                {t('project.archived')}
              </h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {archived.map((p, i) => (
                  <ProjectCard key={p.id} p={p} index={i} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
