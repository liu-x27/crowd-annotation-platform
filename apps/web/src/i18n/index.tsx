import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { en } from './en';
import { zh } from './zh';

export type Lang = 'en' | 'zh';
type Dict = typeof en;

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<Dict>;
type Vars = Record<string, string | number>;

const dictionaries: Record<Lang, Dict> = { en, zh: zh as Dict };

function lookup(dict: Dict, key: string): string {
  let node: unknown = dict;
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  return typeof node === 'string' ? node : key;
}

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export interface Formatters {
  number(n: number | null | undefined): string;
  percent(v: number | null | undefined, digits?: number): string;
  decimal(v: number | null | undefined, digits?: number): string;
  duration(ms: number | null | undefined): string;
  relative(iso: string | null | undefined): string;
  date(iso: string | null | undefined): string;
  dateTime(iso: string | null | undefined): string;
  day(iso: string): string;
}

interface Ctx {
  lang: Lang;
  setLang(lang: Lang): void;
  t(key: MessageKey, vars?: Vars): string;
  fmt: Formatters;
}

const I18nContext = createContext<Ctx | null>(null);

function initialLang(): Lang {
  const saved = localStorage.getItem('cap.lang');
  if (saved === 'en' || saved === 'zh') return saved;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem('cap.lang', l);
    setLangState(l);
  }, []);

  const value = useMemo<Ctx>(() => {
    const dict = dictionaries[lang];
    const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
    const nf = new Intl.NumberFormat(locale);
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    const t = (key: MessageKey, vars?: Vars) => interpolate(lookup(dict, key), vars);
    const na = '—';
    const fmt: Formatters = {
      number: (n) => (n == null ? na : nf.format(n)),
      percent: (v, digits = 1) =>
        v == null || Number.isNaN(v)
          ? na
          : `${(v * 100).toFixed(v === 1 || v === 0 ? 0 : digits)}%`,
      decimal: (v, digits = 2) => (v == null || Number.isNaN(v) ? na : v.toFixed(digits)),
      duration: (ms) => {
        if (ms == null) return na;
        if (ms < 1000) return t('common.ms', { n: Math.round(ms) });
        const s = ms / 1000;
        if (s < 60) return t('common.seconds', { n: s < 10 ? s.toFixed(1) : Math.round(s) });
        return t('common.minutes', { n: (s / 60).toFixed(s < 600 ? 1 : 0) });
      },
      relative: (iso) => {
        if (!iso) return na;
        const diff = (new Date(iso).getTime() - Date.now()) / 1000;
        const abs = Math.abs(diff);
        if (abs < 45) return t('time.justNow');
        if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
        if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
        if (abs < 86_400 * 30) return rtf.format(Math.round(diff / 86_400), 'day');
        return new Date(iso).toLocaleDateString(locale);
      },
      date: (iso) => (iso ? new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium' }) : na),
      dateTime: (iso) =>
        iso
          ? new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
          : na,
      day: (iso) =>
        new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
    };
    return { lang, setLang, t, fmt };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}
