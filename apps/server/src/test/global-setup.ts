import type { TestProject } from 'vitest/node';
import { openDatabase } from '../db/client';
import { adminQuery, withDatabase } from './pg-admin';

/**
 * With TEST_DATABASE_URL set, migrate one template database on that server before any test
 * runs; every test context then gets a copy of it (`testDatabase` in harness.ts). Without
 * it there is nothing to prepare: each context starts its own in-memory PGlite.
 */
export default async function setup(project: TestProject) {
  const server = process.env.TEST_DATABASE_URL;
  if (!server) return;

  const template = `crowd_test_${process.pid}`;
  await adminQuery(server, `drop database if exists "${template}" with (force)`);
  await adminQuery(server, `create database "${template}"`);
  const migrated = await openDatabase({
    databaseUrl: withDatabase(server, template),
    dataDir: ':memory:',
  });
  await migrated.close();
  // A database can only be copied while nobody is connected to it.
  await adminQuery(server, `alter database "${template}" with allow_connections false`);
  project.provide('pgTemplate', template);

  return async () => {
    const left = await adminQuery<{ datname: string }>(
      server,
      'select datname from pg_database where starts_with(datname, $1)',
      [template],
    );
    for (const { datname } of left)
      await adminQuery(server, `drop database if exists "${datname}" with (force)`);
  };
}
