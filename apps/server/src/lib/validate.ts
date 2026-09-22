import type { Context } from 'hono';
import type { z } from 'zod';
import { AppError, badRequest } from './errors';

function fail(error: z.ZodError): AppError {
  const issues = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  const first = issues[0];
  const message = first
    ? first.path
      ? `${first.path}: ${first.message}`
      : first.message
    : 'Invalid input.';
  return new AppError(400, 'invalid_input', message, { issues });
}

export async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('Request body must be JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw fail(parsed.error);
  return parsed.data;
}

export function query<S extends z.ZodType>(c: Context, schema: S): z.infer<S> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw fail(parsed.error);
  return parsed.data;
}

export function idParam(c: Context, name = 'id'): number {
  const value = Number(c.req.param(name));
  if (!Number.isInteger(value) || value <= 0) throw badRequest(`Invalid ${name}.`);
  return value;
}
