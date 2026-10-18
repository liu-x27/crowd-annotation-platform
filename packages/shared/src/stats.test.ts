import { describe, expect, it } from 'vitest';
import {
  altTest,
  benjaminiYekutieli,
  classicalMean,
  normalQuantile,
  ppiMean,
  studentTCdf,
  tTestLess,
  wilsonInterval,
} from './stats';
import reference from './stats.reference.json';

/**
 * Every expected value comes from stats.reference.json, which
 * scripts/stats_reference.py writes with scipy, statsmodels and ppi_py.
 */
const close = (actual: number, expected: number, digits = 12) =>
  expect(actual).toBeCloseTo(expected, digits);

describe('distributions, against scipy', () => {
  it('normal quantile', () => {
    for (const [p, z] of reference.normalQuantile) close(normalQuantile(p!), z!, 11);
  });

  it('Student t CDF', () => {
    for (const [t, df, cdf] of reference.studentTCdf) close(studentTCdf(t!, df!), cdf!, 12);
  });

  it('one-sided one-sample t-test', () => {
    for (const { xs, mu, p } of reference.tTestLess) {
      const actual = tTestLess(xs, mu);
      if (p == null) expect(actual).toBeNaN();
      else close(actual, p, 12);
    }
  });
});

describe('intervals and corrections, against statsmodels', () => {
  it('Wilson interval', () => {
    for (const [k, n, low, high] of reference.wilson) {
      const i = wilsonInterval(k!, n!);
      close(i.low, low!);
      close(i.high, high!);
    }
  });

  it('Benjamini–Yekutieli', () => {
    for (const { p, q, rejected } of reference.benjaminiYekutieli)
      expect(benjaminiYekutieli(p, q).sort((a, b) => a - b)).toEqual(rejected);
  });
});

describe('alternative annotator test, against an independent implementation', () => {
  it('matches per annotator and overall', () => {
    for (const { model, humans, epsilon, result } of reference.altTest) {
      const actual = altTest(
        new Map(Object.entries(model)),
        new Map(Object.entries(humans).map(([h, a]) => [h, new Map(Object.entries(a))])),
        { epsilon },
      );
      expect(actual.skipped).toEqual(result.skipped);
      expect(actual.annotators.map((a) => a.annotator)).toEqual(
        result.annotators.map((a) => a.annotator),
      );
      actual.annotators.forEach((a, k) => {
        const r = result.annotators[k]!;
        expect(a.instances).toBe(r.instances);
        close(a.modelAdvantage, r.modelAdvantage);
        close(a.annotatorAdvantage, r.annotatorAdvantage);
        if (r.pValue == null) expect(a.pValue).toBeNaN();
        else close(a.pValue, r.pValue, 12);
        expect(a.modelWins).toBe(r.modelWins);
      });
      expect(actual.winningRate).toBe(result.winningRate);
      if (result.advantageProbability == null) expect(actual.advantageProbability).toBeNull();
      else close(actual.advantageProbability!, result.advantageProbability);
      expect(actual.passed).toBe(result.passed);
    }
  });
});

describe('PPI++ mean, against ppi_py', () => {
  it('matches the estimate, the interval and λ', () => {
    for (const c of reference.ppiMean) {
      const actual = ppiMean(c.labels, c.predicted, c.unlabeledPredicted);
      close(actual.estimate, c.ppi.estimate);
      close(actual.low, c.ppi.low);
      close(actual.high, c.ppi.high);
      close(actual.lambda, c.ppi.lambda);
      const classical = classicalMean(c.labels);
      close(classical.estimate, c.classical.estimate);
      close(classical.low, c.classical.low);
      close(classical.high, c.classical.high);
    }
  });

  it('falls back to the labelled items when the predictions say nothing', () => {
    const labels = [1, 0, 1, 1, 0, 1];
    const constant = ppiMean(labels, [1, 1, 1, 1, 1, 1], [1, 1, 1]);
    expect(constant.lambda).toBe(0);
    expect(constant.estimate).toBe(classicalMean(labels).estimate);
  });
});
