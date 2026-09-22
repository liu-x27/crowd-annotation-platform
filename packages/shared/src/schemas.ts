import { z } from 'zod';
import {
  EXPORT_FORMATS,
  EXPORT_LABEL_SETS,
  LLM_PROVIDERS,
  PROJECT_TYPES,
  ROLES,
  TRAIN_SOURCES,
} from './constants';
import { RESERVED_HOTKEYS } from './labels';

// ── Accounts ────────────────────────────────────────────────────────────────

export const usernameSchema = z
  .string()
  .trim()
  .min(2, 'at least 2 characters')
  .max(32, 'at most 32 characters')
  .regex(/^[\p{L}\p{N}_.-]+$/u, 'letters, digits, _ . and - only');

export const passwordSchema = z
  .string()
  .min(8, 'at least 8 characters')
  .max(200, 'at most 200 characters');

const displayNameSchema = z.string().trim().max(64);

/** Login deliberately does not re-apply the password policy: old accounts may predate it. */
export const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  displayName: displayNameSchema.optional(),
});

export const createUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  role: z.enum(ROLES),
  displayName: displayNameSchema.optional(),
});

export const updateUserSchema = z
  .object({
    role: z.enum(ROLES),
    displayName: displayNameSchema.nullable(),
    disabled: z.boolean(),
    password: passwordSchema,
  })
  .partial();

export const updateMeSchema = z.object({ displayName: displayNameSchema.nullable() });

export const changePasswordSchema = z.object({
  current: z.string().min(1).max(200),
  next: passwordSchema,
});

// ── Projects ────────────────────────────────────────────────────────────────

export const labelDefSchema = z.object({
  name: z.string().trim().min(1).max(64),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a #rrggbb colour'),
  hotkey: z
    .string()
    .regex(/^[0-9a-z]$/, 'a single digit or lowercase letter')
    .nullable()
    .default(null),
  description: z.string().max(1000).default(''),
});

export const labelsSchema = z
  .array(labelDefSchema)
  .min(1, 'at least one label')
  .max(64, 'at most 64 labels')
  .superRefine((labels, ctx) => {
    const names = new Set<string>();
    const keys = new Set<string>();
    labels.forEach((label, i) => {
      if (names.has(label.name)) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'name'],
          message: `duplicate label "${label.name}"`,
        });
      }
      names.add(label.name);
      if (label.hotkey) {
        if ((RESERVED_HOTKEYS as readonly string[]).includes(label.hotkey)) {
          ctx.addIssue({
            code: 'custom',
            path: [i, 'hotkey'],
            message: `"${label.hotkey}" is reserved for workspace actions`,
          });
        }
        if (keys.has(label.hotkey)) {
          ctx.addIssue({
            code: 'custom',
            path: [i, 'hotkey'],
            message: `hotkey "${label.hotkey}" is used twice`,
          });
        }
        keys.add(label.hotkey);
      }
    });
  });

export const llmSettingsSchema = z.object({
  provider: z.enum(LLM_PROVIDERS).default('ollama'),
  /** Empty means the provider's configured default. */
  model: z.string().max(200).default(''),
  temperature: z.number().min(0).max(2).default(0),
  /** Finalised items shown to the model as worked examples. */
  fewShot: z.number().int().min(0).max(16).default(4),
  /** Appended to the system prompt, after the label definitions and guidelines. */
  instructions: z.string().max(4000).default(''),
});

export const projectSettingsSchema = z.object({
  /** Distinct annotators each item needs before it counts as complete. */
  redundancy: z.number().int().min(1).max(10).default(1),
  /** `unanimous`: finalise automatically when all annotators agree. `never`: always review. */
  autoFinalize: z.enum(['unanimous', 'never']).default('unanimous'),
  /** How the LLM draft is shown to annotators. */
  draftMode: z.enum(['suggest', 'preselect', 'hidden']).default('suggest'),
  /**
   * Fraction of (item, annotator) pairs served with the draft hidden, so agreement with the
   * draft can be compared against an unanchored baseline.
   */
  blindRate: z.number().min(0).max(0.9).default(0),
  /** How long a claimed item is held for one annotator before others can take it. */
  leaseMinutes: z.number().int().min(1).max(1440).default(30),
  llm: llmSettingsSchema.prefault({}),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(''),
  type: z.enum(PROJECT_TYPES),
  labels: labelsSchema,
  guidelines: z.string().max(50_000).default(''),
  settings: projectSettingsSchema.prefault({}),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  guidelines: z.string().max(50_000).optional(),
  labels: labelsSchema.optional(),
  /** old name → new name; applied to every annotation and final label in the project. */
  labelRenames: z.record(z.string(), z.string().trim().min(1).max(64)).optional(),
  settings: projectSettingsSchema.optional(),
  archived: z.boolean().optional(),
});

export const assignmentsSchema = z.object({
  ranges: z
    .array(
      z
        .object({
          userId: z.number().int().positive(),
          seqFrom: z.number().int().min(1),
          seqTo: z.number().int().min(1),
        })
        .refine((r) => r.seqTo >= r.seqFrom, 'seqTo must be ≥ seqFrom'),
    )
    .max(2000),
});

// ── Items and annotations ───────────────────────────────────────────────────

export const spanInputSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  label: z.string().min(1).max(64),
});

export const spansInputSchema = z.array(spanInputSchema).max(1000);

export const submitAnnotationSchema = z.object({
  label: z.string().min(1).max(64).optional(),
  spans: spansInputSchema.optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  flagged: z.boolean().optional(),
  note: z.string().max(2000).optional(),
});

export const skipSchema = z.object({ reason: z.string().max(500).optional() });

export const importItemSchema = z.object({
  text: z.string().min(1).max(20_000),
  externalId: z.string().max(200).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  label: z.string().trim().max(64).optional(),
  spans: spansInputSchema.optional(),
});

export const importBatchSchema = z.object({
  items: z.array(importItemSchema).min(1).max(5000),
  /** Skip rows whose normalised text already exists in the project. */
  dedupe: z.boolean().default(true),
  /** What to do with a label that is not in the project's label set. */
  unknownLabels: z.enum(['error', 'add', 'skip']).default('error'),
  /** Mark imported labels as the items' final labels (for corpora that arrive with gold). */
  finalizeImported: z.boolean().default(false),
});

export const itemListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  state: z.enum(['all', 'unlabeled', 'in_progress', 'needs_review', 'finalized']).default('all'),
  label: z.string().max(64).optional(),
  flagged: z.coerce.boolean().optional(),
  disagreement: z.coerce.boolean().optional(),
  llm: z.enum(['any', 'missing', 'ok', 'error', 'disagrees']).default('any'),
  annotator: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(['seq', '-seq', 'updated']).default('seq'),
});

export const finalizeSchema = z.object({
  label: z.string().min(1).max(64).optional(),
  spans: spansInputSchema.optional(),
});

export const rejectSchema = z.object({ note: z.string().trim().min(1).max(2000) });

export const bulkFinalizeSchema = z.object({
  strategy: z.enum(['unanimous', 'majority']),
  itemIds: z.array(z.number().int().positive()).max(20_000).optional(),
});

export const reviewQueueQuerySchema = z.object({
  filter: z.enum(['all', 'disagreement', 'flagged', 'draft_overridden']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── LLM ─────────────────────────────────────────────────────────────────────

export const llmOverridesSchema = z.object({
  provider: z.enum(LLM_PROVIDERS).optional(),
  model: z.string().max(200).optional(),
  temperature: z.number().min(0).max(2).optional(),
  fewShot: z.number().int().min(0).max(16).optional(),
  instructions: z.string().max(4000).optional(),
});

export const prelabelJobSchema = llmOverridesSchema.extend({
  /** missing: items without a draft · errors: retry failed drafts · unfinalized · all: overwrite. */
  scope: z.enum(['missing', 'errors', 'unfinalized', 'all']).default('missing'),
  limit: z.number().int().min(1).max(200_000).optional(),
});

export const llmPreviewSchema = llmOverridesSchema.extend({
  itemIds: z.array(z.number().int().positive()).max(10).optional(),
  sample: z.number().int().min(1).max(10).optional(),
  text: z.string().min(1).max(20_000).optional(),
});

// ── Student model ───────────────────────────────────────────────────────────

export const trainJobSchema = z.object({
  /** Which labels train the student. */
  source: z.enum(TRAIN_SOURCES).default('final'),
  /** Which labels score it. Never LLM drafts: a student is not graded against its teacher. */
  reference: z.enum(['final', 'import']).default('final'),
  testFraction: z.number().min(0.05).max(0.5).default(0.2),
  epochs: z.number().int().min(1).max(60).default(12),
  /** Feature hashing width, 2^bits buckets. */
  hashBits: z.number().int().min(12).max(20).default(17),
  seed: z
    .number()
    .int()
    .min(0)
    .max(2 ** 31 - 1)
    .default(42),
});

export const predictSchema = z.object({ text: z.string().min(1).max(20_000) });

// ── Export ──────────────────────────────────────────────────────────────────

export const exportQuerySchema = z.object({
  format: z.enum(EXPORT_FORMATS).default('jsonl'),
  labels: z.enum(EXPORT_LABEL_SETS).default('final'),
  onlyFinalized: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  includeMeta: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

// ── Inferred input types ────────────────────────────────────────────────────

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type LabelDefInput = z.input<typeof labelDefSchema>;
export type LlmSettings = z.infer<typeof llmSettingsSchema>;
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export type CreateProjectInput = z.input<typeof createProjectSchema>;
export type UpdateProjectInput = z.input<typeof updateProjectSchema>;
export type AssignmentsInput = z.infer<typeof assignmentsSchema>;
export type SubmitAnnotationInput = z.infer<typeof submitAnnotationSchema>;
export type ImportItemInput = z.infer<typeof importItemSchema>;
export type ImportBatchInput = z.input<typeof importBatchSchema>;
export type ItemListQuery = z.input<typeof itemListQuerySchema>;
export type FinalizeInput = z.infer<typeof finalizeSchema>;
export type BulkFinalizeInput = z.infer<typeof bulkFinalizeSchema>;
export type ReviewQueueQuery = z.input<typeof reviewQueueQuerySchema>;
export type LlmOverrides = z.infer<typeof llmOverridesSchema>;
export type PrelabelJobInput = z.input<typeof prelabelJobSchema>;
export type LlmPreviewInput = z.input<typeof llmPreviewSchema>;
export type TrainJobInput = z.input<typeof trainJobSchema>;
export type TrainJobParams = z.infer<typeof trainJobSchema>;
