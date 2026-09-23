import { type Answer, canonicalSpans, type FinalSource, type ProjectType } from '@crowd/shared';
import { and, eq, isNull, type SQL, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { annotations, items } from '../db/schema';

/**
 * `answerKey`, in SQL: two rows hold the same answer exactly when this expression is
 * equal for both. `alias` names an `annotations` row in the surrounding query.
 *
 * A classification row has a label and null spans, an NER row the reverse, so this is
 * the label or the spans' jsonb text. The text comparison is only a span-set comparison
 * because every write stores spans through `canonicalSpans` — sorted, and without the
 * derived `text` — and jsonb prints equal values identically. `answers.test.ts` holds
 * the two definitions to each other.
 */
export const answerSql = (alias: string): SQL =>
  sql.raw(`(coalesce(${alias}.label, '') || coalesce(${alias}.spans::text, ''))`);

/** The same, for an `items` row's final answer. */
export const finalAnswerSql = (alias: string): SQL =>
  sql.raw(`(coalesce(${alias}.final_label, '') || coalesce(${alias}.final_spans::text, ''))`);

/**
 * The `final_*` columns for an answer. Every path that finalises — consensus, review,
 * bulk review, import, the v1 migration — writes them through this, so an item of either
 * type always carries exactly one of label and spans, and spans in stored form.
 */
export function finalColumns(
  type: ProjectType,
  answer: Answer,
  source: FinalSource,
  by: number | null,
  at: Date = new Date(),
) {
  return {
    finalLabel: type === 'classification' ? answer.label : null,
    finalSpans: type === 'ner' ? canonicalSpans(answer.spans ?? []) : null,
    finalSource: source,
    finalizedBy: by,
    finalizedAt: at,
  };
}

/**
 * Finalise an item that is still open, and drop the claims left open on it.
 *
 * Returns false and changes nothing if the item is already final. That condition is in
 * the UPDATE itself, not in a check before it, so two paths deciding the same item at
 * once — a reviewer and a bulk run, say — cannot overwrite one another: whichever
 * commits second finds the row decided.
 */
export async function finalizeOpenItem(
  tx: DbOrTx,
  type: ProjectType,
  itemId: number,
  answer: Answer,
  source: FinalSource,
  by: number | null,
): Promise<boolean> {
  const done = await tx
    .update(items)
    .set(finalColumns(type, answer, source, by))
    .where(and(eq(items.id, itemId), isNull(items.finalizedAt)))
    .returning({ id: items.id });
  if (done.length) await dropOpenClaims(tx, itemId);
  return done.length > 0;
}

/** Once an item is final, open claims on it are moot. Returned work is left for the record. */
export async function dropOpenClaims(tx: DbOrTx, itemId: number): Promise<void> {
  await tx
    .delete(annotations)
    .where(
      and(
        eq(annotations.itemId, itemId),
        eq(annotations.source, 'human'),
        eq(annotations.status, 'claimed'),
        sql`${annotations.submittedAt} is null`,
      ),
    );
}
