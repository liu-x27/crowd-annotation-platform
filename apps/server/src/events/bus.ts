import { EventEmitter } from 'node:events';
import type { ServerEvent } from '@crowd/shared';

type ProjectReason = Extract<ServerEvent, { type: 'project' }>['reason'];

/**
 * In-process pub/sub feeding the SSE endpoint. Project change notices are coalesced per
 * (project, reason) so a burst of submissions produces one event, not hundreds.
 */
export class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly pending = new Map<string, NodeJS.Timeout>();

  constructor(private readonly coalesceMs = 400) {
    this.emitter.setMaxListeners(0);
  }

  publish(event: ServerEvent): void {
    this.emitter.emit('event', event);
  }

  projectChanged(projectId: number, reason: ProjectReason): void {
    const key = `${projectId}:${reason}`;
    if (this.pending.has(key)) return;
    this.pending.set(
      key,
      setTimeout(() => {
        this.pending.delete(key);
        this.publish({ type: 'project', projectId, reason });
      }, this.coalesceMs).unref(),
    );
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  close(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    this.emitter.removeAllListeners();
  }
}
