import { lazy } from 'react';
import { createBrowserRouter, useNavigate } from 'react-router';
import { AppShell } from './components/shell/AppShell';
import { Button } from './components/ui/button';
import { EmptyState } from './components/ui/display';
import { LoginPage, RegisterPage, RequireAuth, SetupPage } from './features/auth/AuthPages';
import { HomePage } from './features/home/HomePage';
import { OverviewPage } from './features/projects/OverviewPage';
import { ProjectIndex, ProjectLayout } from './features/projects/ProjectLayout';
import { ProjectsPage } from './features/projects/ProjectsPage';
import { useI18n } from './i18n';

// The heavier screens load on demand.
const AnnotatePage = lazy(() =>
  import('./features/annotate/AnnotatePage').then((m) => ({ default: m.AnnotatePage })),
);
const ReviewPage = lazy(() =>
  import('./features/review/ReviewPage').then((m) => ({ default: m.ReviewPage })),
);
const DataPage = lazy(() =>
  import('./features/data/DataPage').then((m) => ({ default: m.DataPage })),
);
const LlmPage = lazy(() => import('./features/llm/LlmPage').then((m) => ({ default: m.LlmPage })));
const ModelsPage = lazy(() =>
  import('./features/models/ModelsPage').then((m) => ({ default: m.ModelsPage })),
);
const SettingsPage = lazy(() =>
  import('./features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const UsersPage = lazy(() =>
  import('./features/users/UsersPage').then((m) => ({ default: m.UsersPage })),
);
const AccountPage = lazy(() =>
  import('./features/account/AccountPage').then((m) => ({ default: m.AccountPage })),
);

function NotFound() {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <EmptyState
      title={t('errors.notFound')}
      body={t('errors.notFoundBody')}
      action={<Button onClick={() => navigate('/')}>{t('nav.home')}</Button>}
    />
  );
}

export const router = createBrowserRouter([
  { path: '/setup', element: <SetupPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'projects', element: <ProjectsPage /> },
      {
        path: 'projects/:id',
        element: <ProjectLayout />,
        children: [
          { index: true, element: <ProjectIndex overview={<OverviewPage />} /> },
          { path: 'annotate', element: <AnnotatePage /> },
          { path: 'review', element: <ReviewPage /> },
          { path: 'data', element: <DataPage /> },
          { path: 'llm', element: <LlmPage /> },
          { path: 'models', element: <ModelsPage /> },
          { path: 'settings', element: <SettingsPage /> },
        ],
      },
      { path: 'users', element: <UsersPage /> },
      { path: 'account', element: <AccountPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
