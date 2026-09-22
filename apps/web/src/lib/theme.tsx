import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

const Ctx = createContext<{
  theme: ThemeChoice;
  dark: boolean;
  setTheme: (t: ThemeChoice) => void;
} | null>(null);

const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(
    () => (localStorage.getItem('cap.theme') as ThemeChoice) || 'system',
  );
  const [systemDark, setSystemDark] = useState(() => media().matches);

  useEffect(() => {
    const m = media();
    const listener = () => setSystemDark(m.matches);
    m.addEventListener('change', listener);
    return () => m.removeEventListener('change', listener);
  }, []);

  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const setTheme = useCallback((t: ThemeChoice) => {
    localStorage.setItem('cap.theme', t);
    setThemeState(t);
  }, []);

  return <Ctx.Provider value={{ theme, dark, setTheme }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme outside ThemeProvider');
  return ctx;
}
