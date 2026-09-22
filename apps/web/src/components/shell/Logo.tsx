import { cn } from '../../lib/utils';

/** Two lines of text, one of them highlighted: a label on a sentence. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-ink" />
      <rect x="7" y="17" width="18" height="6" rx="2" className="fill-marker" opacity="0.95" />
      <path d="M8 12h16M8 20h9" className="stroke-bg" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
