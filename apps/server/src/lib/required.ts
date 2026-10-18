import { CALIBRATION_ANSWERS } from '@crowd/shared';
import { type SQL, sql } from 'drizzle-orm';

/**
 * `requiredAnswers` in SQL: how many answers the `items` row `alias` needs before it is
 * complete, in a project whose redundancy is `redundancy` (a number, or SQL for one).
 */
export function requiredSql(alias: string, redundancy: number | SQL): SQL {
  const k = typeof redundancy === 'number' ? sql.raw(String(Math.trunc(redundancy))) : redundancy;
  return sql`(case when ${sql.raw(alias)}.calibration then greatest(${k}, ${sql.raw(String(CALIBRATION_ANSWERS))}) else ${k} end)`;
}
