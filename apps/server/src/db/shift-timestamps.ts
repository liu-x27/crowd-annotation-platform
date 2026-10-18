import { type Db, rows, sql } from './client';

/**
 * Move every timestamp in the application's tables by `seconds`, in one transaction. Used
 * to bring a demo database built ahead of time up to date: its fortnight of activity then
 * ends when the instance starts, not when the image was built.
 */
export async function shiftTimestamps(db: Db, seconds: number): Promise<number> {
  const columns = await rows<{ table_name: string; column_name: string }>(
    db,
    sql`select table_name, column_name from information_schema.columns
        where table_schema = 'public' and data_type = 'timestamp with time zone'
        order by table_name, ordinal_position`,
  );
  const byTable = new Map<string, string[]>();
  for (const c of columns)
    byTable.set(c.table_name, [...(byTable.get(c.table_name) ?? []), c.column_name]);
  await db.transaction(async (tx) => {
    for (const [table, cols] of byTable) {
      const sets = cols.map(
        (c) => sql`${sql.identifier(c)} = ${sql.identifier(c)} + make_interval(secs => ${seconds})`,
      );
      await tx.execute(sql`update ${sql.identifier(table)} set ${sql.join(sets, sql`, `)}`);
    }
  });
  return columns.length;
}
