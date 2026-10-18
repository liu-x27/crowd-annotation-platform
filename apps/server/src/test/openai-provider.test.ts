import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpenAiCompatibleProvider } from '../modules/llm/providers/openai';
import { ProviderError } from '../modules/llm/types';

/** A stand-in for an OpenAI-compatible server: each test says what the next reply is. */
let server: Server;
let base: string;
let reply: (body: Record<string, unknown>) => { status: number; json: unknown };
const seen: Record<string, unknown>[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      seen.push(body);
      const { status, json } = reply(body);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const request = {
  task: 'classification' as const,
  model: 'some-model',
  system: 'Label the review.',
  messages: [{ role: 'user' as const, content: 'It broke on day two.' }],
  schema: { type: 'object', properties: { label: { type: 'string' } } },
  temperature: 0,
  maxTokens: 256,
};

const answer = (content: string, finish = 'stop') => ({
  status: 200,
  json: { model: 'some-model', choices: [{ message: { content }, finish_reason: finish }] },
});

describe('the OpenAI-compatible provider', () => {
  it('asks for the JSON schema and leaves room for a model that thinks first', async () => {
    reply = () => answer('{"label":"negative"}');
    const provider = new OpenAiCompatibleProvider(base, null, 'some-model', 10_000);
    const done = await provider.complete(request);
    expect(done.text).toBe('{"label":"negative"}');
    const body = seen.at(-1)!;
    expect(body.max_tokens).toBeGreaterThanOrEqual(4096);
    expect(body.response_format).toMatchObject({ type: 'json_schema' });
  });

  it('says an answer was cut off, rather than handing on an empty reply', async () => {
    reply = () => answer('', 'length');
    const provider = new OpenAiCompatibleProvider(base, null, 'some-model', 10_000);
    const error = await provider.complete(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).message).toMatch(/cut off/);
    expect((error as ProviderError).fatal).toBe(false);
  });

  it('falls back to json_object when the server does not take a schema', async () => {
    reply = (body) =>
      (body.response_format as { type?: string } | undefined)?.type === 'json_schema'
        ? { status: 400, json: { error: 'response_format json_schema is not supported' } }
        : answer('{"label":"neutral"}');
    const provider = new OpenAiCompatibleProvider(base, null, 'some-model', 10_000);
    const done = await provider.complete(request);
    expect(done.text).toBe('{"label":"neutral"}');
    expect(seen.at(-1)!.response_format).toEqual({ type: 'json_object' });
  });
});
