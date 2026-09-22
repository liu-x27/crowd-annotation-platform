import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** The repository root: the nearest ancestor whose package.json declares workspaces. */
export function findRepoRoot(from = path.dirname(fileURLToPath(import.meta.url))): string {
  let dir = from;
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if (JSON.parse(readFileSync(pkg, 'utf8')).workspaces) return dir;
      } catch {
        // unreadable package.json: keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

const flag = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  DATA_DIR: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  ALLOW_REGISTRATION: flag.default(true),
  TRUSTED_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  COOKIE_SECURE: flag.optional(),
  OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('qwen3:4b'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  OPENAI_BASE_URL: z.url().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default(''),
  LLM_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(90_000),
  WEB_DIST: z.string().optional(),
});

export interface Config {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  repoRoot: string;
  dataDir: string;
  /** Postgres connection string; when absent the embedded PGlite database in dataDir is used. */
  databaseUrl: string | null;
  sessionTtlMs: number;
  allowRegistration: boolean;
  trustedOrigins: string[];
  cookieSecure: boolean;
  ollama: { baseUrl: string; model: string };
  anthropic: { apiKey: string | null; model: string };
  openai: { baseUrl: string | null; apiKey: string | null; model: string };
  llmConcurrency: number;
  llmTimeoutMs: number;
  webDist: string;
}

function emptyToUndefined(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v === '' ? undefined : v]));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const repoRoot = findRepoRoot();
  const envFile = path.join(repoRoot, '.env');
  if (env === process.env && existsSync(envFile)) process.loadEnvFile(envFile);

  const parsed = envSchema.safeParse(emptyToUndefined(env));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const dataDir = path.resolve(repoRoot, e.DATA_DIR ?? 'data');
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    repoRoot,
    dataDir,
    databaseUrl: e.DATABASE_URL ?? null,
    sessionTtlMs: e.SESSION_TTL_DAYS * 86_400_000,
    allowRegistration: e.ALLOW_REGISTRATION,
    trustedOrigins: e.TRUSTED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
    ollama: { baseUrl: e.OLLAMA_BASE_URL.replace(/\/+$/, ''), model: e.OLLAMA_MODEL },
    anthropic: { apiKey: e.ANTHROPIC_API_KEY ?? null, model: e.ANTHROPIC_MODEL },
    openai: {
      baseUrl: e.OPENAI_BASE_URL?.replace(/\/+$/, '') ?? null,
      apiKey: e.OPENAI_API_KEY ?? null,
      model: e.OPENAI_MODEL,
    },
    llmConcurrency: e.LLM_CONCURRENCY,
    llmTimeoutMs: e.LLM_TIMEOUT_MS,
    webDist: path.resolve(repoRoot, e.WEB_DIST ?? 'apps/web/dist'),
  };
}

/** A config for tests: in-memory database, no .env, nothing external. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({ NODE_ENV: 'test' }),
    dataDir: ':memory:',
    databaseUrl: process.env.TEST_DATABASE_URL ?? null,
    ...overrides,
  };
}
