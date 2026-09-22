import { ROLES, type Role, type UserSummary } from '@crowd/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Avatar, Badge, PageHeader, Skeleton } from '../../components/ui/display';
import { Field, Input, Select, Switch } from '../../components/ui/form';
import { Dialog } from '../../components/ui/overlay';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { qk, useUsers } from '../../lib/queries';
import { useSession } from '../../lib/session';

export function UsersPage() {
  const { t, fmt } = useI18n();
  const { me } = useSession();
  const users = useUsers();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<UserSummary | null>(null);
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Parameters<typeof api.users.update>[1] }) =>
      api.users.update(id, patch),
    onSuccess: () => {
      toast.success(t('users.updated'));
      void qc.invalidateQueries({ queryKey: qk.users });
    },
    onError: (e) => toast.error(e.message),
  });
  const roleOptions = ROLES.map((r) => ({
    value: r,
    label: t(`roles.${r}`),
    hint: t(`users.roleHelp.${r}`),
  }));

  return (
    <div>
      <PageHeader
        title={t('nav.users')}
        actions={
          <Button
            variant="primary"
            icon={<UserPlus className="size-4" />}
            onClick={() => setCreating(true)}
          >
            {t('users.new')}
          </Button>
        }
      />
      <div className="card overflow-hidden">
        {users.isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line bg-surface-2/50 text-left text-xs text-ink-3">
                  <th className="px-5 py-2.5 font-medium">{t('overview.person')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('users.role')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('users.status')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t('users.submitted')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t('users.last7d')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('users.lastSeen')}</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="tabular">
                {(users.data ?? []).map((u) => (
                  <tr key={u.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar user={u} size={30} />
                        <div>
                          <div className="font-medium text-ink">
                            {u.displayName ?? u.username}
                            {u.id === me?.id && (
                              <span className="ml-1.5 text-xs font-normal text-ink-3">
                                ({t('users.you')})
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-ink-3">@{u.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Select<Role>
                        size="sm"
                        className="w-36"
                        value={u.role}
                        onChange={(role) => update.mutate({ id: u.id, patch: { role } })}
                        options={roleOptions}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={!u.disabled}
                          onChange={(v) => update.mutate({ id: u.id, patch: { disabled: !v } })}
                          disabled={u.id === me?.id}
                        />
                        {u.disabled ? (
                          <Badge>{t('users.disabled')}</Badge>
                        ) : (
                          <span className="text-xs text-ink-3">{t('users.active')}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-ink">
                      {fmt.number(u.stats.submitted)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-ink-2">
                      {fmt.number(u.stats.last7d)}
                    </td>
                    <td className="px-3 py-2.5 text-ink-3">
                      {u.lastSeenAt ? fmt.relative(u.lastSeenAt) : t('users.never')}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <Button
                        size="xs"
                        variant="ghost"
                        icon={<KeyRound className="size-3.5" />}
                        onClick={() => setResetting(u)}
                      >
                        {t('users.resetPassword')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
    </div>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('annotator');
  const create = useMutation({
    mutationFn: () =>
      api.users.create({ username, password, role, displayName: displayName || undefined }),
    onSuccess: () => {
      toast.success(t('users.created'));
      void qc.invalidateQueries({ queryKey: qk.users });
      onOpenChange(false);
      setUsername('');
      setDisplayName('');
      setPassword('');
      setRole('annotator');
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('users.newTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={!username || password.length < 8}
          >
            {t('common.create')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('auth.username')}>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </Field>
          <Field label={t('auth.displayName')}>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
        </div>
        <Field
          label={t('auth.password')}
          hint={t('auth.passwordHint')}
          error={create.error?.message}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label={t('users.role')} hint={t(`users.roleHelp.${role}`)}>
          <Select<Role>
            value={role}
            onChange={setRole}
            options={ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))}
          />
        </Field>
      </div>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: UserSummary | null; onClose(): void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const reset = useMutation({
    mutationFn: () => api.users.update(user!.id, { password }),
    onSuccess: () => {
      toast.success(t('users.updated'));
      setPassword('');
      onClose();
    },
  });
  return (
    <Dialog
      open={!!user}
      onOpenChange={(o) => !o && onClose()}
      title={t('users.resetTitle', { name: user?.displayName ?? user?.username ?? '' })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => reset.mutate()}
            loading={reset.isPending}
            disabled={password.length < 8}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field
        label={t('account.newPassword')}
        hint={t('auth.passwordHint')}
        error={reset.error?.message}
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
      </Field>
    </Dialog>
  );
}
