import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Check, Languages } from 'lucide-react';
import { motion } from 'motion/react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { LogoMark } from '../../components/shell/Logo';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/ui/display';
import { Field, Input } from '../../components/ui/form';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { AnnotationDemo } from './AnnotationDemo';

function AuthLayout({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  return (
    <div className="flex min-h-screen">
      <div className="relative hidden w-[52%] flex-col justify-between overflow-hidden bg-[#111114] p-12 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              'radial-gradient(60% 50% at 20% 10%, rgba(76,82,214,0.35), transparent 70%), radial-gradient(40% 40% at 90% 90%, rgba(252,211,77,0.12), transparent 70%)',
          }}
        />
        <div className="relative flex items-center gap-2.5">
          <LogoMark className="[&_rect:first-child]:fill-white [&_path]:stroke-[#111114]" />
          <span className="text-[15px] font-semibold tracking-tight">{t('app.name')}</span>
        </div>
        <div className="relative flex flex-col gap-10">
          <div className="max-w-lg">
            <h1 className="text-[34px] leading-[1.15] font-semibold tracking-tight">
              {t('auth.heroTitle')}
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed text-white/60">{t('auth.heroBody')}</p>
          </div>
          <AnnotationDemo />
          <ul className="flex max-w-lg flex-col gap-2.5">
            {(['heroPoint1', 'heroPoint2', 'heroPoint3'] as const).map((k, i) => (
              <motion.li
                key={k}
                className="flex items-start gap-2.5 text-[13.5px] text-white/70"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.12 }}
              >
                <Check className="mt-0.5 size-4 shrink-0 text-marker" />
                {t(`auth.${k}`)}
              </motion.li>
            ))}
          </ul>
        </div>
        <div className="relative text-xs text-white/35">{t('app.tagline')}</div>
      </div>
      <div className="relative flex flex-1 items-center justify-center px-6 py-12">
        <button
          type="button"
          onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
          className="absolute top-5 right-5 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-3 hover:bg-surface-2 hover:text-ink"
        >
          <Languages className="size-3.5" />
          {lang === 'en' ? '中文' : 'English'}
        </button>
        <motion.div
          className="w-full max-w-[360px]"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <LogoMark />
            <span className="text-[15px] font-semibold">{t('app.name')}</span>
          </div>
          {children}
        </motion.div>
      </div>
    </div>
  );
}

function useAuthForm(
  submit: (v: {
    username: string;
    password: string;
    displayName?: string;
  }) => Promise<import('@crowd/shared').Me>,
) {
  const { signedIn } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  return useMutation({
    mutationFn: submit,
    onSuccess: (me) => {
      signedIn(me);
      const next = params.get('next');
      navigate(next?.startsWith('/') ? next : '/', { replace: true });
    },
  });
}

export function LoginPage() {
  const { t } = useI18n();
  const { state, me } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useAuthForm(api.auth.login);

  if (state.isLoading) return <FullPageSpinner />;
  if (state.data?.needsSetup) return <Navigate to="/setup" replace />;
  if (me) return <Navigate to="/" replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ username, password });
  };
  return (
    <AuthLayout>
      <h2 className="text-2xl font-semibold tracking-tight">{t('auth.signInTitle')}</h2>
      <p className="mt-1.5 text-[13.5px] text-ink-3">{t('auth.signInSubtitle')}</p>
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        <Field label={t('auth.username')} htmlFor="username">
          <Input
            id="username"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </Field>
        <Field label={t('auth.password')} htmlFor="password" error={login.error?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={login.isPending}
          className="mt-2 w-full"
        >
          {login.isPending ? t('auth.signingIn') : t('auth.signIn')}
          {!login.isPending && <ArrowRight className="size-4" />}
        </Button>
      </form>
      {state.data?.demo && state.data.demo.length > 0 && (
        <DemoAccounts accounts={state.data.demo} />
      )}
      {state.data?.registrationOpen && (
        <p className="mt-6 text-center text-[13px] text-ink-3">
          {t('auth.noAccount')}{' '}
          <Link to="/register" className="font-medium text-accent hover:underline">
            {t('auth.register')}
          </Link>
        </p>
      )}
    </AuthLayout>
  );
}

function AccountForm({
  title,
  subtitle,
  button,
  mutation,
  footer,
}: {
  title: string;
  subtitle: string;
  button: string;
  mutation: ReturnType<typeof useAuthForm>;
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate({ username, password, displayName: displayName || undefined });
  };
  return (
    <>
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-3">{subtitle}</p>
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        <Field label={t('auth.username')} htmlFor="username">
          <Input
            id="username"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </Field>
        <Field
          label={t('auth.displayName')}
          htmlFor="displayName"
          aside={<span className="text-xs text-ink-3">{t('common.optional')}</span>}
        >
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </Field>
        <Field
          label={t('auth.password')}
          htmlFor="password"
          hint={t('auth.passwordHint')}
          error={mutation.error?.message}
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={mutation.isPending}
          className="mt-2 w-full"
        >
          {button}
        </Button>
      </form>
      {footer}
    </>
  );
}

export function SetupPage() {
  const { t } = useI18n();
  const { state } = useSession();
  const setup = useAuthForm(api.auth.setup);
  if (state.isLoading) return <FullPageSpinner />;
  if (state.data && !state.data.needsSetup) return <Navigate to="/login" replace />;
  return (
    <AuthLayout>
      <AccountForm
        title={t('auth.setupTitle')}
        subtitle={t('auth.setupSubtitle')}
        button={t('auth.setupButton')}
        mutation={setup}
      />
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { t } = useI18n();
  const { state, me } = useSession();
  const register = useAuthForm(api.auth.register);
  if (state.isLoading) return <FullPageSpinner />;
  if (state.data?.needsSetup) return <Navigate to="/setup" replace />;
  if (me) return <Navigate to="/" replace />;
  if (!state.data?.registrationOpen) return <Navigate to="/login" replace />;
  return (
    <AuthLayout>
      <AccountForm
        title={t('auth.registerTitle')}
        subtitle={t('auth.registerSubtitle')}
        button={t('auth.registerButton')}
        mutation={register}
        footer={
          <p className="mt-6 text-center text-[13px] text-ink-3">
            {t('auth.haveAccount')}{' '}
            <Link to="/login" className="font-medium text-accent hover:underline">
              {t('auth.signIn')}
            </Link>
          </p>
        }
      />
    </AuthLayout>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="size-5" />
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { state, me } = useSession();
  if (state.isLoading) return <FullPageSpinner />;
  if (state.data?.needsSetup) return <Navigate to="/setup" replace />;
  if (!me)
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  return <>{children}</>;
}

function DemoAccounts({
  accounts,
}: {
  accounts: NonNullable<import('@crowd/shared').AuthState['demo']>;
}) {
  const { t } = useI18n();
  const enter = useAuthForm((v) => api.auth.demo(v.username));
  return (
    <div className="mt-8 rounded-2xl border border-dashed border-line-2 p-4">
      <div className="text-[13px] font-medium text-ink">{t('auth.demoTitle')}</div>
      <p className="mt-1 text-xs leading-relaxed text-ink-3">{t('auth.demoHint')}</p>
      <div className="mt-3 flex flex-col gap-1.5">
        {accounts.map((a) => (
          <button
            key={a.username}
            type="button"
            disabled={enter.isPending}
            onClick={() => enter.mutate({ username: a.username, password: '' })}
            className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-left text-[13px] transition-colors hover:border-line-2 hover:bg-surface-2 disabled:opacity-60"
          >
            <span className="font-medium text-ink">{a.displayName ?? a.username}</span>
            <span className="text-xs text-ink-3">{t(`roles.${a.role}`)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
