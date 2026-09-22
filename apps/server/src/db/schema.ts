import type {
  AnnotationSource,
  AnnotationStatus,
  FinalSource,
  JobKind,
  JobProgress,
  JobStatus,
  LabelDef,
  ProjectSettings,
  ProjectType,
  Role,
  Span,
} from '@crowd/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const tz = { withTimezone: true } as const;
const createdAt = () => timestamp(tz).notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    username: text().notNull(),
    displayName: text(),
    /** `scrypt$…` for accounts created or logged into since v2; `$2a$…` bcrypt from v1 until first login. */
    passwordHash: text().notNull(),
    role: text().$type<Role>().notNull(),
    disabledAt: timestamp(tz),
    createdAt: createdAt(),
    lastSeenAt: timestamp(tz),
  },
  (t) => [uniqueIndex('users_username_lower_idx').on(sql`lower(${t.username})`)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** sha256 of the cookie token; the token itself is never stored. */
    id: text().primaryKey(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: timestamp(tz).notNull(),
    lastUsedAt: timestamp(tz).notNull().defaultNow(),
    userAgent: text(),
    ip: text(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const projects = pgTable('projects', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  description: text().notNull().default(''),
  type: text().$type<ProjectType>().notNull(),
  labels: jsonb().$type<LabelDef[]>().notNull(),
  guidelines: text().notNull().default(''),
  settings: jsonb().$type<ProjectSettings>().notNull(),
  createdBy: integer().references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: timestamp(tz).notNull().defaultNow(),
  archivedAt: timestamp(tz),
});

/**
 * Restricts which items a user may be served, by item sequence number. A user with ranges
 * in a project is served only items inside them; a user without is served only items
 * outside everyone's ranges. Ranges may overlap, which is how redundancy and assignment
 * combine.
 */
export const assignments = pgTable(
  'assignments',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    projectId: integer()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    seqFrom: integer().notNull(),
    seqTo: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('assignments_project_user_idx').on(t.projectId, t.userId)],
);

export const items = pgTable(
  'items',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    projectId: integer()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** 1-based position within the project, fixed at import. Assignment ranges refer to it. */
    seq: integer().notNull(),
    text: text().notNull(),
    textHash: text().notNull(),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** Submitted human annotations. Maintained in the same transaction as the annotation. */
    humanCount: integer().notNull().default(0),
    finalLabel: text(),
    finalSpans: jsonb().$type<Span[]>(),
    finalSource: text().$type<FinalSource>(),
    finalizedBy: integer().references(() => users.id, { onDelete: 'set null' }),
    finalizedAt: timestamp(tz),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('items_project_seq_idx').on(t.projectId, t.seq),
    index('items_project_hash_idx').on(t.projectId, t.textHash),
    index('items_open_idx').on(t.projectId, t.seq).where(sql`${t.finalizedAt} is null`),
  ],
);

export const annotations = pgTable(
  'annotations',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    projectId: integer()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    itemId: integer()
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    source: text().$type<AnnotationSource>().notNull(),
    userId: integer().references(() => users.id, { onDelete: 'set null' }),
    status: text().$type<AnnotationStatus>().notNull(),
    label: text(),
    spans: jsonb().$type<Span[]>(),
    flagged: boolean().notNull().default(false),
    note: text(),
    reviewNote: text(),
    reviewedBy: integer().references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp(tz),
    /** Human only: whether the LLM draft was on screen. False for blind-audit pairs. */
    draftShown: boolean(),
    durationMs: integer(),
    leaseExpiresAt: timestamp(tz),
    /** LLM only. */
    model: text(),
    rawOutput: text(),
    error: text(),
    confidence: real(),
    latencyMs: integer(),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: timestamp(tz).notNull().defaultNow(),
    submittedAt: timestamp(tz),
  },
  (t) => [
    uniqueIndex('annotations_human_unique_idx')
      .on(t.itemId, t.userId)
      .where(sql`${t.source} = 'human'`),
    uniqueIndex('annotations_llm_unique_idx').on(t.itemId).where(sql`${t.source} = 'llm'`),
    uniqueIndex('annotations_import_unique_idx').on(t.itemId).where(sql`${t.source} = 'import'`),
    index('annotations_item_idx').on(t.itemId),
    index('annotations_project_source_status_idx').on(t.projectId, t.source, t.status),
    index('annotations_user_status_idx').on(t.userId, t.status),
    index('annotations_project_submitted_idx').on(t.projectId, t.submittedAt),
  ],
);

export const jobs = pgTable(
  'jobs',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    projectId: integer().references(() => projects.id, { onDelete: 'cascade' }),
    kind: text().$type<JobKind>().notNull(),
    status: text().$type<JobStatus>().notNull(),
    params: jsonb().$type<Record<string, unknown>>().notNull(),
    progress: jsonb().$type<JobProgress>().notNull().default({ done: 0, total: 0, failed: 0 }),
    result: jsonb().$type<unknown>(),
    error: text(),
    createdBy: integer().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    startedAt: timestamp(tz),
    finishedAt: timestamp(tz),
  },
  (t) => [
    index('jobs_project_idx').on(t.projectId, t.createdAt),
    index('jobs_status_idx').on(t.status),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type ItemRow = typeof items.$inferSelect;
export type AnnotationRow = typeof annotations.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
