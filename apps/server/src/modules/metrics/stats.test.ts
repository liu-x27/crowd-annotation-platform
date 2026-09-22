import { describe, expect, it } from 'vitest';
import {
  classificationScores,
  cohenKappa,
  krippendorffAlphaNominal,
  nerScores,
  spanAgreement,
} from './stats';

describe('krippendorffAlphaNominal', () => {
  it('matches a hand-computed two-rater case', () => {
    // Coincidences: aa=2, ab=ba=1, bb=4 → n_a=3, n_b=5, n=8
    // alpha = 1 - (n-1)·D_o / D_e = 1 - 7·2 / 30
    const alpha = krippendorffAlphaNominal([
      ['a', 'a'],
      ['a', 'b'],
      ['b', 'b'],
      ['b', 'b'],
    ]);
    expect(alpha).toBeCloseTo(1 - 14 / 30, 10);
  });

  it('is 1 for perfect agreement and ignores single-rated units', () => {
    expect(krippendorffAlphaNominal([['x', 'x'], ['y', 'y', 'y'], ['z']])).toBe(1);
  });

  it('is undefined when only one category is ever used', () => {
    expect(
      krippendorffAlphaNominal([
        ['x', 'x'],
        ['x', 'x'],
      ]),
    ).toBeNull();
  });

  it('reproduces the nominal value of Krippendorff’s textbook reliability example', () => {
    // Four observers, twelve units, missing ratings (Krippendorff 2011, "Computing
    // Krippendorff's alpha-reliability", section C). Published nominal alpha: 0.743.
    const data = [
      [1, 1, null, 1],
      [2, 2, 3, 2],
      [3, 3, 3, 3],
      [3, 3, 3, 3],
      [2, 2, 2, 2],
      [1, 2, 3, 4],
      [4, 4, 4, 4],
      [1, 1, 2, 1],
      [2, 2, 2, 2],
      [null, 5, 5, 5],
      [null, null, 1, 1],
      [null, null, 3, null],
    ];
    const units = data.map((row) => row.filter((v): v is number => v != null).map(String));
    expect(krippendorffAlphaNominal(units)).toBeCloseTo(0.743, 3);
  });
});

describe('cohenKappa', () => {
  it('matches a hand-computed value', () => {
    // po = 0.75; rater A: a .5 b .5; rater B: a .25 b .75 → pe = .5 → kappa = .5
    expect(cohenKappa(['a', 'a', 'b', 'b'], ['a', 'b', 'b', 'b'])).toBeCloseTo(0.5, 10);
  });
});

describe('classificationScores', () => {
  it('builds a confusion matrix with reference rows and per-label scores', () => {
    const s = classificationScores(
      ['pos', 'neg'],
      ['pos', 'pos', 'neg', 'neg'],
      ['pos', 'neg', 'neg', 'neg'],
    );
    expect(s.accuracy).toBe(0.75);
    expect(s.confusion.matrix).toEqual([
      [1, 1],
      [0, 2],
    ]);
    const pos = s.perLabel.find((p) => p.label === 'pos')!;
    expect(pos.precision).toBe(1);
    expect(pos.recall).toBe(0.5);
  });
});

describe('span metrics', () => {
  const a = [
    { start: 0, end: 2, label: 'PER' },
    { start: 3, end: 5, label: 'LOC' },
  ];
  const b = [
    { start: 0, end: 2, label: 'PER' },
    { start: 3, end: 5, label: 'ORG' },
  ];

  it('scores exact matches only', () => {
    const s = nerScores(['PER', 'LOC', 'ORG'], [{ predicted: a, reference: b }]);
    expect(s.precision).toBe(0.5);
    expect(s.recall).toBe(0.5);
    expect(s.perLabel.find((p) => p.label === 'PER')!.f1).toBe(1);
  });

  it('treats two empty annotations as agreement', () => {
    expect(spanAgreement([], [])).toBe(1);
    expect(spanAgreement(a, b)).toBe(0.5);
  });
});
