import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type SQL, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import type { Config } from '../config';
import * as schema from './schema';

export type Schema = typeof schema;
// biome-ignore lint/suspicious/noExplicitAny: the two drivers differ only in their result HKT
export type Db = PgDatabase<PgQueryResultHKT, Schema, any>;
// biome-ignore lint/suspicious/noExplicitAny: see above
export type Tx = PgTransaction<PgQueryResultHKT, Schema, any>;
export type DbOrTx = Db | Tx;

export interface Database {
  db: Db;
  kind: 'pglite' | 'postgres';
  close(): Promise<void>;
}

/** The migrations folder, found from wherever this module ended up (src/ or a dist bundle). */
export function migrationsFolder(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'drizzle');
    if (existsSync(path.join(candidate, 'meta', '_journal.json'))) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('drizzle migrations folder not found');
}

export async function openDatabase(
  config: Pick<Config, 'databaseUrl' | 'dataDir'> & Partial<Pick<Config, 'lowMemory'>>,
): Promise<Database> {
  const folder = migrationsFolder();

  if (config.databaseUrl) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    // No JIT on the app's connections. Postgres compiles a query's expressions once its
    // estimated cost passes jit_above_cost, and for queries over a few thousand rows the
    // compiling takes longer than the running: under the k6 load test, the count of what is
    // left spent 45 of its 86 ms compiling. An `options` parameter in DATABASE_URL replaces this.
    const pool = new Pool({ connectionString: config.databaseUrl, max: 10, options: '-c jit=off' });
    const db = drizzle(pool, { schema, casing: 'snake_case' });
    await migrate(db, { migrationsFolder: folder });
    return { db: db as unknown as Db, kind: 'postgres', close: () => pool.end() };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  // Postgres's default 128 MB buffer cache lives inside PGlite's WebAssembly memory, while
  // the operating system caches the same files anyway; a small instance can do with less.
  // Passed at start, not written to postgresql.conf, so it lasts only while it is set.
  const options = config.lowMemory
    ? { startParams: [...PGlite.defaultStartParams, '-c', 'shared_buffers=16MB'] }
    : {};
  let client: InstanceType<typeof PGlite>;
  if (config.dataDir === ':memory:') {
    client = new PGlite(options);
  } else {
    const dir = path.join(config.dataDir, 'pgdata');
    mkdirSync(dir, { recursive: true });
    client = new PGlite(dir, options);
  }
  const db = drizzle(client, { schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder: folder });
  return { db: db as unknown as Db, kind: 'pglite', close: () => client.close() };
}

/** Run raw SQL and return plain rows, whichever driver is underneath. */
export async function rows<T>(db: DbOrTx, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

export async function one<T>(db: DbOrTx, query: SQL): Promise<T | undefined> {
  return (await rows<T>(db, query))[0];
}

export { sql };
