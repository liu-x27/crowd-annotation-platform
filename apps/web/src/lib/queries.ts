import type { ItemListQuery, ReviewQueueQuery } from '@crowd/shared';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { ApiError, api } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

/** Every query key in one place, so invalidation after server events is exhaustive. */
export const qk = {
  auth: ['auth'] as const,
  projects: ['projects'] as const,
  project: (id: number) => ['project', id] as const,
  items: (id: number, q?: ItemListQuery) =>
    q ? (['items', id, q] as const) : (['items', id] as const),
  item: (pid: number, itemId: number) => ['item', pid, itemId] as const,
  history: (id: number) => ['history', id] as const,
  review: (id: number, q?: ReviewQueueQuery) =>
    q ? (['review', id, q] as const) : (['review', id] as const),
  stats: (id: number) => ['stats', id] as const,
  overview: (id: number) => ['stats', id, 'overview'] as const,
  agreement: (id: number) => ['stats', id, 'agreement'] as const,
  drafts: (id: number, ref: string) => ['stats', id, 'drafts', ref] as const,
  providers: ['providers'] as const,
  models: (id: number) => ['models', id] as const,
  jobs: (id?: number) => ['jobs', id ?? 'all'] as const,
  epochs: (jobId: number) => ['epochs', jobId] as const,
  users: ['users'] as const,
  myStats: ['me', 'stats'] as const,
  assignments: (id: number) => ['assignments', id] as const,
};

export const useAuthState = () =>
  useQuery({ queryKey: qk.auth, queryFn: api.auth.state, staleTime: 60_000 });
export const useProjects = () => useQuery({ queryKey: qk.projects, queryFn: api.projects.list });
export const useProject = (id: number) =>
  useQuery({
    queryKey: qk.project(id),
    queryFn: () => api.projects.get(id),
    enabled: Number.isFinite(id),
  });
export const useOverview = (id: number, enabled = true) =>
  useQuery({ queryKey: qk.overview(id), queryFn: () => api.stats.overview(id), enabled });
export const useAgreement = (id: number, enabled = true) =>
  useQuery({ queryKey: qk.agreement(id), queryFn: () => api.stats.agreement(id), enabled });
export const useDraftQuality = (
  id: number,
  reference: 'final' | 'human' | 'import',
  enabled = true,
) =>
  useQuery({
    queryKey: qk.drafts(id, reference),
    queryFn: () => api.stats.drafts(id, reference),
    enabled,
  });
export const useJobs = (projectId?: number, enabled = true) =>
  useQuery({ queryKey: qk.jobs(projectId), queryFn: () => api.jobs.list(projectId), enabled });
export const useModels = (id: number) =>
  useQuery({ queryKey: qk.models(id), queryFn: () => api.models.list(id) });
export const useProviders = (enabled = true) =>
  useQuery({ queryKey: qk.providers, queryFn: api.llm.providers, staleTime: 30_000, enabled });
export const useUsers = (enabled = true) =>
  useQuery({ queryKey: qk.users, queryFn: api.users.list, enabled });
export const useMyStats = () => useQuery({ queryKey: qk.myStats, queryFn: api.me.stats });
