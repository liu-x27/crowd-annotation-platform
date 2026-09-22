import { Command } from 'cmdk';
import {
  FolderKanban,
  Home,
  Languages,
  LogOut,
  MoonStar,
  PenLine,
  Plus,
  Search,
  ShieldCheck,
  Table2,
  User,
  Users,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Dialog as RDialog } from 'radix-ui';
import { type ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useI18n } from '../../i18n';
import { useProjects } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { useTheme } from '../../lib/theme';
import { Kbd } from '../ui/display';

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { open, setOpen };
}

function Item({
  icon,
  children,
  onSelect,
  hint,
}: {
  icon: ReactNode;
  children: ReactNode;
  onSelect(): void;
  hint?: ReactNode;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink data-[selected=true]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-ink-3"
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </Command.Item>
  );
}

export function CommandPalette({
  open,
  onOpenChange,
  onNewProject,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
  onNewProject(): void;
}) {
  const { t, lang, setLang } = useI18n();
  const { dark, setTheme } = useTheme();
  const { can, signOut } = useSession();
  const projects = useProjects();
  const navigate = useNavigate();
  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };
  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };
  const group =
    'px-1 pt-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3';

  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RDialog.Portal forceMount>
            <RDialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/30"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </RDialog.Overlay>
            <RDialog.Content asChild forceMount>
              <motion.div
                className="fixed top-[14vh] left-1/2 z-50 w-[min(600px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-surface shadow-float"
                initial={{ opacity: 0, scale: 0.97, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: -6 }}
                transition={{ duration: 0.15 }}
              >
                <RDialog.Title className="sr-only">{t('nav.command')}</RDialog.Title>
                <RDialog.Description className="sr-only">
                  {t('nav.commandHint')}
                </RDialog.Description>
                <Command loop>
                  <div className="flex items-center gap-3 border-b border-line px-4">
                    <Search className="size-4 text-ink-3" />
                    <Command.Input
                      autoFocus
                      placeholder={t('nav.command')}
                      className="h-12 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
                    />
                    <Kbd>Esc</Kbd>
                  </div>
                  <Command.List className="max-h-[50vh] overflow-y-auto p-1.5">
                    <Command.Empty className="px-3 py-8 text-center text-sm text-ink-3">
                      {t('nav.noResults')}
                    </Command.Empty>
                    <Command.Group heading={t('nav.goTo')} className={group}>
                      <Item icon={<Home />} onSelect={() => go('/')}>
                        {t('nav.home')}
                      </Item>
                      <Item icon={<FolderKanban />} onSelect={() => go('/projects')}>
                        {t('nav.projects')}
                      </Item>
                      {can('user:manage') && (
                        <Item icon={<Users />} onSelect={() => go('/users')}>
                          {t('nav.users')}
                        </Item>
                      )}
                      <Item icon={<User />} onSelect={() => go('/account')}>
                        {t('nav.account')}
                      </Item>
                    </Command.Group>
                    {(projects.data ?? []).length > 0 && (
                      <Command.Group heading={t('nav.recent')} className={group}>
                        {(projects.data ?? []).map((p) => (
                          <div key={p.id}>
                            <Item
                              icon={<PenLine />}
                              onSelect={() => go(`/projects/${p.id}/annotate`)}
                              hint={t('project.tabs.annotate')}
                            >
                              {p.name}
                            </Item>
                            {can('review') && (
                              <Item
                                icon={<ShieldCheck />}
                                onSelect={() => go(`/projects/${p.id}/review`)}
                                hint={t('project.tabs.review')}
                              >
                                {p.name}
                              </Item>
                            )}
                            {can('project:read_all') && (
                              <Item
                                icon={<Table2 />}
                                onSelect={() => go(`/projects/${p.id}/data`)}
                                hint={t('project.tabs.data')}
                              >
                                {p.name}
                              </Item>
                            )}
                          </div>
                        ))}
                      </Command.Group>
                    )}
                    <Command.Group heading={t('nav.actions')} className={group}>
                      {can('project:manage') && (
                        <Item icon={<Plus />} onSelect={() => run(onNewProject)}>
                          {t('nav.newProject')}
                        </Item>
                      )}
                      <Item
                        icon={<MoonStar />}
                        onSelect={() => run(() => setTheme(dark ? 'light' : 'dark'))}
                      >
                        {t('nav.toggleTheme')}
                      </Item>
                      <Item
                        icon={<Languages />}
                        onSelect={() => run(() => setLang(lang === 'en' ? 'zh' : 'en'))}
                      >
                        {t('nav.switchLanguage')}
                      </Item>
                      <Item icon={<LogOut />} onSelect={() => run(() => void signOut())}>
                        {t('nav.signOut')}
                      </Item>
                    </Command.Group>
                  </Command.List>
                </Command>
              </motion.div>
            </RDialog.Content>
          </RDialog.Portal>
        )}
      </AnimatePresence>
    </RDialog.Root>
  );
}
