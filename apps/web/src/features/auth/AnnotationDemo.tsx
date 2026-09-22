import { Bot, Check, UserRound } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { type CSSProperties, useEffect, useState } from 'react';
import { useI18n } from '../../i18n';

interface Ent {
  text: string;
  label: string;
  draft: string;
}

const SAMPLES: Record<'en' | 'zh', { parts: (string | Ent)[] }> = {
  en: {
    parts: [
      { text: 'Maria Chen', label: 'PER', draft: 'PER' },
      ' joined ',
      { text: 'Acme Robotics', label: 'ORG', draft: 'ORG' },
      ' in ',
      { text: 'Berlin', label: 'LOC', draft: 'ORG' },
      ' ',
      { text: 'last March', label: 'TIME', draft: 'TIME' },
      '.',
    ],
  },
  zh: {
    parts: [
      { text: '张伟', label: 'PER', draft: 'PER' },
      '在',
      { text: '去年三月', label: 'TIME', draft: 'TIME' },
      '加入了',
      { text: '北京', label: 'LOC', draft: 'ORG' },
      '的',
      { text: '星海科技', label: 'ORG', draft: 'ORG' },
      '。',
    ],
  },
};

const COLORS: Record<string, string> = {
  PER: '#2a78d6',
  ORG: '#4a3aa7',
  LOC: '#1baf7a',
  TIME: '#eda100',
};

/**
 * The product in one loop: a model drafts entities (dashed), a person confirms three and
 * corrects one, and the two versions are kept side by side.
 */
export function AnnotationDemo() {
  const { lang, t } = useI18n();
  const reduce = useReducedMotion();
  const [step, setStep] = useState(reduce ? 3 : 0);

  useEffect(() => {
    if (reduce) return;
    const durations = [1400, 1800, 2200, 3200];
    const timer = setTimeout(() => setStep((s) => (s + 1) % 4), durations[step]);
    return () => clearTimeout(timer);
  }, [step, reduce]);

  const sample = SAMPLES[lang];
  const ents = sample.parts.filter((p): p is Ent => typeof p !== 'string');
  const corrected = ents.filter((e) => e.draft !== e.label).length;

  return (
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl backdrop-blur">
      <div className="mb-5 flex items-center gap-2 text-xs text-white/50">
        <AnimatePresence mode="wait">
          {step < 2 ? (
            <motion.span
              key="bot"
              className="flex items-center gap-1.5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Bot className="size-3.5" /> qwen3:4b · {t('auth.heroDraft')}
            </motion.span>
          ) : (
            <motion.span
              key="human"
              className="flex items-center gap-1.5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <UserRound className="size-3.5" /> alice · {t('auth.heroReview')}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <p className="text-[21px] leading-[2.3] text-white/90">
        {sample.parts.map((p, i) => {
          if (typeof p === 'string') return <span key={i}>{p}</span>;
          const idx = ents.indexOf(p);
          const shown = step >= 1;
          const human = step >= 2;
          const label = human ? p.label : p.draft;
          const color = COLORS[label]!;
          return (
            <span key={i} className="relative">
              <motion.span
                className="relative z-10 rounded-[3px] px-0.5"
                style={{ '--c': color } as CSSProperties}
                animate={{
                  backgroundColor: human ? `${color}40` : 'rgba(0,0,0,0)',
                  boxShadow: shown ? `inset 0 -2px 0 ${color}` : 'inset 0 -2px 0 rgba(0,0,0,0)',
                }}
                transition={{ duration: 0.35, delay: shown && !human ? idx * 0.18 : 0 }}
              >
                {p.text}
              </motion.span>
              <AnimatePresence>
                {shown && (
                  <motion.span
                    key={label}
                    className="absolute -top-4 left-0 z-20 rounded px-1 text-[9px] leading-[14px] font-semibold tracking-wide text-white"
                    style={{ background: color }}
                    initial={{ opacity: 0, y: 4, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.25, delay: step === 1 ? idx * 0.18 : 0 }}
                  >
                    {label}
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          );
        })}
      </p>
      <div className="mt-6 h-12 border-t border-white/10 pt-4">
        <AnimatePresence mode="wait">
          {step === 3 && (
            <motion.div
              key="summary"
              className="flex items-center justify-between text-xs"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <span className="flex items-center gap-1.5 text-white/70">
                <Check className="size-3.5 text-emerald-400" />
                {t('auth.heroSummary', { kept: ents.length - corrected, corrected })}
              </span>
              <span className="font-mono text-[10.5px] text-white/40">source: human ≠ llm</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
