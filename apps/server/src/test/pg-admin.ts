import { Client } from 'pg';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The migrated database each test database is copied from. Set by global-setup.ts. */
    pgTemplate: string;
  }
}

/** Run one statement over a short-lived connection to the database `url` names. */
export async function adminQuery<T = unknown>(
  url: string,
  statement: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(statement, params)).rows as T[];
  } finally {
    await client.end();
  }
}

/** The same server and credentials as `url`, another database. */
export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}
