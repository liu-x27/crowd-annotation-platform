import type { JobView, PrelabelResult, TrainReport } from '@crowd/shared';
import { useMutation } from '@tanstack/react-query';
import { Bot, CheckCircle2, CircleSlash, FlaskConical, Loader2, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Badge } from './ui/display';

export function JobStatusBadge({ job }: { job: JobView }) {
  const { t } = useI18n();
  const map: Record<
    JobView['status'],
    { tone: 'neutral' | 'accent' | 'success' | 'danger'; icon: ReactNode }
  > = {
    queued: { tone: 'neutral', icon: <Loader2 /> },
    running: { tone: 'accent', icon: <Loader2 className="animate-spin" /> },
    succeeded: { tone: 'success', icon: <CheckCircle2 /> },
    failed: { tone: 'danger', icon: <XCircle /> },
    cancelled: { tone: 'neutral', icon: <CircleSlash /> },
  };
  const m = map[job.status];
  return (
    <Badge tone={m.tone} icon={m.icon}>
      {t(`jobs.status.${job.status}`)}
    </Badge>
  );
}

/** Live progress of one job, updated by server-sent events through the query cache. */
export function JobCard({ job, compact = false }: { job: JobView; compact?: boolean }) {
  const { t, fmt } = useI18n();
  const cancel = useMutation({
    mutationFn: () => api.jobs.cancel(job.id),
    onError: (e) => toast.error(e.message),
  });
  const { done, total, failed } = job.progress;
  const pct = total ? done / total : job.status === 'succeeded' ? 1 : 0;
  const active = job.status === 'running' || job.status === 'queued';
  const elapsed = job.startedAt
    ? (job.finishedAt ? Date.parse(job.finishedAt) : Date.now()) - Date.parse(job.startedAt)
    : 0;
  const eta = active && done > 0 && total > done ? (elapsed / done) * (total - done) : null;
  const Icon = job.kind === 'train' ? FlaskConical : Bot;

  const summary = (() => {
    if (job.status === 'failed') return job.error;
    if (job.status !== 'succeeded' || !job.result) return job.progress.message;
    if (job.kind === 'prelabel') {
      const r = job.result as PrelabelResult;
      return `${r.model} · ${fmt.number(r.ok)} ✓ · ${fmt.number(r.errors)} ✗${r.meanLatencyMs ? ` · ${fmt.duration(r.meanLatencyMs)}` : ''}`;
    }
    const r = job.result as TrainReport;
    const score = r.kind === 'classification' ? r.test.accuracy : r.test.microF1;
    return `${t(`models.sources.${r.params.source}` as 'models.sources.final')} · ${fmt.percent(score)}`;
  })();

  return (
    <div className={cn('rounded-xl border border-line bg-surface', compact ? 'p-3' : 'p-4')}>
      <div className="flex items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-ink">{t(`jobs.kinds.${job.kind}`)}</span>
            <JobStatusBadge job={job} />
            <span className="ml-auto shrink-0 text-xs text-ink-3">
              {fmt.relative(job.createdAt)}
            </span>
          </div>
          {summary && (
            <div
              className={cn(
                'mt-0.5 truncate text-xs',
                job.status === 'failed' ? 'text-danger' : 'text-ink-3',
              )}
            >
              {summary}
            </div>
          )}
        </div>
        {active && !compact && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => cancel.mutate()}
            loading={cancel.isPending}
          >
            {t('llm.cancel')}
          </Button>
        )}
      </div>
      {(active || (!compact && total > 0)) && (
        <div className="mt-3">
          <div
            className="h-1.5 overflow-hidden rounded-full"
            style={{ background: 'var(--state-track)' }}
          >
            <motion.div
              className={cn('h-full rounded-full', active && 'bg-[length:200%_100%]')}
              style={{
                background: active
                  ? 'linear-gradient(90deg, var(--state-review), color-mix(in oklab, var(--state-review) 60%, white), var(--state-review))'
                  : 'var(--state-review)',
                backgroundSize: '200% 100%',
                animation: active ? 'shimmer 2s linear infinite' : undefined,
              }}
              initial={false}
              animate={{ width: `${Math.max(active ? 2 : 0, pct * 100)}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          </div>
          <div className="tabular mt-1.5 flex justify-between text-[11px] text-ink-3">
            <span>
              {t('llm.progress', { done: fmt.number(done), total: fmt.number(total) })}
              {failed > 0 && (
                <span className="ml-2 text-danger">{t('llm.failedCount', { n: failed })}</span>
              )}
            </span>
            {eta != null && <span>{t('llm.eta', { t: fmt.duration(eta) })}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
