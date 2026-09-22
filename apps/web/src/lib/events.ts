import type { EpochStats, JobView, ServerEvent } from '@crowd/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { qk } from './queries';

/**
 * One EventSource for the whole app. Server events never carry data the UI renders
 * directly except job progress and training epochs; everything else is a hint to refetch.
 * EventSource reconnects by itself, so "offline" is transient.
 */
export function useServerEvents(enabled: boolean): boolean {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource('/api/events');
    const on = <T extends ServerEvent['type']>(
      type: T,
      fn: (e: Extract<ServerEvent, { type: T }>) => void,
    ) => es.addEventListener(type, (msg) => fn(JSON.parse((msg as MessageEvent).data)));

    es.addEventListener('ready', () => setConnected(true));
    es.onerror = () => setConnected(false);

    on('job', ({ job }) => {
      qc.setQueryData<JobView[]>(qk.jobs(job.projectId ?? undefined), (list) => upsert(list, job));
      qc.setQueryData<JobView[]>(qk.jobs(), (list) => upsert(list, job));
      if (job.status !== 'running' && job.status !== 'queued' && job.projectId != null) {
        void qc.invalidateQueries({ queryKey: qk.stats(job.projectId) });
        void qc.invalidateQueries({ queryKey: qk.items(job.projectId) });
        void qc.invalidateQueries({ queryKey: qk.models(job.projectId) });
      }
    });

    on('epoch', ({ jobId, epoch }) => {
      qc.setQueryData<EpochStats[]>(qk.epochs(jobId), (prev = []) =>
        prev.some((e) => e.epoch === epoch.epoch) ? prev : [...prev, epoch],
      );
    });

    on('project', ({ projectId, reason }) => {
      void qc.invalidateQueries({ queryKey: qk.projects });
      void qc.invalidateQueries({ queryKey: qk.stats(projectId) });
      if (reason === 'settings') void qc.invalidateQueries({ queryKey: qk.project(projectId) });
      if (reason !== 'settings') {
        void qc.invalidateQueries({ queryKey: qk.items(projectId) });
        void qc.invalidateQueries({ queryKey: qk.review(projectId) });
      }
    });

    return () => {
      es.close();
      setConnected(false);
    };
  }, [enabled, qc]);

  return connected;
}

function upsert(list: JobView[] | undefined, job: JobView): JobView[] | undefined {
  if (!list) return list;
  const i = list.findIndex((j) => j.id === job.id);
  if (i === -1) return [job, ...list];
  const next = [...list];
  next[i] = job;
  return next;
}
