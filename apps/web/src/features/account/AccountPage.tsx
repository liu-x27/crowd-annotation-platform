import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { DailyColumns } from '../../components/charts/bars';
import { Button } from '../../components/ui/button';
import { Avatar, Card, CardTitle, PageHeader, Stat } from '../../components/ui/display';
import { Field, Input, Segmented } from '../../components/ui/form';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { qk, useMyStats } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { type ThemeChoice, useTheme } from '../../lib/theme';

export function AccountPage() {
  const { t, fmt, lang, setLang } = useI18n();
  const { me } = useSession();
  const { theme, setTheme } = useTheme();
  const stats = useMyStats();
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');

  const profile = useMutation({
    mutationFn: () => api.me.update({ displayName: displayName.trim() || null }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      void qc.invalidateQueries({ queryKey: qk.auth });
    },
    onError: (e) => toast.error(e.message),
  });
  const password = useMutation({
    mutationFn: () => api.me.password({ current, next }),
    onSuccess: () => {
      toast.success(t('account.changed'));
      setCurrent('');
      setNext('');
    },
  });
  if (!me) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('nav.account')}
        eyebrow={
          <div className="flex items-center gap-2 text-xs text-ink-3">
            <Avatar user={me} size={22} />@{me.username} · {t(`roles.${me.role}`)}
          </div>
        }
      />
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
        <Card>
          <CardTitle>{t('account.profile')}</CardTitle>
          <div className="flex items-end gap-3">
            <Field label={t('auth.displayName')} className="flex-1">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>
            <Button variant="primary" onClick={() => profile.mutate()} loading={profile.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </Card>
        <Card>
          <CardTitle>{t('account.password')}</CardTitle>
          <form
            className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              password.mutate();
            }}
          >
            <Field label={t('account.currentPassword')}>
              <Input
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>
            <Field label={t('account.newPassword')}>
              <Input
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              loading={password.isPending}
              disabled={!current || next.length < 8}
            >
              {t('common.save')}
            </Button>
          </form>
          {password.error && <p className="mt-2 text-xs text-danger">{password.error.message}</p>}
        </Card>
        <Card>
          <CardTitle>{t('account.preferences')}</CardTitle>
          <div className="flex flex-col gap-4">
            <Field label={t('nav.theme')}>
              <Segmented<ThemeChoice>
                value={theme}
                onChange={setTheme}
                options={[
                  { value: 'light', label: t('nav.light') },
                  { value: 'dark', label: t('nav.dark') },
                  { value: 'system', label: t('nav.system') },
                ]}
              />
            </Field>
            <Field label={t('nav.language')}>
              <Segmented
                value={lang}
                onChange={setLang}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'zh', label: '简体中文' },
                ]}
              />
            </Field>
          </div>
        </Card>
      </div>
    </div>
  );
}
