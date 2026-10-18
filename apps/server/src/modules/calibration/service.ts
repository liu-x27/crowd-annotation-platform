import {
  altTest,
  CALIBRATION_ANSWERS,
  type CalibrationReport,
  classicalMean,
  ppiMean,
  tally,
  wilsonInterval,
} from '@crowd/shared';
import { sql } from 'drizzle-orm';
import { type Db, rows } from '../../db/client';
import type { ProjectRow } from '../../db/schema';
import { conflict } from '../../lib/errors';
import { userRefs } from '../metrics/reports';

/**
 * Draw the calibration set: `size` items that nobody has answered or claimed yet, in the
 * order of a hash of their ids, so the draw is a uniform sample that anyone can repeat.
 * Drawn once: a second draw is refused until the set is cleared.
 */
export async function drawCalibration(
  db: Db,
  project: ProjectRow,
  size: number,
): Promise<{ drawn: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7202, ${project.id}::int)`);
    const [existing] = await rows<{ n: number }>(
      tx,
      sql`select count(*)::int as n from items where project_id = ${project.id} and calibration`,
    );
    if (existing!.n > 0) {
      throw conflict(
        'calibration_exists',
        'This project already has a calibration set. Clear it to draw another.',
      );
    }
    const drawn = await rows<{ id: number }>(
      tx,
      sql`
        update items set calibration = true
        where id in (
          select i.id from items i
          where i.project_id = ${project.id} and i.finalized_at is null and i.human_count = 0
            and not exists (select 1 from annotations a where a.item_id = i.id and a.source = 'human')
          order by md5('calibration:' || i.project_id || ':' || i.id), i.id
          limit ${size})
        returning id`,
    );
    return { drawn: drawn.length };
  });
}

/** Take every item out of the calibration set. Their answers stay; only the flag goes. */
export async function clearCalibration(db: Db, project: ProjectRow): Promise<{ cleared: number }> {
  const cleared = await rows<{ id: number }>(
    db,
    sql`update items set calibration = false
        where project_id = ${project.id} and calibration returning id`,
  );
  return { cleared: cleared.length };
}

const finite = (x: number) => (Number.isFinite(x) ? x : null);

/**
 * What the calibration set says about the drafts. Only blind answers count: those given
 * without the draft on screen, which on a calibration item is every answer unless it was
 * claimed before the item was drawn. An item's reference is the most common of its blind
 * answers, once it has CALIBRATION_ANSWERS of them; a tie leaves it out.
 */
export async function calibrationReport(
  db: Db,
  project: ProjectRow,
  epsilon: number,
): Promise<CalibrationReport> {
  const [{ size } = { size: 0 }] = await rows<{ size: number }>(
    db,
    sql`select count(*)::int as size from items where project_id = ${project.id} and calibration`,
  );
  const report: CalibrationReport = {
    size,
    complete: 0,
    referenced: 0,
    ties: 0,
    supported: project.type === 'classification',
    draftAccuracy: null,
    altTest: null,
    distribution: null,
  };
  if (size === 0 || !report.supported) return report;

  const answers = await rows<{ item_id: number; user_id: number; label: string }>(
    db,
    sql`
      select a.item_id, a.user_id, a.label from annotations a join items i on i.id = a.item_id
      where i.project_id = ${project.id} and i.calibration
        and a.source = 'human' and a.status = 'submitted' and a.draft_shown is not true
        and a.label is not null and a.user_id is not null
      order by a.user_id, a.item_id`,
  );
  const drafts = await rows<{ item_id: number; label: string; calibration: boolean }>(
    db,
    sql`
      select d.item_id, d.label, i.calibration from annotations d join items i on i.id = d.item_id
      where i.project_id = ${project.id} and d.source = 'llm' and d.status = 'submitted'
        and d.label is not null`,
  );
  const draftOf = new Map(drafts.map((d) => [d.item_id, d.label]));

  const byItem = new Map<number, string[]>();
  for (const a of answers) byItem.set(a.item_id, [...(byItem.get(a.item_id) ?? []), a.label]);
  const reference = new Map<number, string>();
  for (const [itemId, labels] of byItem) {
    if (labels.length < CALIBRATION_ANSWERS) continue;
    report.complete++;
    const t = tally(
      project.type,
      labels.map((label) => ({ label, spans: null })),
    )!;
    if (t.tie) report.ties++;
    else reference.set(itemId, t.top.label!);
  }
  report.referenced = reference.size;

  // Draft accuracy against the reference.
  const compared = [...reference].filter(([itemId]) => draftOf.has(itemId));
  if (compared.length) {
    const correct = compared.filter(([itemId, label]) => draftOf.get(itemId) === label).length;
    report.draftAccuracy = {
      correct,
      n: compared.length,
      interval: wilsonInterval(correct, compared.length),
    };
  }

  // The alternative annotator test, on every blind answer to a calibration item.
  const byUser = new Map<number, Map<number, string>>();
  for (const a of answers) {
    if (!byUser.has(a.user_id)) byUser.set(a.user_id, new Map());
    byUser.get(a.user_id)!.set(a.item_id, a.label);
  }
  const model = new Map(drafts.filter((d) => d.calibration).map((d) => [d.item_id, d.label]));
  if (byUser.size >= 2 && model.size) {
    const result = altTest(model, byUser, { epsilon });
    const refs = await userRefs(db, [...byUser.keys()]);
    report.altTest = {
      epsilon: result.epsilon,
      q: result.q,
      annotators: result.annotators.map((a) => ({
        user: refs.get(a.annotator)!,
        instances: a.instances,
        modelAdvantage: a.modelAdvantage,
        annotatorAdvantage: a.annotatorAdvantage,
        pValue: finite(a.pValue),
        modelWins: a.modelWins,
      })),
      skipped: result.skipped.map((s) => ({
        user: refs.get(s.annotator)!,
        instances: s.instances,
      })),
      winningRate: result.winningRate,
      advantageProbability: result.advantageProbability,
      passed: result.passed,
    };
  }

  // The label distribution: calibration items with a reference and a draft are the
  // labelled sample, every other drafted item is unlabelled.
  const labelled = compared.map(([itemId, label]) => ({ label, draft: draftOf.get(itemId)! }));
  const unlabelled = drafts.filter((d) => !d.calibration).map((d) => d.label);
  if (labelled.length >= 2 && unlabelled.length >= 1) {
    const indicator = (xs: string[], label: string): number[] =>
      xs.map((x) => (x === label ? 1 : 0));
    report.distribution = {
      n: labelled.length,
      N: unlabelled.length,
      labels: project.labels.map(({ name }) => {
        const y = indicator(
          labelled.map((l) => l.label),
          name,
        );
        const yhat = indicator(
          labelled.map((l) => l.draft),
          name,
        );
        const unl = indicator(unlabelled, name);
        return {
          label: name,
          drafts: [...yhat, ...unl].reduce((s, x) => s + x, 0) / (yhat.length + unl.length),
          calibration: classicalMean(y),
          ppi: ppiMean(y, yhat, unl),
        };
      }),
    };
  }
  return report;
}
