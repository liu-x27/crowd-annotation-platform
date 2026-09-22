import { type Span, withText } from '@crowd/shared';
import type { ProjectRow } from '../../db/schema';
import type { ChatMessage } from './types';

export interface Example {
  itemId: number;
  text: string;
  label: string | null;
  spans: Span[] | null;
}

export interface BuiltPrompt {
  system: string;
  schema: Record<string, unknown>;
  task: 'classification' | 'ner';
  examples: Example[];
  /** Few-shot turns followed by the item, with the item's own example (if any) left out. */
  messagesFor(itemId: number | null, text: string): ChatMessage[];
  answerFor(example: Example): string;
}

const GUIDELINE_LIMIT = 6000;

export function buildPrompt(
  project: ProjectRow,
  examples: Example[],
  instructions: string,
): BuiltPrompt {
  const labels = project.labels.map((l) => l.name);
  const labelLines = project.labels
    .map(
      (l) => `- ${l.name}${l.description ? `: ${l.description.replace(/\s+/g, ' ').trim()}` : ''}`,
    )
    .join('\n');
  const guidelines = project.guidelines.trim()
    ? `\n\nAnnotation guidelines:\n${project.guidelines.trim().slice(0, GUIDELINE_LIMIT)}`
    : '';
  const extra = instructions.trim() ? `\n\n${instructions.trim()}` : '';
  const about = `Dataset: ${project.name}${project.description ? ` — ${project.description.trim()}` : ''}`;

  if (project.type === 'classification') {
    const system =
      [
        'You label text for a classification dataset.',
        about,
        '',
        'Choose exactly one label for the text in the user message. The allowed labels are:',
        labelLines,
      ].join('\n') +
      guidelines +
      extra +
      '\n\nReply with JSON only: {"label": "<one of the allowed labels>"}';
    const schema = {
      type: 'object',
      properties: { label: { type: 'string', enum: labels } },
      required: ['label'],
      additionalProperties: false,
    };
    const answerFor = (e: Example) => JSON.stringify({ label: e.label });
    return {
      system,
      schema,
      task: 'classification',
      examples,
      answerFor,
      messagesFor: (itemId, text) => [
        ...fewShot(examples, itemId, answerFor),
        { role: 'user', content: text },
      ],
    };
  }

  const system =
    [
      'You annotate named entities for a dataset.',
      about,
      '',
      'Find every entity of these types in the text in the user message:',
      labelLines,
      '',
      "List entities in order of appearance. Copy each entity's text exactly as it appears in the input — same characters, no added or removed spaces, no translation. List a repeated mention once per occurrence. Return an empty list when there are none.",
    ].join('\n') +
    guidelines +
    extra +
    '\n\nReply with JSON only: {"entities": [{"text": "<exact substring>", "label": "<type>"}]}';
  const schema = {
    type: 'object',
    properties: {
      entities: {
        type: 'array',
        items: {
          type: 'object',
          properties: { text: { type: 'string' }, label: { type: 'string', enum: labels } },
          required: ['text', 'label'],
          additionalProperties: false,
        },
      },
    },
    required: ['entities'],
    additionalProperties: false,
  };
  const answerFor = (e: Example) =>
    JSON.stringify({
      entities: withText(e.text, e.spans ?? []).map((s) => ({ text: s.text, label: s.label })),
    });
  return {
    system,
    schema,
    task: 'ner',
    examples,
    answerFor,
    messagesFor: (itemId, text) => [
      ...fewShot(examples, itemId, answerFor),
      { role: 'user', content: text },
    ],
  };
}

function fewShot(
  examples: Example[],
  itemId: number | null,
  answerFor: (e: Example) => string,
): ChatMessage[] {
  // An item must never see its own answer in the prompt, or its draft is trivially right.
  return examples
    .filter((e) => e.itemId !== itemId)
    .flatMap((e) => [
      { role: 'user' as const, content: e.text },
      { role: 'assistant' as const, content: answerFor(e) },
    ]);
}
