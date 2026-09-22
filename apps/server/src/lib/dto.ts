import type { AnnotationView, FinalView, JobView, ProjectDTO, Span, UserRef } from '@crowd/shared';
import { withText } from '@crowd/shared';
import type { AnnotationRow, ItemRow, JobRow, ProjectRow, UserRow } from '../db/schema';

export const iso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString();

export function userRef(
  u: Pick<UserRow, 'id' | 'username' | 'displayName'> | null | undefined,
): UserRef | null {
  return u ? { id: u.id, username: u.username, displayName: u.displayName ?? null } : null;
}

export function projectDto(p: ProjectRow): ProjectDTO {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    type: p.type,
    labels: p.labels,
    guidelines: p.guidelines,
    settings: p.settings,
    createdAt: iso(p.createdAt)!,
    updatedAt: iso(p.updatedAt)!,
    archivedAt: iso(p.archivedAt),
  };
}

export function spansView(text: string, spans: Span[] | null | undefined) {
  return spans ? withText(text, spans) : null;
}

export function annotationView(
  a: AnnotationRow,
  text: string,
  users: Map<number, UserRow | UserRef>,
  opts: { includeRaw?: boolean } = {},
): AnnotationView {
  const u = a.userId != null ? users.get(a.userId) : undefined;
  return {
    id: a.id,
    source: a.source,
    status: a.status,
    user: u ? { id: u.id, username: u.username, displayName: u.displayName ?? null } : null,
    label: a.label,
    spans: spansView(text, a.spans),
    flagged: a.flagged,
    note: a.note,
    reviewNote: a.reviewNote,
    durationMs: a.durationMs,
    draftShown: a.draftShown,
    model: a.model,
    error: a.error,
    rawOutput: opts.includeRaw ? a.rawOutput : null,
    latencyMs: a.latencyMs,
    createdAt: iso(a.createdAt)!,
    submittedAt: iso(a.submittedAt),
  };
}

export function finalView(i: ItemRow, users: Map<number, UserRow | UserRef>): FinalView | null {
  if (!i.finalizedAt || !i.finalSource) return null;
  const by = i.finalizedBy != null ? users.get(i.finalizedBy) : undefined;
  return {
    label: i.finalLabel,
    spans: spansView(i.text, i.finalSpans),
    source: i.finalSource,
    by: by ? { id: by.id, username: by.username, displayName: by.displayName ?? null } : null,
    at: iso(i.finalizedAt)!,
  };
}

export function jobView(j: JobRow, createdBy: UserRef | null): JobView {
  return {
    id: j.id,
    projectId: j.projectId,
    kind: j.kind,
    status: j.status,
    params: j.params,
    progress: j.progress,
    result: j.result ?? null,
    error: j.error,
    createdBy,
    createdAt: iso(j.createdAt)!,
    startedAt: iso(j.startedAt),
    finishedAt: iso(j.finishedAt),
  };
}
