import {
  answerKey,
  canonicalSpans,
  cpLength,
  type LabelDef,
  labelsFromNames,
  projectSettingsSchema,
  reanchorSpan,
  type Span,
  utf16ToCp,
  validateSpans,
} from '@crowd/shared';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { annotations, assignments, items, projects, users } from '../db/schema';
import { finalColumns } from '../lib/answers';
import { textHash } from '../modules/items/service';

// ── v1 shapes (MongoDB documents, ids already stringified) ───────────────────

export interface V1User {
  _id: string;
  username: string;
  passwordHash: string;
  role?: string;
  createdAt?: Date;
}
export interface V1Task {
  _id: string;
  name: string;
  description?: string;
  type?: string;
  labels?: string[];
  createdAt?: Date;
}
export interface V1Sample {
  _id: string;
  taskId: string;
  content: string;
  meta?: Record<string, unknown> | null;
  assignedTo?: string | null;
  createdAt?: Date;
}
export interface V1Span {
  start: number;
  end: number;
  label: string;
  text: string;
}
export interface V1Annotation {
  _id: string;
  taskId: string;
  sampleId: string;
  userId?: string | null;
  label?: string | null;
  spans?: V1Span[];
  fromLLM?: boolean;
  confidence?: number | null;
  status?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  meta?: { source?: string; model?: string } & Record<string, unknown>;
}
export interface V1Data {
  users: V1User[];
  tasks: V1Task[];
  samples: V1Sample[];
  annotations: V1Annotation[];
}

export interface MigrationOptions {
  /**
   * v1 stored everything that was not an LLM draft as a "human" annotation, including gold
   * labels written in bulk by import scripts. A human annotation is migrated as `import`
   * when at least this many human annotations of the same task were created in the same
   * minute — no person labels a hundred items a minute through a web form.
   */
  burstThreshold: number;
  /** Make imported labels the items' final labels, as v1 treated them for training. */
  finalizeImported: boolean;
}

export interface ProjectReport {
  name: string;
  type: string;
  items: number;
  human: number;
  llm: number;
  imported: number;
  finalized: number;
}

export interface MigrationReport {
  users: number;
  projects: number;
  items: number;
  annotations: { human: number; llm: number; import: number };
  humanReclassifiedAsImport: number;
  duplicateDraftsDropped: number;
  conflictingDuplicateDrafts: number;
  duplicateHumanDropped: number;
  spansChecked: number;
  spansRepaired: number;
  spansDropped: number;
  platformConfidenceDropped: number;
  orphanAnnotations: number;
  assignmentRanges: number;
  perProject: ProjectReport[];
}

const time = (d: Date | undefined | null) =>
  d instanceof Date ? d.getTime() : d ? new Date(d).getTime() : 0;
const latest = <T extends { createdAt?: Date; updatedAt?: Date }>(list: T[]) =>
  list.reduce((a, b) =>
    Math.max(time(b.updatedAt), time(b.createdAt)) > Math.max(time(a.updatedAt), time(a.createdAt))
      ? b
      : a,
  );
const minuteKey = (d: Date | undefined) => (d ? new Date(d).toISOString().slice(0, 16) : 'unknown');

/**
 * v1 offsets are UTF-16 indices and some are simply wrong: the v1 NER page computed them
 * from a DOM range that included the label badges drawn inside highlighted spans. Convert,
 * check against the text, re-anchor what can be re-anchored, drop the rest — and count.
 */
export function convertSpans(
  text: string,
  spans: V1Span[] | undefined,
  labels: string[],
  report: Pick<MigrationReport, 'spansChecked' | 'spansRepaired' | 'spansDropped'>,
): Span[] {
  if (!spans?.length) return [];
  const length = cpLength(text);
  const placed: Span[] = [];
  for (const s of spans) {
    report.spansChecked++;
    const start = utf16ToCp(text, s.start);
    const end = utf16ToCp(text, s.end);
    const surface = Array.from(text).slice(start, end).join('');
    let span: Span | null = null;
    if (end > start && end <= length && surface === s.text) span = { start, end, label: s.label };
    else {
      span = reanchorSpan(text, { start, label: s.label, text: s.text });
      if (span) report.spansRepaired++;
    }
    if (
      !span ||
      !labels.includes(span.label) ||
      placed.some((p) => span!.start < p.end && p.start < span!.end)
    ) {
      report.spansDropped++;
      continue;
    }
    placed.push(span);
  }
  const check = validateSpans(text, placed, labels);
  return check.ok ? canonicalSpans(check.spans) : [];
}

/** Collapse sorted sequence numbers into [from, to] runs. */
export function toRanges(seqs: number[]): [number, number][] {
  const sorted = [...new Set(seqs)].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last && s === last[1] + 1) last[1] = s;
    else out.push([s, s]);
  }
  return out;
}

export async function migrateV1(
  db: Db,
  data: V1Data,
  opts: MigrationOptions,
): Promise<MigrationReport> {
  const report: MigrationReport = {
    users: 0,
    projects: 0,
    items: 0,
    annotations: { human: 0, llm: 0, import: 0 },
    humanReclassifiedAsImport: 0,
    duplicateDraftsDropped: 0,
    conflictingDuplicateDrafts: 0,
    duplicateHumanDropped: 0,
    spansChecked: 0,
    spansRepaired: 0,
    spansDropped: 0,
    platformConfidenceDropped: 0,
    orphanAnnotations: 0,
    assignmentRanges: 0,
    perProject: [],
  };

  // Users keep their v1 bcrypt hashes; the first login replaces them with scrypt.
  const userIds = new Map<string, number>();
  for (const u of data.users) {
    const [row] = await db
      .insert(users)
      .values({
        username: u.username,
        passwordHash: u.passwordHash,
        role: u.role === 'admin' ? 'admin' : 'annotator',
        createdAt: u.createdAt ? new Date(u.createdAt) : new Date(),
      })
      .returning({ id: users.id });
    userIds.set(u._id, row!.id);
    report.users++;
  }
  const firstAdmin = data.users.find((u) => u.role === 'admin');

  const samplesByTask = new Map<string, V1Sample[]>();
  for (const s of data.samples)
    samplesByTask.set(s.taskId, [...(samplesByTask.get(s.taskId) ?? []), s]);
  const annsByTask = new Map<string, V1Annotation[]>();
  for (const a of data.annotations)
    annsByTask.set(a.taskId, [...(annsByTask.get(a.taskId) ?? []), a]);

  for (const task of [...data.tasks].sort((a, b) => time(a.createdAt) - time(b.createdAt))) {
    const type = task.type === 'ner' ? 'ner' : 'classification';
    const taskAnns = annsByTask.get(task._id) ?? [];
    const labelNames = [...(task.labels ?? [])];
    // Labels used by annotations but missing from the task (defensive; none were found).
    for (const a of taskAnns) {
      const used = type === 'ner' ? (a.spans ?? []).map((s) => s.label) : a.label ? [a.label] : [];
      for (const l of used) if (!labelNames.includes(l)) labelNames.push(l);
    }
    if (labelNames.length === 0) labelNames.push('label');
    const labels: LabelDef[] = labelsFromNames(labelNames);

    const samples = [...(samplesByTask.get(task._id) ?? [])].sort(
      (a, b) => time(a.createdAt) - time(b.createdAt) || a._id.localeCompare(b._id),
    );
    const bySample = new Map<string, V1Annotation[]>();
    for (const a of taskAnns) bySample.set(a.sampleId, [...(bySample.get(a.sampleId) ?? []), a]);
    const knownSamples = new Set(samples.map((s) => s._id));
    for (const sid of bySample.keys())
      if (!knownSamples.has(sid)) report.orphanAnnotations += bySample.get(sid)!.length;

    // Minutes in which this task received a burst of "human" annotations.
    const perMinute = new Map<string, number>();
    for (const a of taskAnns)
      if (!a.fromLLM)
        perMinute.set(minuteKey(a.createdAt), (perMinute.get(minuteKey(a.createdAt)) ?? 0) + 1);
    const isBurst = (a: V1Annotation) =>
      (perMinute.get(minuteKey(a.createdAt)) ?? 0) >= opts.burstThreshold;

    const summary: ProjectReport = {
      name: task.name,
      type,
      items: 0,
      human: 0,
      llm: 0,
      imported: 0,
      finalized: 0,
    };

    await db.transaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({
          name: task.name,
          description: task.description ?? '',
          type,
          labels,
          settings: projectSettingsSchema.parse({}),
          createdBy: firstAdmin ? (userIds.get(firstAdmin._id) ?? null) : null,
          createdAt: task.createdAt ? new Date(task.createdAt) : new Date(),
        })
        .returning({ id: projects.id });
      const projectId = project!.id;

      type ItemPlan = {
        sample: V1Sample;
        seq: number;
        human: {
          userId: number;
          label: string | null;
          spans: Span[] | null;
          status: 'submitted' | 'rejected';
          at: Date;
          a: V1Annotation;
        }[];
        imported: { label: string | null; spans: Span[] | null; at: Date } | null;
        llm: {
          label: string | null;
          spans: Span[] | null;
          status: 'submitted' | 'error';
          error: string | null;
          model: string;
          confidence: number | null;
          at: Date;
          v1Status: string | null;
        } | null;
      };
      const plans: ItemPlan[] = samples.map((sample, i) => ({
        sample,
        seq: i + 1,
        human: [],
        imported: null,
        llm: null,
      }));

      for (const plan of plans) {
        const list = bySample.get(plan.sample._id) ?? [];
        const text = plan.sample.content;
        const answer = (a: V1Annotation) =>
          type === 'ner'
            ? { label: null, spans: convertSpans(text, a.spans, labelNames, report) }
            : { label: a.label ?? null, spans: null };

        const drafts = list.filter((a) => a.fromLLM);
        if (drafts.length) {
          const keep = latest(drafts);
          report.duplicateDraftsDropped += drafts.length - 1;
          if (
            drafts.length > 1 &&
            new Set(
              drafts.map((d) => (type === 'ner' ? JSON.stringify(d.spans ?? []) : String(d.label))),
            ).size > 1
          ) {
            report.conflictingDuplicateDrafts++;
          }
          const ans = answer(keep);
          const labelOk = type === 'ner' || (ans.label != null && labelNames.includes(ans.label));
          const fromResearch = keep.meta?.source != null;
          if (!fromResearch && keep.confidence != null) report.platformConfidenceDropped++;
          plan.llm = {
            ...ans,
            status: labelOk ? 'submitted' : 'error',
            error: labelOk ? null : 'v1 draft had no usable label',
            model: keep.meta?.model ? `v1:${keep.meta.model}` : 'v1:unrecorded',
            confidence: fromResearch ? (keep.confidence ?? null) : null,
            at: new Date(keep.createdAt ?? Date.now()),
            v1Status: keep.status ?? null,
          };
        }

        const humanOnes = list.filter((a) => !a.fromLLM);
        const imports = humanOnes.filter((a) => isBurst(a) || !a.userId || !userIds.has(a.userId));
        const real = humanOnes.filter((a) => !imports.includes(a));
        report.humanReclassifiedAsImport += imports.length;
        if (imports.length) {
          const keep = latest(imports);
          report.duplicateHumanDropped += imports.length - 1;
          plan.imported = { ...answer(keep), at: new Date(keep.createdAt ?? Date.now()) };
        }
        const byUser = new Map<string, V1Annotation[]>();
        for (const a of real) byUser.set(a.userId!, [...(byUser.get(a.userId!) ?? []), a]);
        for (const [uid, anns] of byUser) {
          const keep = latest(anns);
          report.duplicateHumanDropped += anns.length - 1;
          plan.human.push({
            userId: userIds.get(uid)!,
            ...answer(keep),
            status: keep.status === 'rejected' ? 'rejected' : 'submitted',
            at: new Date(keep.updatedAt ?? keep.createdAt ?? Date.now()),
            a: keep,
          });
        }
      }

      // Items, in chunks, keeping the sample → item id map.
      const itemIds: number[] = [];
      for (let i = 0; i < plans.length; i += 1000) {
        const chunk = plans.slice(i, i + 1000);
        const inserted = await tx
          .insert(items)
          .values(
            chunk.map((p) => {
              const submitted = p.human.filter((x) => x.status === 'submitted');
              let final: {
                label: string | null;
                spans: Span[] | null;
                source: 'import' | 'consensus';
                at: Date;
              } | null = null;
              if (p.imported && opts.finalizeImported) final = { ...p.imported, source: 'import' };
              else if (
                submitted.length &&
                new Set(submitted.map((x) => answerKey(type, x))).size === 1
              ) {
                final = {
                  label: submitted[0]!.label,
                  spans: submitted[0]!.spans,
                  source: 'consensus',
                  at: submitted[0]!.at,
                };
              }
              if (final) summary.finalized++;
              return {
                projectId,
                seq: p.seq,
                text: p.sample.content,
                textHash: textHash(p.sample.content),
                meta: { ...(p.sample.meta ?? {}), v1Id: p.sample._id },
                humanCount: submitted.length,
                ...(final ? finalColumns(type, final, final.source, null, final.at) : {}),
                createdAt: p.sample.createdAt ? new Date(p.sample.createdAt) : new Date(),
              };
            }),
          )
          .returning({ id: items.id });
        itemIds.push(...inserted.map((r) => r.id));
      }

      const annRows: (typeof annotations.$inferInsert)[] = [];
      plans.forEach((p, i) => {
        const itemId = itemIds[i]!;
        if (p.llm) {
          annRows.push({
            projectId,
            itemId,
            source: 'llm',
            status: p.llm.status,
            label: p.llm.label,
            spans: type === 'ner' ? p.llm.spans : null,
            model: p.llm.model,
            error: p.llm.error,
            confidence: p.llm.confidence,
            meta: p.llm.v1Status ? { v1Status: p.llm.v1Status } : {},
            createdAt: p.llm.at,
            updatedAt: p.llm.at,
            submittedAt: p.llm.status === 'submitted' ? p.llm.at : null,
          });
          summary.llm++;
        }
        if (p.imported) {
          annRows.push({
            projectId,
            itemId,
            source: 'import',
            status: 'submitted',
            label: p.imported.label,
            spans: type === 'ner' ? p.imported.spans : null,
            meta: { migratedFrom: 'v1 human annotation written in bulk' },
            createdAt: p.imported.at,
            updatedAt: p.imported.at,
            submittedAt: p.imported.at,
          });
          summary.imported++;
        }
        for (const x of p.human) {
          annRows.push({
            projectId,
            itemId,
            source: 'human',
            userId: x.userId,
            status: x.status,
            label: x.label,
            spans: type === 'ner' ? x.spans : null,
            reviewNote: x.status === 'rejected' ? 'Rejected in v1.' : null,
            reviewedBy: x.a.reviewedBy ? (userIds.get(x.a.reviewedBy) ?? null) : null,
            reviewedAt: x.a.reviewedAt ? new Date(x.a.reviewedAt) : null,
            createdAt: new Date(x.a.createdAt ?? Date.now()),
            updatedAt: x.at,
            submittedAt: x.at,
          });
          summary.human++;
        }
      });
      for (let i = 0; i < annRows.length; i += 1000)
        await tx.insert(annotations).values(annRows.slice(i, i + 1000));

      // Per-sample v1 assignments become per-user ranges.
      const seqsByUser = new Map<number, number[]>();
      for (const p of plans) {
        const uid = p.sample.assignedTo ? userIds.get(p.sample.assignedTo) : undefined;
        if (uid) seqsByUser.set(uid, [...(seqsByUser.get(uid) ?? []), p.seq]);
      }
      for (const [userId, seqs] of seqsByUser) {
        for (const [seqFrom, seqTo] of toRanges(seqs)) {
          await tx.insert(assignments).values({ projectId, userId, seqFrom, seqTo });
          report.assignmentRanges++;
        }
      }
      summary.items = plans.length;
    });

    report.projects++;
    report.items += summary.items;
    report.annotations.human += summary.human;
    report.annotations.llm += summary.llm;
    report.annotations.import += summary.imported;
    report.perProject.push(summary);
  }

  // Identity sequences are fine; this just refreshes planner statistics after a bulk load.
  await db.execute(sql`analyze`);
  return report;
}
