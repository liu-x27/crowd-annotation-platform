/**
 * Copy a v1 (MongoDB) database into v2. Reads v1, never writes to it.
 *
 *   npm run migrate:v1 -- [--mongo mongodb://localhost:27017] [--db crowd_platform]
 *                         [--data-dir ./data-migrated] [--burst-threshold 100] [--keep-imported-open]
 *
 * The target must be empty. Point DATA_DIR / --data-dir (or DATABASE_URL) somewhere fresh.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { MongoClient } from 'mongodb';
import { loadConfig } from '../config';
import { openDatabase } from '../db/client';
import { projects, users } from '../db/schema';
import { migrateV1, type V1Data } from '../migrate-v1/migrate';

const { values } = parseArgs({
  options: {
    mongo: { type: 'string', default: 'mongodb://localhost:27017' },
    db: { type: 'string', default: 'crowd_platform' },
    'data-dir': { type: 'string' },
    'burst-threshold': { type: 'string', default: '100' },
    'keep-imported-open': { type: 'boolean', default: false },
  },
});

const config = loadConfig();
// npm runs workspace scripts from apps/server; resolve against where the command was typed.
if (values['data-dir'])
  config.dataDir = path.resolve(process.env.INIT_CWD ?? process.cwd(), values['data-dir']);

const stringify = (doc: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(doc).map(([k, v]) => [
      k,
      v &&
      typeof v === 'object' &&
      '_bsontype' in v &&
      (v as { _bsontype: string })._bsontype === 'ObjectId'
        ? String(v)
        : v,
    ]),
  );

async function main() {
  const target = await openDatabase(config);
  const [anyUser] = await target.db.select({ id: users.id }).from(users).limit(1);
  const [anyProject] = await target.db.select({ id: projects.id }).from(projects).limit(1);
  if (anyUser || anyProject) {
    console.error(
      `The target database (${config.databaseUrl ? 'DATABASE_URL' : config.dataDir}) is not empty. Use a fresh --data-dir.`,
    );
    await target.close();
    process.exit(1);
  }

  console.log(`Reading v1 from ${values.mongo}/${values.db} (read-only)…`);
  const mongo = new MongoClient(values.mongo!);
  await mongo.connect();
  const db = mongo.db(values.db);
  const read = async <T>(name: string) =>
    (await db.collection(name).find().toArray()).map((d) => stringify(d) as T);
  const data: V1Data = {
    users: await read('users'),
    tasks: await read('tasks'),
    samples: await read('samples'),
    annotations: (await read<V1Data['annotations'][number]>('annotations')).map((a) => ({
      ...a,
      userId: a.userId ? String(a.userId) : null,
      reviewedBy: a.reviewedBy ? String(a.reviewedBy) : null,
    })),
  };
  data.samples = data.samples.map((s) => ({
    ...s,
    assignedTo: s.assignedTo ? String(s.assignedTo) : null,
  }));
  await mongo.close();
  console.log(
    `  ${data.users.length} users, ${data.tasks.length} tasks, ${data.samples.length} samples, ${data.annotations.length} annotations`,
  );

  const started = performance.now();
  const report = await migrateV1(target.db, data, {
    burstThreshold: Number(values['burst-threshold']),
    finalizeImported: !values['keep-imported-open'],
  });
  await target.close();

  console.log(
    `\nMigrated in ${((performance.now() - started) / 1000).toFixed(1)} s into ${config.databaseUrl ? 'DATABASE_URL' : config.dataDir}\n`,
  );
  console.table(report.perProject);
  const { perProject: _, ...totals } = report;
  console.log(JSON.stringify(totals, null, 2));
  const file = path.join(config.dataDir, 'migration-report.json');
  if (!config.databaseUrl) {
    await writeFile(file, JSON.stringify(report, null, 2));
    console.log(`\nFull report: ${file}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
