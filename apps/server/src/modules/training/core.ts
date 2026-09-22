import type { EpochStats, Span, TrainReport } from '@crowd/shared';
import { classificationScores, nerScores } from '../metrics/stats';
import type { TrainingInput } from './data';
import { fitIdf, hashedCounts, type SparseVector, tfidf } from './features';
import { encodeModel } from './model-file';
import {
  positionFeatures,
  spansToTags,
  type TaggerModel,
  taggerTrainer,
  tagSet,
  tagsToSpans,
  viterbi,
} from './perceptron';
import { rng, shuffle, stratifiedSplit } from './rng';
import { cloneSoftmax, meanLoss, predictAll, type SoftmaxModel, softmaxTrainer } from './softmax';

export interface TrainingOutput {
  report: TrainReport;
  model: Uint8Array;
}

const VAL_FRACTION = 0.1;
const MIN_FOR_VALIDATION = 20;

/**
 * Train and score a student model. Pure computation: no database, no files — it runs the
 * same in a worker thread and in a test. Model selection uses a validation split carved
 * from the training data; the test set is touched once, by the selected model.
 */
export function runTraining(
  input: TrainingInput,
  onEpoch: (e: EpochStats) => void = () => {},
): TrainingOutput {
  const started = performance.now();
  return input.kind === 'classification'
    ? trainClassifier(input, onEpoch, started)
    : trainTagger(input, onEpoch, started);
}

function distribution(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function trainClassifier(
  input: TrainingInput,
  onEpoch: (e: EpochStats) => void,
  started: number,
): TrainingOutput {
  const { labels, params } = input;
  const index = new Map(labels.map((l, i) => [l, i]));
  const bits = params.hashBits;
  const random = rng(params.seed + 1);

  const all = input.train.filter((e) => e.label != null && index.has(e.label));
  const split =
    all.length >= MIN_FOR_VALIDATION
      ? stratifiedSplit(
          all.map((e) => e.label!),
          VAL_FRACTION,
          random,
        )
      : { held: [], rest: all.map((_, i) => i) };
  const fit = split.rest.map((i) => all[i]!);
  const val = split.held.map((i) => all[i]!);

  // IDF from the fitting set only: nothing about validation or test leaks into the features.
  const fitCounts = fit.map((e) => hashedCounts(e.text, bits));
  const idf = fitIdf(fitCounts, bits);
  const vec = (text: string): SparseVector => tfidf(hashedCounts(text, bits), idf);
  const xFit = fitCounts.map((c) => tfidf(c, idf));
  const yFit = fit.map((e) => index.get(e.label!)!);
  const xVal = val.map((e) => vec(e.text));
  const yVal = val.map((e) => index.get(e.label!)!);

  const trainer = softmaxTrainer(1 << bits, labels.length);
  const history: EpochStats[] = [];
  let best: { model: SoftmaxModel; epoch: number; loss: number } | null = null;
  for (let epoch = 1; epoch <= params.epochs; epoch++) {
    const t0 = performance.now();
    const trainLoss = trainer.epoch(xFit, yFit, random);
    let valLoss: number | null = null;
    let valAccuracy: number | null = null;
    let valF1: number | null = null;
    if (xVal.length) {
      valLoss = meanLoss(trainer.model, xVal, yVal);
      const s = classificationScores(
        labels,
        yVal.map((y) => labels[y]!),
        predictAll(trainer.model, xVal).map((y) => labels[y]!),
      );
      valAccuracy = s.accuracy;
      valF1 = s.macroF1;
    }
    const stats: EpochStats = {
      epoch,
      trainLoss,
      valLoss,
      valAccuracy,
      valF1,
      ms: Math.round(performance.now() - t0),
    };
    history.push(stats);
    onEpoch(stats);
    const score = valLoss ?? trainLoss;
    if (!best || score < best.loss)
      best = { model: cloneSoftmax(trainer.model), epoch, loss: score };
  }

  const model = best!.model;
  const testRef = input.test.map((e) => e.label!);
  const testPred = predictAll(
    model,
    input.test.map((e) => vec(e.text)),
  ).map((y) => labels[y]!);
  const scores = classificationScores(labels, testRef, testPred);

  const counts = distribution(fit.map((e) => e.label!));
  const majority = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const majorityAcc = majority
    ? testRef.filter((l) => l === majority).length / testRef.length
    : null;
  const taught = input.test.filter((e) => e.teacher?.label != null);
  const teacherAcc = taught.length
    ? taught.filter((e) => e.teacher!.label === e.label).length / taught.length
    : null;

  return {
    report: {
      kind: 'classification',
      params,
      data: {
        train: fit.length,
        test: input.test.length,
        labels,
        trainBySource: input.trainBySource,
        testDistribution: distribution(testRef),
      },
      history,
      bestEpoch: best!.epoch,
      test: {
        accuracy: scores.accuracy,
        macroF1: scores.macroF1,
        microF1: scores.accuracy,
        precision: null,
        recall: null,
        perLabel: scores.perLabel,
        confusion: scores.confusion,
      },
      baselines: {
        simple: { kind: 'majority', score: majorityAcc },
        teacher: { score: teacherAcc, n: taught.length },
      },
      durationMs: Math.round(performance.now() - started),
    },
    model: encodeModel(
      { kind: 'classification', labels, bits },
      { idf, weights: model.weights, bias: model.bias },
    ),
  };
}

/** Longest-match tagging with every entity string seen in training. */
function dictionaryBaseline(
  train: TrainingInput['train'],
  test: TrainingInput['test'],
  labels: string[],
): number | null {
  const lexicon = new Map<string, string>();
  for (const e of train) {
    const chars = Array.from(e.text);
    for (const s of e.spans ?? []) {
      const surface = chars.slice(s.start, s.end).join('');
      if (surface.trim()) lexicon.set(surface, s.label);
    }
  }
  const entries = [...lexicon.entries()].sort(
    (a, b) => Array.from(b[0]).length - Array.from(a[0]).length,
  );
  const pairs = test.map((e) => {
    const chars = Array.from(e.text);
    const taken = new Uint8Array(chars.length);
    const predicted: Span[] = [];
    for (const [surface, label] of entries) {
      const sc = Array.from(surface);
      for (let i = 0; i + sc.length <= chars.length; i++) {
        let match = true;
        for (let k = 0; k < sc.length && match; k++)
          if (chars[i + k] !== sc[k] || taken[i + k]) match = false;
        if (match) {
          predicted.push({ start: i, end: i + sc.length, label });
          taken.fill(1, i, i + sc.length);
        }
      }
    }
    return { predicted, reference: e.spans ?? [] };
  });
  return pairs.length ? nerScores(labels, pairs).f1 : null;
}

function trainTagger(
  input: TrainingInput,
  onEpoch: (e: EpochStats) => void,
  started: number,
): TrainingOutput {
  const { labels, params } = input;
  const tags = tagSet(labels);
  const bits = params.hashBits;
  const random = rng(params.seed + 1);

  const all = input.train.filter((e) => e.spans != null);
  const order = shuffle(
    all.map((_, i) => i),
    random,
  );
  const nVal =
    all.length >= MIN_FOR_VALIDATION ? Math.max(1, Math.round(all.length * VAL_FRACTION)) : 0;
  const val = order.slice(0, nVal).map((i) => all[i]!);
  const fit = order.slice(nVal).map((i) => all[i]!);

  const prep = (e: { text: string; spans: Span[] | null }) => {
    const chars = Array.from(e.text);
    return {
      feats: positionFeatures(chars, bits),
      gold: spansToTags(chars.length, e.spans ?? [], labels),
      spans: e.spans ?? [],
    };
  };
  const dFit = fit.map(prep);
  const dVal = val.map(prep);

  const evaluate = (model: TaggerModel, data: ReturnType<typeof prep>[]) => {
    let right = 0;
    let total = 0;
    const pairs = data.map((d) => {
      const pred = viterbi(model, d.feats);
      for (let i = 0; i < pred.length; i++) {
        if (pred[i] === d.gold[i]) right++;
        total++;
      }
      return { predicted: tagsToSpans(pred, labels), reference: d.spans };
    });
    return { tokenAccuracy: total ? right / total : null, scores: nerScores(labels, pairs) };
  };

  const trainer = taggerTrainer(bits, tags.length);
  const history: EpochStats[] = [];
  let best: { model: TaggerModel; epoch: number; f1: number } | null = null;
  for (let epoch = 1; epoch <= params.epochs; epoch++) {
    const t0 = performance.now();
    const errorRate = trainer.epoch(dFit, random);
    const averaged = trainer.averaged();
    let valAccuracy: number | null = null;
    let valF1: number | null = null;
    if (dVal.length) {
      const r = evaluate(averaged, dVal);
      valAccuracy = r.tokenAccuracy;
      valF1 = r.scores.f1 ?? 0;
    }
    const stats: EpochStats = {
      epoch,
      trainLoss: errorRate, // token error rate: the perceptron has no likelihood
      valLoss: null,
      valAccuracy,
      valF1,
      ms: Math.round(performance.now() - t0),
    };
    history.push(stats);
    onEpoch(stats);
    const score = valF1 ?? 1 - errorRate;
    if (!best || score > best.f1) best = { model: averaged, epoch, f1: score };
  }

  const model = best!.model;
  const dTest = input.test.map((e) => prep(e));
  const testEval = evaluate(model, dTest);
  const taught = input.test.filter((e) => e.teacher?.spans != null);
  const teacher = taught.length
    ? nerScores(
        labels,
        taught.map((e) => ({ predicted: e.teacher!.spans!, reference: e.spans ?? [] })),
      ).f1
    : null;

  return {
    report: {
      kind: 'ner',
      params,
      data: {
        train: fit.length,
        test: input.test.length,
        labels,
        trainBySource: input.trainBySource,
        testDistribution: distribution(
          input.test.flatMap((e) => (e.spans ?? []).map((s) => s.label)),
        ),
      },
      history,
      bestEpoch: best!.epoch,
      test: {
        accuracy: testEval.tokenAccuracy,
        macroF1: testEval.scores.macroF1,
        microF1: testEval.scores.f1,
        precision: testEval.scores.precision,
        recall: testEval.scores.recall,
        perLabel: testEval.scores.perLabel,
        confusion: null,
      },
      baselines: {
        simple: { kind: 'dictionary', score: dictionaryBaseline(fit, input.test, labels) },
        teacher: { score: teacher, n: taught.length },
      },
      durationMs: Math.round(performance.now() - started),
    },
    model: encodeModel(
      { kind: 'ner', labels, bits, tags: tags.length },
      { emission: model.emission, transition: model.transition },
    ),
  };
}
