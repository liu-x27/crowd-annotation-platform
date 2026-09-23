import {
  canonicalSpans,
  type LlmPreviewInput,
  llmPreviewSchema,
  type PrelabelResult,
  type PreviewRow,
  prelabelJobSchema,
  type Span,
  withText,
} from '@crowd/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import { type Db, rows } from '../../db/client';
import { annotations, items, type ProjectRow } from '../../db/schema';
import type { EventBus } from '../../events/bus';
import type { JobHandler } from '../../jobs/runner';
import { AppError } from '../../lib/errors';
import { getProject } from '../projects/service';
import { parseClassification, parseNer } from './parse';
import { type BuiltPrompt, buildPrompt, type Example } from './prompt';
import type { LlmRegistry } from './registry';
import { type LlmProvider, ProviderError } from './types';

/**
 * Worked examples for the prompt: finalised items, short, spread across labels, chosen by
 * a stable hash so the same project gets the same examples (and a cacheable prompt).
 */
export async function pickExamples(db: Db, project: ProjectRow, k: number): Promise<Example[]> {
  if (k <= 0) return [];
  const candidates = await rows<{
    id: number;
    text: string;
    final_label: string | null;
    final_spans: Span[] | null;
  }>(
    db,
    sql`
      select id, text, final_label, final_spans from items
      where project_id = ${project.id} and finalized_at is not null and char_length(text) <= 400
      order by md5(id::text || ':' || ${project.id}::text)
      limit 3000`,
  );
  const picked: Example[] = [];
  const take = (c: (typeof candidates)[number]) =>
    picked.push({ itemId: c.id, text: c.text, label: c.final_label, spans: c.final_spans });

  if (project.type === 'classification') {
    const byLabel = new Map<string, typeof candidates>();
    for (const c of candidates) {
      if (!c.final_label) continue;
      byLabel.set(c.final_label, [...(byLabel.get(c.final_label) ?? []), c]);
    }
    const order = project.labels.map((l) => l.name).filter((l) => byLabel.has(l));
    for (
      let round = 0;
      picked.length < k && order.some((l) => (byLabel.get(l)?.length ?? 0) > round);
      round++
    ) {
      for (const label of order) {
        const c = byLabel.get(label)?.[round];
        if (c && picked.length < k) take(c);
      }
    }
    return picked;
  }

  const covered = new Set<string>();
  for (const c of candidates) {
    if (picked.length >= k) break;
    const labels = new Set((c.final_spans ?? []).map((s) => s.label));
    if ([...labels].some((l) => !covered.has(l))) {
      take(c);
      for (const l of labels) covered.add(l);
    }
  }
  for (const c of candidates) {
    if (picked.length >= k) break;
    if (!picked.some((p) => p.itemId === c.id) && (c.final_spans?.length ?? 0) > 0) take(c);
  }
  return picked;
}

type Outcome =
  | {
      kind: 'done';
      status: 'submitted' | 'error';
      label: string | null;
      spans: Span[] | null;
      raw: string | null;
      model: string;
      latencyMs: number | null;
      error: string | null;
      unaligned: number;
      meta: Record<string, unknown>;
      parsedSpans: ReturnType<typeof withText> | null;
    }
  | { kind: 'fatal'; error: ProviderError }
  | { kind: 'aborted' };

async function draftOne(
  provider: LlmProvider,
  prompt: BuiltPrompt,
  settings: { model: string; temperature: number; provider: string },
  item: { id: number | null; text: string },
  labels: string[],
  signal: AbortSignal,
): Promise<Outcome> {
  try {
    const out = await provider.complete({
      model: settings.model,
      system: prompt.system,
      messages: prompt.messagesFor(item.id, item.text),
      schema: prompt.schema,
      task: prompt.task,
      temperature: settings.temperature,
      maxTokens: prompt.task === 'ner' ? 1024 : 256,
      signal,
    });
    const base = {
      kind: 'done' as const,
      raw: out.text,
      model: out.model,
      latencyMs: out.latencyMs,
    };
    if (prompt.task === 'classification') {
      const p = parseClassification(out.text, labels);
      return p.ok
        ? {
            ...base,
            status: 'submitted',
            label: p.label,
            spans: null,
            error: null,
            unaligned: 0,
            meta: {},
            parsedSpans: null,
          }
        : {
            ...base,
            status: 'error',
            label: null,
            spans: null,
            error: p.error,
            unaligned: 0,
            meta: {},
            parsedSpans: null,
          };
    }
    const p = parseNer(out.text, item.text, labels);
    if (!p.ok) {
      return {
        ...base,
        status: 'error',
        label: null,
        spans: null,
        error: p.error,
        unaligned: 0,
        meta: {},
        parsedSpans: null,
      };
    }
    return {
      ...base,
      status: 'submitted',
      label: null,
      spans: canonicalSpans(p.spans),
      error: null,
      unaligned: p.unaligned.length + p.conflicts.length,
      meta:
        p.unaligned.length || p.conflicts.length
          ? { unaligned: p.unaligned, conflicts: p.conflicts }
          : {},
      parsedSpans: p.spans,
    };
  } catch (err) {
    if (signal.aborted) return { kind: 'aborted' };
    if (err instanceof ProviderError && err.fatal) return { kind: 'fatal', error: err };
    return {
      kind: 'done',
      status: 'error',
      label: null,
      spans: null,
      raw: null,
      model: `${settings.provider}:${settings.model}`,
      latencyMs: null,
      error: err instanceof Error ? err.message : String(err),
      unaligned: 0,
      meta: {},
      parsedSpans: null,
    };
  }
}

async function saveDraft(
  db: Db,
  project: ProjectRow,
  itemId: number,
  o: Extract<Outcome, { kind: 'done' }>,
) {
  const values = {
    status: o.status,
    label: o.label,
    spans: o.spans,
    model: o.model,
    rawOutput: o.raw,
    error: o.error,
    latencyMs: o.latencyMs,
    confidence: null,
    meta: o.meta,
    updatedAt: new Date(),
    submittedAt: o.status === 'submitted' ? new Date() : null,
  };
  await db
    .insert(annotations)
    .values({ projectId: project.id, itemId, source: 'llm', ...values })
    .onConflictDoUpdate({
      target: annotations.itemId,
      targetWhere: sql`source = 'llm'`,
      set: values,
    });
}

async function targetIds(
  db: Db,
  project: ProjectRow,
  scope: string,
  limit?: number,
): Promise<number[]> {
  const cond =
    scope === 'missing'
      ? sql`not exists (select 1 from annotations d where d.item_id = i.id and d.source = 'llm')`
      : scope === 'errors'
        ? sql`exists (select 1 from annotations d where d.item_id = i.id and d.source = 'llm' and d.status = 'error')`
        : scope === 'unfinalized'
          ? sql`i.finalized_at is null`
          : sql`true`;
  const found = await rows<{ id: number }>(
    db,
    sql`select i.id from items i where i.project_id = ${project.id} and ${cond} order by i.seq
        ${limit ? sql`limit ${limit}` : sql``}`,
  );
  return found.map((r) => r.id);
}

export function createPrelabelHandler(deps: {
  db: Db;
  llm: LlmRegistry;
  bus: EventBus;
}): JobHandler {
  return async (ctx) => {
    const { db, llm, bus } = deps;
    const params = prelabelJobSchema.parse(ctx.job.params);
    const project = await getProject(db, ctx.job.projectId!);
    const settings = llm.resolve(project.settings.llm, params);
    const provider = llm.get(settings.provider);
    const labels = project.labels.map((l) => l.name);

    const ids = await targetIds(db, project, params.scope, params.limit);
    const examples = await pickExamples(db, project, settings.fewShot);
    const prompt = buildPrompt(project, examples, settings.instructions);
    ctx.progress({
      total: ids.length,
      done: 0,
      failed: 0,
      message: `${settings.provider}:${settings.model}`,
    });

    let done = 0;
    let failed = 0;
    let unaligned = 0;
    let latencySum = 0;
    let latencyN = 0;
    let fatal: ProviderError | null = null;
    const queue = [...ids];

    const worker = async () => {
      while (queue.length > 0 && !fatal && !ctx.signal.aborted) {
        const id = queue.shift()!;
        const [item] = await db
          .select({ id: items.id, text: items.text })
          .from(items)
          .where(eq(items.id, id));
        if (!item) continue;
        const outcome = await draftOne(provider, prompt, settings, item, labels, ctx.signal);
        if (outcome.kind === 'fatal') {
          fatal = outcome.error;
          return;
        }
        if (outcome.kind === 'aborted') return;
        await saveDraft(db, project, item.id, outcome);
        done++;
        if (outcome.status === 'error') failed++;
        unaligned += outcome.unaligned;
        if (outcome.latencyMs != null) {
          latencySum += outcome.latencyMs;
          latencyN++;
        }
        ctx.progress({ done, failed });
        bus.projectChanged(project.id, 'drafts');
      }
    };
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(llm.concurrency, ids.length)) }, worker),
    );

    if (fatal) throw fatal;
    ctx.signal.throwIfAborted();
    const result: PrelabelResult = {
      model: `${settings.provider}:${settings.model}`,
      processed: done,
      ok: done - failed,
      errors: failed,
      unalignedEntities: unaligned,
      meanLatencyMs: latencyN ? Math.round(latencySum / latencyN) : null,
    };
    return result;
  };
}

/** Run the prompt on a few items without saving anything, and show the whole exchange. */
export async function previewDrafts(
  db: Db,
  llm: LlmRegistry,
  projectId: number,
  rawInput: LlmPreviewInput,
): Promise<PreviewRow[]> {
  const input = llmPreviewSchema.parse(rawInput);
  const project = await getProject(db, projectId);
  const settings = llm.resolve(project.settings.llm, input);
  const provider = llm.get(settings.provider);
  const labels = project.labels.map((l) => l.name);
  const examples = await pickExamples(db, project, settings.fewShot);
  const prompt = buildPrompt(project, examples, settings.instructions);

  let targets: {
    id: number | null;
    text: string;
    final_label: string | null;
    final_spans: Span[] | null;
    source: string | null;
  }[];
  if (input.text) {
    targets = [{ id: null, text: input.text, final_label: null, final_spans: null, source: null }];
  } else if (input.itemIds?.length) {
    targets = (await db.select().from(items).where(inArray(items.id, input.itemIds)))
      .filter((i) => i.projectId === project.id)
      .map((i) => ({
        id: i.id,
        text: i.text,
        final_label: i.finalLabel,
        final_spans: i.finalSpans,
        source: i.finalSource,
      }));
  } else {
    targets = await rows(
      db,
      sql`select id, text, final_label, final_spans, final_source as source from items
          where project_id = ${project.id}
          order by (finalized_at is null), random()
          limit ${input.sample ?? 3}`,
    );
  }

  const controller = new AbortController();
  const out: PreviewRow[] = [];
  for (const t of targets) {
    const o = await draftOne(
      provider,
      prompt,
      settings,
      { id: t.id, text: t.text },
      labels,
      controller.signal,
    );
    if (o.kind === 'fatal') throw new AppError(502, 'provider_unavailable', o.error.message);
    if (o.kind === 'aborted') break;
    out.push({
      itemId: t.id,
      text: t.text,
      model: o.model,
      messages: [{ role: 'system', content: prompt.system }, ...prompt.messagesFor(t.id, t.text)],
      raw: o.raw,
      parsed: o.status === 'submitted' ? { label: o.label, spans: o.parsedSpans } : null,
      error: o.error,
      unaligned: (o.meta.unaligned as PreviewRow['unaligned']) ?? [],
      latencyMs: o.latencyMs ?? 0,
      reference:
        t.final_label != null || t.final_spans != null
          ? {
              label: t.final_label,
              spans: t.final_spans ? withText(t.text, t.final_spans) : null,
              source: t.source ?? 'final',
            }
          : null,
    });
  }
  return out;
}
