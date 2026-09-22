import type { Capability, ProjectDTO } from '@crowd/shared';
import {
  Bot,
  FlaskConical,
  LayoutDashboard,
  PenLine,
  Settings2,
  ShieldCheck,
  Table2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useOutletContext, useParams } from 'react-router';
import { Badge, EmptyState, Skeleton } from '../../components/ui/display';
import { useI18n } from '../../i18n';
import { useProject } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { cn } from '../../lib/utils';
import { ProjectTypeIcon } from './ProjectsPage';

export interface ProjectContext {
  project: ProjectDTO;
}

export function useProjectContext() {
  return useOutletContext<ProjectContext>();
}

const TABS: { key: string; path: string; icon: ReactNode; cap: Capability }[] = [
  { key: 'overview', path: '', icon: <LayoutDashboard />, cap: 'project:read_all' },
  { key: 'annotate', path: 'annotate', icon: <PenLine />, cap: 'annotate' },
  { key: 'review', path: 'review', icon: <ShieldCheck />, cap: 'review' },
  { key: 'data', path: 'data', icon: <Table2 />, cap: 'project:read_all' },
  { key: 'llm', path: 'llm', icon: <Bot />, cap: 'llm:run' },
  { key: 'models', path: 'models', icon: <FlaskConical />, cap: 'project:read_all' },
  { key: 'settings', path: 'settings', icon: <Settings2 />, cap: 'project:manage' },
];

export function ProjectLayout() {
  const { t } = useI18n();
  const { can } = useSession();
  const { id } = useParams();
  const projectId = Number(id);
  const project = useProject(projectId);
  const location = useLocation();
  const focus = location.pathname.endsWith('/annotate');

  if (project.isLoading) {
    return (
      <div className={focus ? 'p-6' : ''}>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-6 h-10 w-full" />
      </div>
    );
  }
  if (!project.data) {
    return <EmptyState title={t('errors.notFound')} body={t('errors.notFoundBody')} />;
  }
  const p = project.data;
  const tabs = TABS.filter((tab) => can(tab.cap));

  return (
    <div>
      {!focus && (
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl border border-line bg-surface text-ink-2">
              <ProjectTypeIcon type={p.type} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-tight">{p.name}</h1>
                {p.archivedAt && <Badge>{t('project.archived')}</Badge>}
              </div>
              {p.description && <p className="truncate text-[13px] text-ink-3">{p.description}</p>}
            </div>
          </div>
          {tabs.length > 1 && (
            <nav className="mt-5 flex gap-1 overflow-x-auto border-b border-line">
              {tabs.map((tab) => (
                <NavLink
                  key={tab.key}
                  to={tab.path}
                  end={tab.path === ''}
                  className={({ isActive }) =>
                    cn(
                      '-mb-px flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-[13px] font-medium transition-colors [&>svg]:size-4',
                      isActive
                        ? 'border-ink text-ink'
                        : 'border-transparent text-ink-3 hover:text-ink',
                    )
                  }
                >
                  {tab.icon}
                  {t(`project.tabs.${tab.key}` as 'project.tabs.overview')}
                </NavLink>
              ))}
            </nav>
          )}
        </div>
      )}
      <Outlet context={{ project: p } satisfies ProjectContext} />
    </div>
  );
}

/** The project's landing tab: the dashboard for those who can see it, the queue otherwise. */
export function ProjectIndex({ overview }: { overview: ReactNode }) {
  const { can } = useSession();
  return can('project:read_all') ? overview : <Navigate to="annotate" replace />;
}
