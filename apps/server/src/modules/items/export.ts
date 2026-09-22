import { type ExportFormat, type ExportLabelSet, withText } from '@crowd/shared';
import { and, asc, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  type AnnotationRow,
  annotations,
  type ItemRow,
  items,
  type ProjectRow,
  users,
} from '../../db/schema';
import { badRequest } from '../../lib/errors';

export interface ExportOptions {
  format: ExportFormat;
  labels: ExportLabelSet;
  onlyFinalized: boolean;
  includeMeta: boolean;
}

const PAGE = 1000;

function csvCell(value: unknown): string {
  if (value == null) return '';
  const s =
    typeof value === 'string'
      ? value
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csvLine = (cells: unknown[]) => `${cells.map(csvCell).join(',')}\r\n`;

/** Character-level BIO. Whitespace characters are omitted, as is usual for CJK NER corpora. */
function conllBlock(text: string, spans: { start: number; end: number; label: string }[]): string {
  const chars = Array.from(text);
  const tags = chars.map(() => 'O');
  for (const s of spans) {
    for (let i = s.start; i < s.end && i < chars.length; i++)
      tags[i] = i === s.start ? `B-${s.label}` : `I-${s.label}`;
  }
  let out = '';
  chars.forEach((ch, i) => {
    if (!/\s/.test(ch)) out += `${ch}\t${tags[i]}\n`;
  });
  return `${out}\n`;
}

export function exportFilename(
  project: ProjectRow,
  opts: ExportOptions,
): { ascii: string; utf8: string } {
  const ext = opts.format === 'conll' ? 'conll' : opts.format;
  const base =
    project.name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80) || `project-${project.id}`;
  return {
    ascii: `project-${project.id}-${opts.labels}.${ext}`,
    utf8: `${base}-${opts.labels}.${ext}`,
  };
}

/**
 * Stream a project's labels. Items are read in pages by sequence number, so memory stays
 * flat however large the project is.
 */
export function exportStream(
  db: Db,
  project: ProjectRow,
  opts: ExportOptions,
): ReadableStream<Uint8Array> {
  if (opts.format === 'conll' && (project.type !== 'ner' || opts.labels !== 'final')) {
    throw badRequest('CoNLL export is for NER projects, final labels only.');
  }
  if (opts.labels === 'all' && opts.format !== 'jsonl') {
    throw badRequest('"all" nests every source per item, so it is JSONL only.');
  }
  const ner = project.type === 'ner';
  const answer = (text: string, a: { label: string | null; spans: AnnotationRow['spans'] }) =>
    ner ? { entities: withText(text, a.spans ?? []) } : { label: a.label };
  const encoder = new TextEncoder();
  const usernames = new Map<number, string>();

  async function* lines(): AsyncGenerator<string> {
    for (const u of await db.select({ id: users.id, username: users.username }).from(users))
      usernames.set(u.id, u.username);

    if (opts.format === 'csv') {
      yield '﻿'; // so spreadsheet software reads UTF-8
      const answerCol = ner ? 'entities' : 'label';
      const header: Record<ExportLabelSet, string[]> = {
        final: ['id', 'seq', 'text', answerCol, 'source'],
        human: [
          'item_id',
          'seq',
          'text',
          'annotator',
          answerCol,
          'submitted_at',
          'duration_ms',
          'draft_shown',
          'flagged',
        ],
        llm: ['item_id', 'seq', 'text', 'model', 'status', answerCol, 'error'],
        import: ['item_id', 'seq', 'text', answerCol],
        all: [],
      };
      yield csvLine(opts.includeMeta ? [...header[opts.labels], 'meta'] : header[opts.labels]);
    }

    let lastSeq = 0;
    for (;;) {
      const page: ItemRow[] = await db
        .select()
        .from(items)
        .where(
          and(
            eq(items.projectId, project.id),
            gt(items.seq, lastSeq),
            opts.onlyFinalized ? isNotNull(items.finalizedAt) : undefined,
          ),
        )
        .orderBy(asc(items.seq))
        .limit(PAGE);
      if (page.length === 0) return;
      lastSeq = page[page.length - 1]!.seq;

      const needAnnotations = opts.labels !== 'final';
      const byItem = new Map<number, AnnotationRow[]>();
      if (needAnnotations) {
        const anns = await db
          .select()
          .from(annotations)
          .where(
            and(
              inArray(
                annotations.itemId,
                page.map((i) => i.id),
              ),
              inArray(annotations.status, ['submitted', 'error']),
            ),
          )
          .orderBy(asc(annotations.id));
        for (const a of anns) byItem.set(a.itemId, [...(byItem.get(a.itemId) ?? []), a]);
      }

      for (const item of page) {
        const meta = opts.includeMeta ? item.meta : undefined;
        const anns = byItem.get(item.id) ?? [];
        const human = anns.filter((a) => a.source === 'human' && a.status === 'submitted');
        const llm = anns.find((a) => a.source === 'llm');
        const imported = anns.find((a) => a.source === 'import');
        const final = item.finalizedAt
          ? answer(item.text, { label: item.finalLabel, spans: item.finalSpans })
          : null;

        if (opts.format === 'conll') {
          yield conllBlock(item.text, item.finalSpans ?? []);
          continue;
        }

        if (opts.labels === 'final') {
          if (opts.format === 'jsonl') {
            yield `${JSON.stringify({
              id: item.id,
              seq: item.seq,
              text: item.text,
              ...(final ?? (ner ? { entities: null } : { label: null })),
              source: item.finalSource,
              ...(meta ? { meta } : {}),
            })}\n`;
          } else {
            const value = final
              ? ner
                ? (final as { entities: unknown }).entities
                : (final as { label: unknown }).label
              : null;
            yield csvLine([
              item.id,
              item.seq,
              item.text,
              value,
              item.finalSource,
              ...(meta ? [meta] : []),
            ]);
          }
          continue;
        }

        if (opts.labels === 'all') {
          yield `${JSON.stringify({
            id: item.id,
            seq: item.seq,
            text: item.text,
            final: final ? { ...final, source: item.finalSource } : null,
            human: human.map((a) => ({
              annotator: a.userId != null ? (usernames.get(a.userId) ?? null) : null,
              ...answer(item.text, a),
              submitted_at: a.submittedAt,
              duration_ms: a.durationMs,
              draft_shown: a.draftShown,
              flagged: a.flagged,
            })),
            llm: llm
              ? {
                  model: llm.model,
                  status: llm.status,
                  ...(llm.status === 'submitted' ? answer(item.text, llm) : {}),
                  error: llm.error,
                }
              : null,
            import: imported ? answer(item.text, imported) : null,
            ...(meta ? { meta } : {}),
          })}\n`;
          continue;
        }

        const selected =
          opts.labels === 'human'
            ? human
            : opts.labels === 'llm'
              ? llm
                ? [llm]
                : []
              : imported
                ? [imported]
                : [];
        for (const a of selected) {
          const value =
            a.status === 'submitted'
              ? answer(item.text, a)
              : ner
                ? { entities: null }
                : { label: null };
          const flat = ner
            ? (value as { entities: unknown }).entities
            : (value as { label: unknown }).label;
          if (opts.labels === 'human') {
            const annotator = a.userId != null ? (usernames.get(a.userId) ?? null) : null;
            if (opts.format === 'jsonl') {
              yield `${JSON.stringify({
                item_id: item.id,
                seq: item.seq,
                text: item.text,
                annotator,
                ...value,
                submitted_at: a.submittedAt,
                duration_ms: a.durationMs,
                draft_shown: a.draftShown,
                flagged: a.flagged,
                ...(meta ? { meta } : {}),
              })}\n`;
            } else {
              yield csvLine([
                item.id,
                item.seq,
                item.text,
                annotator,
                flat,
                a.submittedAt?.toISOString(),
                a.durationMs,
                a.draftShown,
                a.flagged,
                ...(meta ? [meta] : []),
              ]);
            }
          } else if (opts.labels === 'llm') {
            if (opts.format === 'jsonl') {
              yield `${JSON.stringify({ item_id: item.id, seq: item.seq, text: item.text, model: a.model, status: a.status, ...value, error: a.error, ...(meta ? { meta } : {}) })}\n`;
            } else {
              yield csvLine([
                item.id,
                item.seq,
                item.text,
                a.model,
                a.status,
                flat,
                a.error,
                ...(meta ? [meta] : []),
              ]);
            }
          } else if (opts.format === 'jsonl') {
            yield `${JSON.stringify({ item_id: item.id, seq: item.seq, text: item.text, ...value, ...(meta ? { meta } : {}) })}\n`;
          } else {
            yield csvLine([item.id, item.seq, item.text, flat, ...(meta ? [meta] : [])]);
          }
        }
      }
    }
  }

  const iterator = lines();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        let chunk = '';
        // Batch many small lines into one enqueue.
        while (chunk.length < 64_000) {
          const { value, done } = await iterator.next();
          if (done) {
            if (chunk) controller.enqueue(encoder.encode(chunk));
            controller.close();
            return;
          }
          chunk += value;
        }
        controller.enqueue(encoder.encode(chunk));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}
