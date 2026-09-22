import type {
  AnnotationSource,
  AnnotationStatus,
  Capability,
  FinalSource,
  ItemState,
  JobKind,
  JobStatus,
  LlmProviderId,
  ProjectType,
  Role,
} from './constants';
import type { LabelDef } from './labels';
import type { ProjectSettings, TrainJobParams } from './schemas';
import type { EntityGuess, SpanWithText } from './text';

/** Every error response has this shape. `code` is stable; `message` is for humans. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

// ── Accounts ────────────────────────────────────────────────────────────────

export interface UserRef {
  id: number;
  username: string;
  displayName: string | null;
}

export interface Me extends UserRef {
  role: Role;
  capabilities: Capability[];
}

export interface AuthState {
  /** True only while the database has no users: the first account becomes the admin. */
  needsSetup: boolean;
  registrationOpen: boolean;
  /** Only on instances started with DEMO_MODE=true: accounts that can be entered without a password. */
  demo: { username: string; displayName: string | null; role: Role }[] | null;
  user: Me | null;
}

export interface UserSummary extends UserRef {
  role: Role;
  disabled: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  stats: { submitted: number; last7d: number; projects: number };
}

export interface MyStats {
  submitted: number;
  skipped: number;
  today: number;
  last7d: number;
  medianMs: number | null;
  agreeWithFinal: number | null;
  daily: { day: string; submitted: number }[];
}

// ── Projects ────────────────────────────────────────────────────────────────

export interface ProjectCounts {
  items: number;
  unlabeled: number;
  inProgress: number;
  needsReview: number;
  finalized: number;
}

export interface ProjectDTO {
  id: number;
  name: string;
  description: string;
  type: ProjectType;
  labels: LabelDef[];
  guidelines: string;
  settings: ProjectSettings;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ProjectListEntry extends ProjectDTO {
  counts: ProjectCounts;
  /** From the requesting user's point of view. */
  mine: { submitted: number; available: number; returned: number; restricted: boolean };
}

export interface AssignmentRange {
  userId: number;
  seqFrom: number;
  seqTo: number;
}

export interface AssignmentsView {
  ranges: (AssignmentRange & { user: UserRef })[];
  maxSeq: number;
}

// ── Items and annotations ───────────────────────────────────────────────────

export interface ItemRef {
  id: number;
  seq: number;
  text: string;
  meta: Record<string, unknown>;
}

export interface DraftView {
  label: string | null;
  spans: SpanWithText[] | null;
  model: string | null;
}

export interface ClaimView {
  annotationId: number;
  item: ItemRef;
  /** Null when there is no usable draft, the project hides drafts, or this is a blind-audit pair. */
  draft: DraftView | null;
  /** The annotator's own label when resuming a claim, editing, or fixing returned work. */
  current: {
    label: string | null;
    spans: SpanWithText[];
    flagged: boolean;
    note: string | null;
  } | null;
  returned: { note: string; reviewer: UserRef | null } | null;
  leaseExpiresAt: string;
}

export interface QueueView {
  claim: ClaimView | null;
  /** Items this user could still be served, excluding the current claim. */
  remaining: number;
  submitted: number;
}

export interface SubmitResult {
  annotationId: number;
  finalized: boolean;
  next: QueueView;
}

export interface HistoryEntry {
  annotationId: number;
  itemId: number;
  seq: number;
  text: string;
  status: 'submitted' | 'skipped' | 'rejected';
  label: string | null;
  spans: SpanWithText[] | null;
  submittedAt: string | null;
  updatedAt: string;
  final: { label: string | null; spans: SpanWithText[] | null; source: FinalSource } | null;
}

export interface AnnotationView {
  id: number;
  source: AnnotationSource;
  status: AnnotationStatus;
  user: UserRef | null;
  label: string | null;
  spans: SpanWithText[] | null;
  flagged: boolean;
  note: string | null;
  reviewNote: string | null;
  durationMs: number | null;
  draftShown: boolean | null;
  model: string | null;
  error: string | null;
  rawOutput: string | null;
  latencyMs: number | null;
  createdAt: string;
  submittedAt: string | null;
}

export interface FinalView {
  label: string | null;
  spans: SpanWithText[] | null;
  source: FinalSource;
  by: UserRef | null;
  at: string;
}

export interface Majority {
  label: string | null;
  spans: SpanWithText[] | null;
  votes: number;
  total: number;
  tie: boolean;
}

export interface ReviewEntry {
  item: ItemRef;
  human: AnnotationView[];
  draft: AnnotationView | null;
  imported: AnnotationView | null;
  final: FinalView | null;
  majority: Majority | null;
  disagreement: boolean;
  flagged: boolean;
  draftOverridden: boolean;
}

export interface ReviewQueue {
  entries: ReviewEntry[];
  total: number;
  counts: { all: number; disagreement: number; flagged: number; draftOverridden: number };
}

export interface ItemRow {
  id: number;
  seq: number;
  text: string;
  state: ItemState;
  final: { label: string | null; spanCount: number | null; source: FinalSource } | null;
  humanCount: number;
  humanLabels: string[];
  llm: { label: string | null; spanCount: number | null; status: AnnotationStatus } | null;
  imported: { label: string | null; spanCount: number | null } | null;
  flagged: boolean;
  disagreement: boolean;
}

export interface ItemPage {
  rows: ItemRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ItemDetail {
  item: ItemRef & { createdAt: string };
  final: FinalView | null;
  annotations: AnnotationView[];
}

export interface ImportResult {
  inserted: number;
  duplicates: number;
  skipped: number;
  /** Rows imported without their label because it was not in the label set. */
  labelsDropped: number;
  labeled: number;
  addedLabels: string[];
  firstSeq: number | null;
  lastSeq: number | null;
  /** The first few problems, one line each, with the row number in this batch. */
  warnings: string[];
}

// ── Jobs and events ─────────────────────────────────────────────────────────

export interface JobProgress {
  done: number;
  total: number;
  failed: number;
  message?: string;
}

export interface JobView {
  id: number;
  projectId: number | null;
  kind: JobKind;
  status: JobStatus;
  params: Record<string, unknown>;
  progress: JobProgress;
  result: unknown;
  error: string | null;
  createdBy: UserRef | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export type ServerEvent =
  | { type: 'job'; job: JobView }
  | { type: 'epoch'; jobId: number; projectId: number; epoch: EpochStats }
  | {
      type: 'project';
      projectId: number;
      reason: 'items' | 'annotations' | 'review' | 'settings' | 'drafts';
    };

// ── LLM ─────────────────────────────────────────────────────────────────────

export interface ProviderInfo {
  id: LlmProviderId;
  available: boolean;
  reason: string | null;
  defaultModel: string;
  models: { name: string; detail: string | null }[];
}

export interface PreviewRow {
  itemId: number | null;
  text: string;
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  raw: string | null;
  parsed: { label: string | null; spans: SpanWithText[] | null } | null;
  error: string | null;
  unaligned: EntityGuess[];
  latencyMs: number;
  reference: { label: string | null; spans: SpanWithText[] | null; source: string } | null;
}

export interface PrelabelResult {
  model: string;
  processed: number;
  ok: number;
  errors: number;
  unalignedEntities: number;
  meanLatencyMs: number | null;
}

// ── Metrics ─────────────────────────────────────────────────────────────────

export interface Overview {
  counts: ProjectCounts;
  annotations: {
    human: number;
    skipped: number;
    claimed: number;
    llm: number;
    llmErrors: number;
    imported: number;
  };
  labels: { label: string; final: number; human: number; llm: number; imported: number }[];
  throughput: { day: string; submitted: number }[];
  annotators: {
    user: UserRef;
    submitted: number;
    skipped: number;
    medianMs: number | null;
    agreeWithFinal: number | null;
    agreeWithDraft: number | null;
    lastAt: string | null;
  }[];
}

export interface AgreementReport {
  kind: ProjectType;
  /** Items with at least two submitted human annotations. */
  itemsCompared: number;
  /** Krippendorff's alpha (nominal); classification only. */
  alpha: number | null;
  /** Mean pairwise agreement (classification) or mean pairwise span F1 (NER). */
  observed: number | null;
  pairs: { a: UserRef; b: UserRef; items: number; kappa: number | null; agreement: number }[];
}

export interface LabelScore {
  label: string;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  support: number;
}

export interface Confusion {
  labels: string[];
  /** rows = reference, columns = prediction */
  matrix: number[][];
}

export interface DraftQuality {
  kind: ProjectType;
  reference: 'human' | 'final' | 'import';
  drafts: number;
  errors: number;
  compared: number;
  accuracy: number | null;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  perLabel: LabelScore[];
  confusion: Confusion | null;
  /**
   * Agreement between annotators and the draft, split by whether the draft was shown.
   * A large gap means annotators follow the draft rather than check it.
   */
  anchoring: {
    shown: { n: number; agree: number | null };
    hidden: { n: number; agree: number | null };
  };
}

// ── Student model ───────────────────────────────────────────────────────────

export interface EpochStats {
  epoch: number;
  trainLoss: number;
  valLoss: number | null;
  valAccuracy: number | null;
  valF1: number | null;
  ms: number;
}

export interface TrainReport {
  kind: ProjectType;
  params: TrainJobParams;
  data: {
    train: number;
    test: number;
    labels: string[];
    trainBySource: Record<string, number>;
    testDistribution: Record<string, number>;
  };
  history: EpochStats[];
  bestEpoch: number;
  test: {
    accuracy: number | null;
    macroF1: number | null;
    microF1: number | null;
    precision: number | null;
    recall: number | null;
    perLabel: LabelScore[];
    confusion: Confusion | null;
  };
  baselines: {
    /**
     * The floor a student must clear: always predicting the most frequent training label
     * (classification, accuracy), or tagging every training entity string wherever it
     * occurs (NER, span F1).
     */
    simple: { kind: 'majority' | 'dictionary'; score: number | null };
    /** The LLM drafts scored on the same test items, where they exist. */
    teacher: { score: number | null; n: number };
  };
  durationMs: number;
}

export interface ModelSummary {
  jobId: number;
  status: JobStatus;
  createdAt: string;
  finishedAt: string | null;
  params: TrainJobParams;
  report: TrainReport | null;
  error: string | null;
}

export interface Prediction {
  label: string | null;
  probabilities: { label: string; p: number }[];
  spans: SpanWithText[] | null;
}
