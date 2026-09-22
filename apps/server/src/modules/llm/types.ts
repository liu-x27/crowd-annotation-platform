import type { LlmProviderId, ProviderInfo } from '@crowd/shared';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  /** JSON schema the answer must satisfy. Providers that support constrained decoding use it. */
  schema: Record<string, unknown>;
  task: 'classification' | 'ner';
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface Completion {
  text: string;
  /** Provider-qualified model name, as recorded on the draft. */
  model: string;
  latencyMs: number;
}

/**
 * `fatal` errors mean every other item would fail the same way (unreachable server, bad
 * key, unknown model), so a job stops at the first one instead of recording thousands.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly fatal: boolean,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface LlmProvider {
  readonly id: LlmProviderId;
  readonly defaultModel: string;
  describe(): Promise<ProviderInfo>;
  complete(request: CompletionRequest): Promise<Completion>;
}

export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
