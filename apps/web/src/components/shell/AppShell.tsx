import {
  ChevronRight,
  FolderKanban,
  Home,
  Languages,
  LogOut,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sun,
  User,
  Users,
} from 'lucide-react';
import { type ReactNode, Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router';
import { NewProjectDialog } from '../../features/projects/NewProjectDialog';
import { useI18n } from '../../i18n';
import { useServerEvents } from '../../lib/events';
import { useProject, useProjects } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { type ThemeChoice, useTheme } from '../../lib/theme';
import { cn } from '../../lib/utils';
import { StateBar } from '../charts/bars';
import { Avatar, Kbd, Spinner } from '../ui/display';
import { Menu, Tooltip } from '../ui/overlay';
import { CommandPalette, useCommandPalette } from './CommandPalette';
import { LogoMark } from './Logo';

function NavItem({
  to,
  icon,
  label,
  collapsed,
  end,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  end?: boolean;
}) {
  const link = (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors [&>svg]:size-[18px] [&>svg]:shrink-0',
          isActive
            ? 'bg-surface text-ink shadow-card'
            : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
          collapsed && 'justify-center px-0',
        )
      }
    >
      {icon}
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );
  return collapsed ? (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function Breadcrumbs() {
  const { t } = useI18n();
  const location = useLocation();
  const match = useMatch('/projects/:id/*');
  const id = match ? Number(match.params.id) : Number.NaN;
  const project = useProject(id);
  const tab = match?.params['*']?.split('/')[0];
  const crumbs: { to?: string; label: string }[] = [];
  if (location.pathname === '/') crumbs.push({ label: t('nav.home') });
  else if (location.pathname.startsWith('/users')) crumbs.push({ label: t('nav.users') });
  else if (location.pathname.startsWith('/account')) crumbs.push({ label: t('nav.account') });
  else if (location.pathname.startsWith('/projects')) {
    crumbs.push({ to: '/projects', label: t('nav.projects') });
    if (match) {
      crumbs.push({ to: `/projects/${id}`, label: project.data?.name ?? '…' });
      if (tab) crumbs.push({ label: t(`project.tabs.${tab}` as 'project.tabs.overview') });
    }
  }
  return (
    <nav className="flex min-w-0 items-center gap-1.5 text-[13px]">
      {crumbs.map((c, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-ink-3" />}
          {c.to && i < crumbs.length - 1 ? (
            <Link to={c.to} className="truncate text-ink-3 hover:text-ink">
              {c.label}
            </Link>
          ) : (
            <span className="truncate font-medium text-ink">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function AppShell() {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const { me, can, signOut } = useSession();
  const projects = useProjects();
  const live = useServerEvents(!!me);
  const palette = useCommandPalette();
  const [newProject, setNewProject] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('cap.sidebar') === 'collapsed',
  );
  const location = useLocation();
  const navigate = useNavigate();
  const focusMode = /\/projects\/\d+\/annotate/.test(location.pathname);

  useEffect(() => {
    localStorage.setItem('cap.sidebar', collapsed ? 'collapsed' : 'open');
  }, [collapsed]);

  if (!me) return null;
  const themeIcon = { light: <Sun />, dark: <Moon />, system: <Monitor /> }[theme];

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          'sticky top-0 flex h-screen shrink-0 flex-col border-r border-line bg-bg transition-[width] duration-200',
          collapsed ? 'w-[60px]' : 'w-60',
        )}
      >
        <div
          className={cn('flex h-14 items-center gap-2.5 px-4', collapsed && 'justify-center px-0')}
        >
          <Link to="/" className="flex items-center gap-2.5">
            <LogoMark />
            {!collapsed && (
              <span className="text-[14px] font-semibold tracking-tight">{t('app.name')}</span>
            )}
          </Link>
        </div>

        <nav className="flex flex-col gap-0.5 px-2.5 pt-1">
          <NavItem to="/" end icon={<Home />} label={t('nav.home')} collapsed={collapsed} />
          <NavItem
            to="/projects"
            icon={<FolderKanban />}
            label={t('nav.projects')}
            collapsed={collapsed}
          />
          {can('user:manage') && (
            <NavItem to="/users" icon={<Users />} label={t('nav.users')} collapsed={collapsed} />
          )}
        </nav>

        {!collapsed && (
          <div className="mt-6 min-h-0 flex-1 overflow-y-auto px-2.5">
            <div className="px-2.5 pb-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
              {t('nav.recent')}
            </div>
            <div className="flex flex-col gap-0.5">
              {(projects.data ?? []).slice(0, 12).map((p) => (
                <NavLink
                  key={p.id}
                  to={`/projects/${p.id}`}
                  className={({ isActive }) =>
                    cn(
                      'group rounded-lg px-2.5 py-2 transition-colors',
                      isActive ? 'bg-surface shadow-card' : 'hover:bg-surface-2',
                    )
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] text-ink-2 group-hover:text-ink">
                      {p.name}
                    </span>
                    {p.mine.available > 0 && (
                      <span className="tabular shrink-0 rounded-full bg-accent-soft px-1.5 text-[10.5px] font-semibold text-accent">
                        {p.mine.available > 999 ? '999+' : p.mine.available}
                      </span>
                    )}
                  </div>
                  <StateBar counts={p.counts} size="sm" className="mt-1.5 opacity-90" />
                </NavLink>
              ))}
            </div>
          </div>
        )}
        {collapsed && <div className="flex-1" />}

        <div
          className={cn(
            'flex flex-col gap-1 border-t border-line p-2.5',
            collapsed && 'items-center',
          )}
        >
          <Menu.Root>
            <Menu.Trigger asChild>
              <button
                type="button"
                className={cn(
                  'flex items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-surface-2',
                  collapsed ? 'justify-center' : 'w-full',
                )}
              >
                <Avatar user={me} size={30} />
                {!collapsed && (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">
                      {me.displayName ?? me.username}
                    </span>
                    <span className="block truncate text-[11px] text-ink-3">
                      {t(`roles.${me.role}`)}
                    </span>
                  </span>
                )}
              </button>
            </Menu.Trigger>
            <Menu.Content align="start">
              <Menu.Label>{me.username}</Menu.Label>
              <Menu.Item icon={<User />} onSelect={() => navigate('/account')}>
                {t('nav.account')}
              </Menu.Item>
              <Menu.Separator />
              <Menu.Label>{t('nav.theme')}</Menu.Label>
              <Menu.RadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeChoice)}>
                <Menu.Radio value="light" icon={<Sun />}>
                  {t('nav.light')}
                </Menu.Radio>
                <Menu.Radio value="dark" icon={<Moon />}>
                  {t('nav.dark')}
                </Menu.Radio>
                <Menu.Radio value="system" icon={<Monitor />}>
                  {t('nav.system')}
                </Menu.Radio>
              </Menu.RadioGroup>
              <Menu.Separator />
              <Menu.Label>{t('nav.language')}</Menu.Label>
              <Menu.RadioGroup value={lang} onValueChange={(v) => setLang(v as 'en' | 'zh')}>
                <Menu.Radio value="en">English</Menu.Radio>
                <Menu.Radio value="zh">简体中文</Menu.Radio>
              </Menu.RadioGroup>
              <Menu.Separator />
              <Menu.Item icon={<LogOut />} danger onSelect={() => void signOut()}>
                {t('nav.signOut')}
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-bg/85 px-5 backdrop-blur">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-[18px]" />
            ) : (
              <PanelLeftClose className="size-[18px]" />
            )}
          </button>
          <Breadcrumbs />
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => palette.setOpen(true)}
            className="hidden h-8 w-64 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink-3 shadow-card transition-colors hover:border-line-2 md:flex"
          >
            <Search className="size-3.5" />
            <span className="flex-1 text-left">{t('nav.command')}</span>
            <Kbd>Ctrl K</Kbd>
          </button>
          <Tooltip content={live ? t('nav.live') : t('nav.offline')}>
            <span className="flex size-8 items-center justify-center">
              <span
                className={cn(
                  'relative flex size-2 rounded-full',
                  live ? 'bg-success' : 'bg-warning',
                )}
              >
                {live && (
                  <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-50" />
                )}
              </span>
            </span>
          </Tooltip>
          <Tooltip content={t('nav.switchLanguage')}>
            <button
              type="button"
              onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
              className="flex h-8 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
            >
              <Languages className="size-4" />
              {lang === 'en' ? '中' : 'EN'}
            </button>
          </Tooltip>
          <Tooltip content={t('nav.toggleTheme')}>
            <button
              type="button"
              onClick={() =>
                setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light')
              }
              className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink [&>svg]:size-4"
            >
              {themeIcon}
            </button>
          </Tooltip>
        </header>

        <main
          className={cn(
            'mx-auto w-full flex-1',
            focusMode ? 'max-w-none' : 'max-w-[1360px] px-6 py-7',
          )}
        >
          <Suspense
            fallback={
              <div className="flex h-64 items-center justify-center">
                <Spinner />
              </div>
            }
          >
            <Outlet context={{ openNewProject: () => setNewProject(true) }} />
          </Suspense>
        </main>
      </div>

      <CommandPalette
        open={palette.open}
        onOpenChange={palette.setOpen}
        onNewProject={() => setNewProject(true)}
      />
      <NewProjectDialog open={newProject} onOpenChange={setNewProject} />
    </div>
  );
}
