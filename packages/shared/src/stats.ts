/**
 * The statistics behind the calibration report, in plain TypeScript: the normal and
 * Student t distributions, Wilson's interval, the alternative annotator test, and
 * prediction-powered inference for a mean. Each follows a reference implementation, named
 * where it is defined; stats.test.ts holds them to numbers those references produced.
 */

// ── Distributions ────────────────────────────────────────────────────────────────────

/** The standard normal quantile: Wichura's algorithm AS 241 (PPND16), about 1e-16 relative. */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) {
    if (p === 0) return Number.NEGATIVE_INFINITY;
    if (p === 1) return Number.POSITIVE_INFINITY;
    return Number.NaN;
  }
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return (
      (q *
        (((((((2509.0809287301227 * r + 33430.57558358813) * r + 67265.7709270087) * r +
          45921.95393154987) *
          r +
          13731.69376550946) *
          r +
          1971.5909503065513) *
          r +
          133.14166789178438) *
          r +
          3.3871328727963665)) /
      (((((((5226.495278852546 * r + 28729.085735721943) * r + 39307.89580009271) * r +
        21213.794301586597) *
        r +
        5394.196021424751) *
        r +
        687.1870074920579) *
        r +
        42.31333070160091) *
        r +
        1)
    );
  }
  let r = Math.sqrt(-Math.log(q < 0 ? p : 1 - p));
  let value: number;
  if (r <= 5) {
    r -= 1.6;
    value =
      (((((((0.0007745450142783414 * r + 0.022723844989269184) * r + 0.2417807251774506) * r +
        1.2704582524523684) *
        r +
        3.6478483247632045) *
        r +
        5.769497221460691) *
        r +
        4.630337846156546) *
        r +
        1.4234371107496835) /
      (((((((1.0507500716444169e-9 * r + 0.0005475938084995345) * r + 0.015198666563616457) * r +
        0.14810397642748008) *
        r +
        0.6897673349851) *
        r +
        1.6763848301838038) *
        r +
        2.053191626637759) *
        r +
        1);
  } else {
    r -= 5;
    value =
      (((((((2.0103343992922881e-7 * r + 0.000027115555687434876) * r + 0.0012426609473880784) * r +
        0.026532189526576124) *
        r +
        0.29656057182850487) *
        r +
        1.7848265399172913) *
        r +
        5.463784911164114) *
        r +
        6.657904643501103) /
      (((((((2.0442631033899397e-15 * r + 1.421511758316446e-7) * r + 0.000018463183175100548) * r +
        0.0007868691311456133) *
        r +
        0.014875361290850615) *
        r +
        0.1369298809227358) *
        r +
        0.599832206555888) *
        r +
        1);
  }
  return q < 0 ? -value : value;
}

const LANCZOS = [
  0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
  12.507343278686905, -0.13857109526572012, 0.000009984369578019572, 1.5056327351493116e-7,
];

/** ln Γ(x) for x > 0, by the Lanczos approximation (g = 7). */
export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = LANCZOS[0]!;
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i]! / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta function (modified Lentz). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const step = d * c;
    h *= step;
    if (Math.abs(step - 1) < 1e-15) break;
  }
  return h;
}

/** The regularized incomplete beta function I_x(a, b). */
export function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** P(T ≤ t) for Student's t with `df` degrees of freedom. */
export function studentTCdf(t: number, df: number): number {
  if (Number.isNaN(t)) return Number.NaN;
  if (t === Number.POSITIVE_INFINITY) return 1;
  if (t === Number.NEGATIVE_INFINITY) return 0;
  const tail = 0.5 * regularizedBeta(df / (df + t * t), df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

// ── Summaries ────────────────────────────────────────────────────────────────────────

export const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Standard deviation with `ddof` degrees of freedom removed (numpy's convention). */
export function std(xs: readonly number[], ddof = 0): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - ddof));
}

export interface Interval {
  estimate: number;
  low: number;
  high: number;
}

/**
 * Wilson's score interval for a proportion, as statsmodels' `proportion_confint(…,
 * method='wilson')`. Keeps to [0, 1] and stays sensible at 0 and n successes.
 */
export function wilsonInterval(successes: number, n: number, alpha = 0.05): Interval {
  if (n === 0) return { estimate: Number.NaN, low: Number.NaN, high: Number.NaN };
  const z = normalQuantile(1 - alpha / 2);
  const p = successes / n;
  const z2n = (z * z) / n;
  const center = (p + z2n / 2) / (1 + z2n);
  const half = (z / (1 + z2n)) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { estimate: p, low: center - half, high: center + half };
}

/**
 * One-sample t-test of "the mean is below `mu`", as scipy's `ttest_1samp(xs, mu,
 * alternative='less')`. Constant samples give t = ±∞ (p 0 or 1), or NaN when they sit on mu.
 */
export function tTestLess(xs: readonly number[], mu: number): number {
  const n = xs.length;
  if (n < 2) return Number.NaN;
  const se = std(xs, 1) / Math.sqrt(n);
  const t = (mean(xs) - mu) / se;
  return studentTCdf(t, n - 1);
}

/**
 * Benjamini–Yekutieli: which hypotheses to reject so that the false discovery rate stays
 * under q under any dependence. Returns indices into `pValues`; NaN is never rejected.
 * The step-up rule as the alt-test authors' `by_procedure`.
 */
export function benjaminiYekutieli(pValues: readonly number[], q: number): number[] {
  const m = pValues.length;
  if (m === 0) return [];
  const order = pValues
    .map((p, i) => [p, i] as const)
    .sort((x, y) => (Number.isNaN(x[0]) ? 1 : Number.isNaN(y[0]) ? -1 : x[0] - y[0]))
    .map(([, i]) => i);
  let harmonic = 0;
  for (let k = 1; k <= m; k++) harmonic += 1 / k;
  let last = -1;
  for (let k = 0; k < m; k++) {
    if (pValues[order[k]!]! <= ((k + 1) / m) * (q / harmonic)) last = k;
  }
  return order.slice(0, last + 1);
}

// ── The alternative annotator test ───────────────────────────────────────────────────

export interface AltTestAnnotator<H> {
  annotator: H;
  /** Items this annotator answered that count: enough other answers and a model label. */
  instances: number;
  /** ρ^f_j: how often the model aligns with the others at least as well as this annotator. */
  modelAdvantage: number;
  /** ρ^h_j: the same, for the annotator. */
  annotatorAdvantage: number;
  pValue: number;
  /** H0 "the model is worse than this annotator by more than ε" rejected, after BY. */
  modelWins: boolean;
}

export interface AltTestResult<H> {
  epsilon: number;
  q: number;
  annotators: AltTestAnnotator<H>[];
  /** Annotators left out for answering fewer than `minInstancesPerAnnotator` items. */
  skipped: { annotator: H; instances: number }[];
  /** ω: the share of annotators the model beats. Null when no annotator qualified. */
  winningRate: number | null;
  /** ρ: mean of ρ^f_j over the annotators. */
  advantageProbability: number | null;
  /** ω ≥ 0.5. */
  passed: boolean;
}

/**
 * The alternative annotator test (Calderon, Reichart & Dror, ACL 2025, arXiv:2501.1097):
 * may the model's labels stand in for these annotators'? Leave each annotator out in turn
 * and, item by item, ask whether the model or the left-out annotator agrees more with the
 * rest (accuracy against them; a tie is a win for both). Per annotator, test "the model's
 * advantage is no worse than the annotator's minus ε" with a one-sided t-test, correct the
 * p-values with Benjamini–Yekutieli, and pass the model if it wins against at least half
 * the annotators. A transcription of the authors' `alt_test` (alt_test_example.ipynb in
 * github.com/nitaytech/AltTest), including its defaults and its order of annotators.
 */
export function altTest<H, I>(
  model: ReadonlyMap<I, string>,
  annotations: ReadonlyMap<H, ReadonlyMap<I, string>>,
  opts: {
    epsilon: number;
    q?: number;
    minAnnotatorsPerInstance?: number;
    minInstancesPerAnnotator?: number;
  },
): AltTestResult<H> {
  const q = opts.q ?? 0.05;
  const minAnnotators = opts.minAnnotatorsPerInstance ?? 2;
  const minInstances = opts.minInstancesPerAnnotator ?? 30;

  const byInstance = new Map<I, H[]>();
  for (const [h, answers] of annotations) {
    for (const i of answers.keys()) byInstance.set(i, [...(byInstance.get(i) ?? []), h]);
  }
  const kept = new Set(
    [...byInstance].filter(([i, hs]) => hs.length >= minAnnotators && model.has(i)).map(([i]) => i),
  );

  const accuracy = (label: string, others: string[]) =>
    others.filter((o) => o === label).length / others.length;

  const rows: Omit<AltTestAnnotator<H>, 'modelWins'>[] = [];
  const skipped: AltTestResult<H>['skipped'] = [];
  for (const [h, answers] of annotations) {
    const instances = [...answers.keys()].filter((i) => kept.has(i));
    if (instances.length < minInstances) {
      skipped.push({ annotator: h, instances: instances.length });
      continue;
    }
    const modelWins: number[] = [];
    const annotatorWins: number[] = [];
    for (const i of instances) {
      const others = byInstance
        .get(i)!
        .filter((o) => o !== h)
        .map((o) => annotations.get(o)!.get(i)!);
      const annotatorScore = accuracy(answers.get(i)!, others);
      const modelScore = accuracy(model.get(i)!, others);
      modelWins.push(modelScore >= annotatorScore ? 1 : 0);
      annotatorWins.push(annotatorScore >= modelScore ? 1 : 0);
    }
    rows.push({
      annotator: h,
      instances: instances.length,
      modelAdvantage: mean(modelWins),
      annotatorAdvantage: mean(annotatorWins),
      pValue: tTestLess(
        annotatorWins.map((w, k) => w - modelWins[k]!),
        opts.epsilon,
      ),
    });
  }

  const rejected = new Set(
    benjaminiYekutieli(
      rows.map((r) => r.pValue),
      q,
    ),
  );
  const annotators = rows.map((r, k) => ({ ...r, modelWins: rejected.has(k) }));
  const winningRate = annotators.length ? rejected.size / annotators.length : null;
  return {
    epsilon: opts.epsilon,
    q,
    annotators,
    skipped,
    winningRate,
    advantageProbability: annotators.length ? mean(annotators.map((a) => a.modelAdvantage)) : null,
    passed: winningRate != null && winningRate >= 0.5,
  };
}

// ── Prediction-powered inference ─────────────────────────────────────────────────────

export interface PpiInterval extends Interval {
  /** The weight on the predictions: 0 ignores them, 1 is plain PPI. */
  lambda: number;
}

/**
 * A mean from a few labelled items and many predicted ones, with a confidence interval:
 * PPI++ with power tuning (Angelopoulos, Duchi & Zrnic, arXiv:2311.01453). `labels[i]` and
 * `predicted[i]` belong to the same labelled item; `unlabeledPredicted` are predictions
 * for the rest. The labelled items must be a uniform random sample of the whole.
 *
 * A transcription of ppi_py 0.2.3's one-dimensional `ppi_mean_ci` with `lam=None`: λ from
 * the gradients at the λ = 1 estimate, clipped to [0, 1]; standard errors with ddof 0; a
 * normal interval. One difference: when every prediction is the same, ppi_py's λ is 0/0;
 * here the predictions carry no information and λ is 0, the classical estimate.
 */
export function ppiMean(
  labels: readonly number[],
  predicted: readonly number[],
  unlabeledPredicted: readonly number[],
  opts: { alpha?: number; lambda?: number } = {},
): PpiInterval {
  const n = labels.length;
  const N = unlabeledPredicted.length;
  const z = normalQuantile(1 - (opts.alpha ?? 0.05) / 2);
  const at = (lambda: number) =>
    mean(unlabeledPredicted.map((p) => lambda * p)) +
    mean(labels.map((y, i) => y - lambda * predicted[i]!));

  let lambda = opts.lambda;
  if (lambda == null) {
    const theta = at(1);
    const grads = labels.map((y) => y - theta);
    const gradsHat = predicted.map((p) => p - theta);
    const g = mean(grads);
    const gh = mean(gradsHat);
    const cov = (2 / n) * grads.reduce((s, x, i) => s + (x - g) * (gradsHat[i]! - gh), 0);
    const all = [...gradsHat, ...unlabeledPredicted.map((p) => p - theta)];
    const variance = std(all, 1) ** 2;
    const tuned = cov / (2 * (1 + n / N) * variance);
    lambda = variance > 0 ? Math.min(1, Math.max(0, tuned)) : 0;
  }
  const estimate = at(lambda);
  const imputed = std(unlabeledPredicted.map((p) => lambda * p)) / Math.sqrt(N);
  const rectifier = std(labels.map((y, i) => y - lambda * predicted[i]!)) / Math.sqrt(n);
  const se = Math.sqrt(imputed ** 2 + rectifier ** 2);
  return { estimate, low: estimate - z * se, high: estimate + z * se, lambda };
}

/** The same mean from the labelled items alone, as ppi_py's `classical_mean_ci`. */
export function classicalMean(labels: readonly number[], opts: { alpha?: number } = {}): Interval {
  const z = normalQuantile(1 - (opts.alpha ?? 0.05) / 2);
  const estimate = mean(labels);
  const se = std(labels) / Math.sqrt(labels.length);
  return { estimate, low: estimate - z * se, high: estimate + z * se };
}
