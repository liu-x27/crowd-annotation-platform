import { alignEntities, type EntityGuess, type SpanWithText } from '@crowd/shared';
import { z } from 'zod';

/**
 * Pull a JSON object out of model output. Handles reasoning blocks, code fences and prose
 * around the object by scanning for a balanced `{…}` — string-aware, so braces inside
 * values do not confuse it. Returns undefined when there is no object to find.
 */
export function extractJson(raw: string): unknown | undefined {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through to scanning
  }
  for (let start = cleaned.indexOf('{'); start !== -1; start = cleaned.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  return undefined;
}

export type ClassificationParse = { ok: true; label: string } | { ok: false; error: string };

/**
 * Exact label or nothing. v1 accepted the first label *mentioned anywhere* in the reply,
 * so "not sports, it's finance" was labelled sports, and a failed call became the first
 * label in the list. Here a reply either names one allowed label or is an error.
 */
export function parseClassification(raw: string, labels: string[]): ClassificationParse {
  const json = extractJson(raw);
  let candidate: string | undefined;
  if (json !== undefined) {
    const parsed = z.object({ label: z.string() }).safeParse(json);
    if (!parsed.success) return { ok: false, error: 'reply is JSON but has no "label" string' };
    candidate = parsed.data.label.trim();
  } else {
    candidate = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!labels.includes(candidate))
      return { ok: false, error: 'reply is not JSON and not a bare label' };
  }
  if (labels.includes(candidate)) return { ok: true, label: candidate };
  const folded = labels.filter((l) => l.toLowerCase() === candidate!.toLowerCase());
  if (folded.length === 1) return { ok: true, label: folded[0]! };
  return { ok: false, error: `"${candidate.slice(0, 60)}" is not one of the labels` };
}

export type NerParse =
  | { ok: true; spans: SpanWithText[]; unaligned: EntityGuess[]; conflicts: EntityGuess[] }
  | { ok: false; error: string };

export function parseNer(raw: string, text: string, labels: string[]): NerParse {
  const json = extractJson(raw);
  if (json === undefined) return { ok: false, error: 'reply contains no JSON object' };
  const parsed = z
    .object({ entities: z.array(z.object({ text: z.string(), label: z.string() })) })
    .safeParse(json);
  if (!parsed.success)
    return { ok: false, error: 'reply is JSON but not {"entities": [{"text", "label"}]}' };
  const aligned = alignEntities(text, parsed.data.entities, labels);
  return { ok: true, ...aligned };
}
