import './styles.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from 'radix-ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { I18nProvider } from './i18n';
import { setUnauthorizedHandler } from './lib/api';
import { qk, queryClient } from './lib/queries';
import { ThemeProvider, useTheme } from './lib/theme';
import { router } from './router';

// A session that expired mid-use: forget who we were and let the auth guard redirect.
setUnauthorizedHandler(() => {
  queryClient.setQueryData(
    qk.auth,
    (prev: { needsSetup: boolean; registrationOpen: boolean } | undefined) =>
      prev ? { ...prev, user: null } : prev,
  );
});

function ThemedToaster() {
  const { dark } = useTheme();
  return (
    <Toaster
      theme={dark ? 'dark' : 'light'}
      position="bottom-right"
      toastOptions={{ className: '!rounded-xl !border-line !bg-surface !text-ink !shadow-float' }}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <Tooltip.Provider delayDuration={250}>
            <RouterProvider router={router} />
            <ThemedToaster />
          </Tooltip.Provider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
