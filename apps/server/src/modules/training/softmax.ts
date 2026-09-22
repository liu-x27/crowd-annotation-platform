import type { SparseVector } from './features';
import { shuffle } from './rng';

export interface SoftmaxModel {
  dims: number;
  classes: number;
  weights: Float32Array; // dims × classes, row-major by feature
  bias: Float32Array;
}

export function newSoftmax(dims: number, classes: number): SoftmaxModel {
  return {
    dims,
    classes,
    weights: new Float32Array(dims * classes),
    bias: new Float32Array(classes),
  };
}

export function probabilities(
  model: SoftmaxModel,
  x: SparseVector,
  out = new Float64Array(model.classes),
): Float64Array {
  const { classes, weights, bias } = model;
  for (let c = 0; c < classes; c++) out[c] = bias[c];
  for (let k = 0; k < x.idx.length; k++) {
    const row = x.idx[k] * classes;
    const v = x.val[k];
    for (let c = 0; c < classes; c++) out[c] += weights[row + c] * v;
  }
  let max = -Infinity;
  for (let c = 0; c < classes; c++) if (out[c] > max) max = out[c];
  let sum = 0;
  for (let c = 0; c < classes; c++) {
    out[c] = Math.exp(out[c] - max);
    sum += out[c];
  }
  for (let c = 0; c < classes; c++) out[c] /= sum;
  return out;
}

export function argmax(p: ArrayLike<number>): number {
  let best = 0;
  for (let c = 1; c < p.length; c++) if (p[c] > p[best]) best = c;
  return best;
}

export interface SoftmaxTrainer {
  model: SoftmaxModel;
  /** One pass over the data. Returns the mean cross-entropy seen during the pass. */
  epoch(data: SparseVector[], labels: number[], random: () => number): number;
}

/**
 * Multinomial logistic regression trained with sparse AdaGrad: each example only touches
 * the weight rows of its active features, so an epoch costs O(nnz × classes), not
 * O(dims × classes). L2 regularisation is applied to the touched rows.
 */
export function softmaxTrainer(
  dims: number,
  classes: number,
  opts: { lr?: number; l2?: number } = {},
): SoftmaxTrainer {
  const lr = opts.lr ?? 0.5;
  const l2 = opts.l2 ?? 1e-5;
  const eps = 1e-8;
  const model = newSoftmax(dims, classes);
  const g2 = new Float32Array(dims * classes);
  const g2b = new Float32Array(classes);
  const p = new Float64Array(classes);

  return {
    model,
    epoch(data, labels, random) {
      let loss = 0;
      for (const i of shuffle(
        data.map((_, j) => j),
        random,
      )) {
        const x = data[i];
        const y = labels[i];
        probabilities(model, x, p);
        loss -= Math.log(Math.max(p[y], 1e-12));
        for (let c = 0; c < classes; c++) {
          const grad = p[c] - (c === y ? 1 : 0);
          g2b[c] += grad * grad;
          model.bias[c] -= (lr * grad) / (Math.sqrt(g2b[c]) + eps);
          for (let k = 0; k < x.idx.length; k++) {
            const at = x.idx[k] * classes + c;
            const g = grad * x.val[k] + l2 * model.weights[at];
            g2[at] += g * g;
            model.weights[at] -= (lr * g) / (Math.sqrt(g2[at]) + eps);
          }
        }
      }
      return data.length ? loss / data.length : 0;
    },
  };
}

export function meanLoss(model: SoftmaxModel, data: SparseVector[], labels: number[]): number {
  if (data.length === 0) return 0;
  const p = new Float64Array(model.classes);
  let loss = 0;
  data.forEach((x, i) => {
    probabilities(model, x, p);
    loss -= Math.log(Math.max(p[labels[i]], 1e-12));
  });
  return loss / data.length;
}

export function predictAll(model: SoftmaxModel, data: SparseVector[]): number[] {
  const p = new Float64Array(model.classes);
  return data.map((x) => argmax(probabilities(model, x, p)));
}

export function cloneSoftmax(m: SoftmaxModel): SoftmaxModel {
  return { dims: m.dims, classes: m.classes, weights: m.weights.slice(), bias: m.bias.slice() };
}
