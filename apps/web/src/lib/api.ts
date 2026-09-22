import type {
  AgreementReport,
  ApiErrorBody,
  AssignmentRange,
  AssignmentsView,
  AuthState,
  BulkFinalizeInput,
  ClaimView,
  CreateProjectInput,
  CreateUserInput,
  DraftQuality,
  ExportFormat,
  ExportLabelSet,
  FinalizeInput,
  HistoryEntry,
  ImportBatchInput,
  ImportResult,
  ItemDetail,
  ItemListQuery,
  ItemPage,
  JobView,
  LlmPreviewInput,
  Me,
  ModelSummary,
  MyStats,
  Overview,
  Prediction,
  PrelabelJobInput,
  PreviewRow,
  ProjectDTO,
  ProjectListEntry,
  ProviderInfo,
  QueueView,
  ReviewEntry,
  ReviewQueue,
  ReviewQueueQuery,
  SubmitAnnotationInput,
  SubmitResult,
  TrainJobInput,
  UpdateProjectInput,
  UpdateUserInput,
  UserSummary,
} from '@crowd/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function qs(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query))
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** Called when a request comes back 401 while signed in; the app sends the user to /login. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'The server is not reachable.');
  }
  if (!res.ok) {
    let payload: ApiErrorBody | undefined;
    try {
      payload = (await res.json()) as ApiErrorBody;
    } catch {
      payload = undefined;
    }
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
    throw new ApiError(
      res.status,
      payload?.error.code ?? 'http_error',
      payload?.error.message ?? res.statusText,
      payload?.error.details,
    );
  }
  return (await res.json()) as T;
}

const get = <T>(path: string, query?: Query) => request<T>('GET', `${path}${qs(query)}`);
const post = <T>(path: string, body: unknown = {}) => request<T>('POST', path, body);
const put = <T>(path: string, body: unknown) => request<T>('PUT', path, body);
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body);
const del = <T>(path: string) => request<T>('DELETE', path);

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const api = {
  auth: {
    state: () => get<AuthState>('/auth/state'),
    setup: (body: { username: string; password: string; displayName?: string }) =>
      post<Me>('/auth/setup', body),
    login: (body: { username: string; password: string }) => post<Me>('/auth/login', body),
    register: (body: { username: string; password: string; displayName?: string }) =>
      post<Me>('/auth/register', body),
    logout: () => post<{ ok: true }>('/auth/logout'),
    demo: (username: string) => post<Me>('/auth/demo', { username }),
  },
  me: {
    update: (body: { displayName: string | null }) => patch<Me>('/me', body),
    password: (body: { current: string; next: string }) => post<{ ok: true }>('/me/password', body),
    stats: () => get<MyStats>('/me/stats', { tz: tz() }),
  },
  users: {
    list: () => get<UserSummary[]>('/users'),
    create: (body: CreateUserInput) => post<Me>('/users', body),
    update: (id: number, body: UpdateUserInput) => patch<Me>(`/users/${id}`, body),
  },
  projects: {
    list: () => get<ProjectListEntry[]>('/projects'),
    get: (id: number) => get<ProjectDTO>(`/projects/${id}`),
    create: (body: CreateProjectInput) => post<ProjectDTO>('/projects', body),
    update: (id: number, body: UpdateProjectInput) => patch<ProjectDTO>(`/projects/${id}`, body),
    remove: (id: number) => del<{ ok: true }>(`/projects/${id}`),
    assignments: (id: number) => get<AssignmentsView>(`/projects/${id}/assignments`),
    setAssignments: (id: number, ranges: AssignmentRange[]) =>
      put<AssignmentsView>(`/projects/${id}/assignments`, { ranges }),
  },
  queue: {
    next: (pid: number) => get<QueueView>(`/projects/${pid}/queue`),
    history: (pid: number, before?: number) =>
      get<HistoryEntry[]>(`/projects/${pid}/history`, { limit: 30, before }),
    submit: (pid: number, annId: number, body: SubmitAnnotationInput) =>
      post<SubmitResult>(`/projects/${pid}/annotations/${annId}/submit`, body),
    edit: (pid: number, annId: number, body: SubmitAnnotationInput) =>
      put<{ finalized: boolean }>(`/projects/${pid}/annotations/${annId}`, body),
    skip: (pid: number, annId: number, reason?: string) =>
      post<QueueView>(`/projects/${pid}/annotations/${annId}/skip`, { reason }),
    reclaim: (pid: number, annId: number) =>
      post<ClaimView>(`/projects/${pid}/annotations/${annId}/reclaim`),
    /** Fire-and-forget when the workspace closes, so the item is free for someone else. */
    release: (pid: number, annId: number) => {
      const url = `/api/projects/${pid}/annotations/${annId}/release`;
      if (!navigator.sendBeacon?.(url))
        void fetch(url, { method: 'POST', keepalive: true, credentials: 'same-origin' });
    },
  },
  items: {
    list: (pid: number, query: ItemListQuery) =>
      get<ItemPage>(`/projects/${pid}/items`, query as Query),
    detail: (pid: number, itemId: number) => get<ItemDetail>(`/projects/${pid}/items/${itemId}`),
    importBatch: (pid: number, body: ImportBatchInput) =>
      post<ImportResult>(`/projects/${pid}/items/batch`, body),
    remove: (pid: number, ids: number[]) =>
      post<{ deleted: number }>(`/projects/${pid}/items/delete`, { ids }),
    finalize: (pid: number, itemId: number, body: FinalizeInput) =>
      post<ReviewEntry>(`/projects/${pid}/items/${itemId}/finalize`, body),
    reopen: (pid: number, itemId: number) =>
      post<ReviewEntry>(`/projects/${pid}/items/${itemId}/reopen`),
  },
  review: {
    queue: (pid: number, query: ReviewQueueQuery) =>
      get<ReviewQueue>(`/projects/${pid}/review`, query as Query),
    bulkFinalize: (pid: number, body: BulkFinalizeInput) =>
      post<{ finalized: number; skipped: number }>(`/projects/${pid}/review/bulk-finalize`, body),
    reject: (pid: number, annId: number, note: string) =>
      post<{ ok: true }>(`/projects/${pid}/annotations/${annId}/reject`, { note }),
  },
  stats: {
    overview: (pid: number) => get<Overview>(`/projects/${pid}/stats/overview`, { tz: tz() }),
    agreement: (pid: number) => get<AgreementReport>(`/projects/${pid}/stats/agreement`),
    drafts: (pid: number, reference: 'final' | 'human' | 'import') =>
      get<DraftQuality>(`/projects/${pid}/stats/drafts`, { reference }),
  },
  llm: {
    providers: () => get<ProviderInfo[]>('/llm/providers'),
    preview: (pid: number, body: LlmPreviewInput) =>
      post<PreviewRow[]>(`/projects/${pid}/llm/preview`, body),
    start: (pid: number, body: PrelabelJobInput) =>
      post<JobView>(`/projects/${pid}/llm/jobs`, body),
  },
  models: {
    list: (pid: number) => get<ModelSummary[]>(`/projects/${pid}/models`),
    train: (pid: number, body: TrainJobInput) => post<JobView>(`/projects/${pid}/models`, body),
    predict: (pid: number, jobId: number, text: string) =>
      post<Prediction>(`/projects/${pid}/models/${jobId}/predict`, { text }),
    remove: (pid: number, jobId: number) => del<{ ok: true }>(`/projects/${pid}/models/${jobId}`),
  },
  jobs: {
    list: (projectId?: number) => get<JobView[]>('/jobs', { projectId }),
    get: (id: number) => get<JobView>(`/jobs/${id}`),
    cancel: (id: number) => post<JobView>(`/jobs/${id}/cancel`),
  },
  exportUrl: (
    pid: number,
    opts: {
      format: ExportFormat;
      labels: ExportLabelSet;
      onlyFinalized: boolean;
      includeMeta: boolean;
    },
  ) =>
    `/api/projects/${pid}/export${qs({
      format: opts.format,
      labels: opts.labels,
      onlyFinalized: String(opts.onlyFinalized),
      includeMeta: String(opts.includeMeta),
    })}`,
};
