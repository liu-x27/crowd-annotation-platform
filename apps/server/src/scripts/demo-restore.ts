/**
 * Container start on a demo instance (DEMO_MODE=true): if the data directory is empty and
 * the image carries a demo database, copy it in and move its timestamps forward to now.
 *
 * The image carries one when it was built with the build argument DEMO_MODE=true (Render
 * passes a service's environment variables to the build that way). Building it ahead of
 * time is the point: seeding takes about ten seconds on a laptop and minutes on a 0.1-CPU
 * free instance, and free instances lose their disk every time they stop. Does nothing on
 * a Postgres server, on a data directory that already has a database, or without one.
 */
import { cpSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config';
import { openDatabase } from '../db/client';
import { shiftTimestamps } from '../db/shift-timestamps';

const config = loadConfig();
const demo = path.join(config.repoRoot, 'demo');

async function restore(): Promise<string> {
  if (existsSync(path.join(config.dataDir, 'pgdata')))
    return `${config.dataDir} already has a database; leaving it as it is.`;
  if (!existsSync(path.join(demo, 'pgdata')))
    return 'this image has no demo database (build it with --build-arg DEMO_MODE=true), so the instance starts empty.';

  cpSync(demo, config.dataDir, { recursive: true });
  const builtAt = Number(readFileSync(path.join(demo, 'built-at'), 'utf8'));
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - builtAt));
  const database = await openDatabase(config);
  try {
    await shiftTimestamps(database.db, seconds);
  } finally {
    await database.close();
  }
  return `started from the demo database built ${(seconds / 86_400).toFixed(1)} days ago, its dates moved forward to today.`;
}

if (config.demoMode && !config.databaseUrl) console.log(`Demo: ${await restore()}`);
