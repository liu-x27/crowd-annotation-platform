import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Prediction } from '@crowd/shared';
import { withText } from '@crowd/shared';
import { notFound } from '../../lib/errors';
import { hashedCounts, tfidf } from './features';
import { decodeModel } from './model-file';
import { positionFeatures, type TaggerModel, tagsToSpans, viterbi } from './perceptron';
import { probabilities, type SoftmaxModel } from './softmax';

type Loaded =
  | {
      kind: 'classification';
      labels: string[];
      bits: number;
      idf: Float32Array;
      softmax: SoftmaxModel;
    }
  | { kind: 'ner'; labels: string[]; bits: number; tagger: TaggerModel };

/** Trained models, as files under DATA_DIR/models (or in memory for tests), with a small LRU. */
export class ModelStore {
  private readonly memory = new Map<number, Uint8Array>();
  private readonly cache = new Map<number, Loaded>();

  constructor(private readonly dir: string | null) {}

  private file(jobId: number): string {
    return path.join(this.dir!, `model-${jobId}.cap`);
  }

  async save(jobId: number, bytes: Uint8Array): Promise<void> {
    if (!this.dir) {
      this.memory.set(jobId, bytes);
      return;
    }
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(jobId), bytes);
  }

  async remove(jobId: number): Promise<void> {
    this.cache.delete(jobId);
    this.memory.delete(jobId);
    if (this.dir) await rm(this.file(jobId), { force: true });
  }

  private async load(jobId: number): Promise<Loaded> {
    const hit = this.cache.get(jobId);
    if (hit) {
      this.cache.delete(jobId);
      this.cache.set(jobId, hit);
      return hit;
    }
    let bytes: Uint8Array | undefined;
    if (this.dir) {
      try {
        bytes = await readFile(this.file(jobId));
      } catch {
        bytes = undefined;
      }
    } else {
      bytes = this.memory.get(jobId);
    }
    if (!bytes) throw notFound('Model file');
    const { header, arrays } = decodeModel(bytes);
    const loaded: Loaded =
      header.kind === 'classification'
        ? {
            kind: 'classification',
            labels: header.labels,
            bits: header.bits,
            idf: arrays.idf!,
            softmax: {
              dims: 1 << header.bits,
              classes: header.labels.length,
              weights: arrays.weights!,
              bias: arrays.bias!,
            },
          }
        : {
            kind: 'ner',
            labels: header.labels,
            bits: header.bits,
            tagger: {
              bits: header.bits,
              tags: header.tags!,
              emission: arrays.emission!,
              transition: arrays.transition!,
            },
          };
    this.cache.set(jobId, loaded);
    while (this.cache.size > 3) this.cache.delete(this.cache.keys().next().value!);
    return loaded;
  }

  async predict(jobId: number, text: string): Promise<Prediction> {
    const model = await this.load(jobId);
    if (model.kind === 'classification') {
      const p = probabilities(model.softmax, tfidf(hashedCounts(text, model.bits), model.idf));
      const ranked = model.labels
        .map((label, i) => ({ label, p: p[i]! }))
        .sort((a, b) => b.p - a.p);
      return { label: ranked[0]?.label ?? null, probabilities: ranked, spans: null };
    }
    const chars = Array.from(text);
    const tags = viterbi(model.tagger, positionFeatures(chars, model.bits));
    return {
      label: null,
      probabilities: [],
      spans: withText(text, tagsToSpans(tags, model.labels)),
    };
  }
}
