export const ROLES = ['admin', 'reviewer', 'annotator'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Capabilities are what routes check. Roles are only a named bundle of them, so a route
 * never asks "is this an admin?" — it asks "may this user review?".
 */
export const CAPABILITIES = [
  'annotate',
  'review',
  'project:read_all',
  'project:manage',
  'data:export',
  'llm:run',
  'model:train',
  'user:manage',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  admin: CAPABILITIES,
  reviewer: ['annotate', 'review', 'project:read_all', 'data:export'],
  annotator: ['annotate'],
};

export function can(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export const PROJECT_TYPES = ['classification', 'ner'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

/** Where a label came from. These are never merged: that separation is the point of the platform. */
export const ANNOTATION_SOURCES = ['human', 'llm', 'import'] as const;
export type AnnotationSource = (typeof ANNOTATION_SOURCES)[number];

/**
 * Human annotation lifecycle:
 *   claimed ──submit──▶ submitted ──reject──▶ rejected ──(served again)──▶ claimed
 *      └──skip──▶ skipped
 * LLM drafts are `submitted` (parsed) or `error` (call or parse failed — never a label).
 */
export const ANNOTATION_STATUSES = [
  'claimed',
  'submitted',
  'skipped',
  'rejected',
  'error',
] as const;
export type AnnotationStatus = (typeof ANNOTATION_STATUSES)[number];

/** How an item's final label was decided. */
export const FINAL_SOURCES = ['consensus', 'review', 'import'] as const;
export type FinalSource = (typeof FINAL_SOURCES)[number];

/** Derived for listing and filtering; not stored. */
export const ITEM_STATES = ['unlabeled', 'in_progress', 'needs_review', 'finalized'] as const;
export type ItemState = (typeof ITEM_STATES)[number];

export const LLM_PROVIDERS = ['ollama', 'anthropic', 'openai', 'mock'] as const;
export type LlmProviderId = (typeof LLM_PROVIDERS)[number];

export const JOB_KINDS = ['prelabel', 'train'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const TRAIN_SOURCES = ['final', 'human', 'llm', 'llm+human', 'import'] as const;
export type TrainSource = (typeof TRAIN_SOURCES)[number];

export const EXPORT_FORMATS = ['jsonl', 'csv', 'conll'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_LABEL_SETS = ['final', 'human', 'llm', 'import', 'all'] as const;
export type ExportLabelSet = (typeof EXPORT_LABEL_SETS)[number];
