import { describe, expect, it } from 'vitest';
import {
  computeCcmeWqi,
  DEFAULT_OBJECTIVES,
  excursion,
  type Measurement,
  type Objective,
} from './ccme';

const objective = (over: Partial<Objective> = {}): Objective => ({
  parameter: 'nitrateMgl',
  label: 'Nitrate',
  unit: 'mg/L',
  direction: 'max',
  value: 25,
  provenance: { kind: 'modelled', source: 'test', ref: 'test' },
  ...over,
});

describe('excursion', () => {
  it('returns zero for a passing value', () => {
    expect(excursion(10, objective())).toBe(0);
    expect(excursion(25, objective())).toBe(0);
  });

  it('measures proportional overshoot for max-direction guidelines', () => {
    expect(excursion(50, objective())).toBeCloseTo(1, 10);
    expect(excursion(75, objective())).toBeCloseTo(2, 10);
  });

  it('measures proportional shortfall for min-direction guidelines', () => {
    const o = objective({ parameter: 'do', direction: 'min', value: 6 });
    expect(excursion(6, o)).toBe(0);
    expect(excursion(3, o)).toBeCloseTo(1, 10);
  });

  it('treats an anoxic reading as a bounded total failure, not infinity', () => {
    const o = objective({ parameter: 'do', direction: 'min', value: 6 });
    const e = excursion(0, o);
    expect(Number.isFinite(e)).toBe(true);
    expect(e).toBe(100);
  });

  it('penalises both ends of a range guideline', () => {
    const o = objective({ parameter: 'ph', direction: 'range', value: 6, upper: 9 });
    expect(excursion(7, o)).toBe(0);
    expect(excursion(4, o)).toBeGreaterThan(0);
    expect(excursion(12, o)).toBeGreaterThan(0);
  });

  it('caps a single excursion so one bad reading cannot zero the index', () => {
    // A decimal-slip transcription: 14.0 NTU entered as 14000.
    const o = objective({ parameter: 'turbidityNtu', value: 25 });
    expect(excursion(14000, o)).toBe(100);
  });
});

describe('computeCcmeWqi', () => {
  const objectives = DEFAULT_OBJECTIVES;

  it('scores fully compliant water at 100', () => {
    const measurements: Measurement[] = [
      { parameter: 'dissolvedOxygenMgl', value: 9.5 },
      { parameter: 'ph', value: 7.4 },
      { parameter: 'nitrateMgl', value: 3 },
      { parameter: 'phosphateMgl', value: 0.05 },
      { parameter: 'turbidityNtu', value: 4 },
    ];
    expect(computeCcmeWqi(measurements, objectives).wqi).toBe(100);
  });

  it('returns zero for an empty window rather than a spurious perfect score', () => {
    // The failure this guards against is the worst one available to the product:
    // an unmonitored stream rendering as pristine on a public map.
    const result = computeCcmeWqi([], objectives);
    expect(result.wqi).toBe(0);
    expect(result.testsTotal).toBe(0);
  });

  it('ignores parameters that have no guideline, rather than passing them', () => {
    const result = computeCcmeWqi([{ parameter: 'unguidedThing', value: 999 }], objectives);
    expect(result.parametersTested).toBe(0);
    expect(result.wqi).toBe(0);
  });

  it('computes F1, F2 and F3 consistently with the manual', () => {
    const measurements: Measurement[] = [
      { parameter: 'nitrateMgl', value: 50 }, // fails: excursion 1.0
      { parameter: 'nitrateMgl', value: 10 }, // passes
      { parameter: 'ph', value: 7.0 }, // passes
      { parameter: 'turbidityNtu', value: 5 }, // passes
    ];
    const r = computeCcmeWqi(measurements, objectives);

    expect(r.parametersTested).toBe(3);
    expect(r.parametersFailed).toBe(1);
    expect(r.testsTotal).toBe(4);
    expect(r.testsFailed).toBe(1);

    expect(r.f1Scope).toBeCloseTo((1 / 3) * 100, 6);
    expect(r.f2Frequency).toBeCloseTo((1 / 4) * 100, 6);

    // nse = sum(excursions) / testsTotal = 1.0 / 4 = 0.25
    // F3  = nse / (0.01 * nse + 0.01)
    const nse = 0.25;
    expect(r.f3Amplitude).toBeCloseTo(nse / (0.01 * nse + 0.01), 6);

    const expected =
      100 - Math.sqrt(r.f1Scope ** 2 + r.f2Frequency ** 2 + r.f3Amplitude ** 2) / 1.732;
    expect(r.wqi).toBeCloseTo(expected, 6);
  });

  it('degrades monotonically as contamination worsens', () => {
    const at = (nitrate: number) =>
      computeCcmeWqi(
        [
          { parameter: 'nitrateMgl', value: nitrate },
          { parameter: 'ph', value: 7.2 },
          { parameter: 'dissolvedOxygenMgl', value: 8 },
        ],
        objectives,
      ).wqi;

    expect(at(10)).toBeGreaterThan(at(30));
    expect(at(30)).toBeGreaterThan(at(60));
    expect(at(60)).toBeGreaterThan(at(200));
  });

  it('ranks failures by severity for the score decomposition', () => {
    const r = computeCcmeWqi(
      [
        { parameter: 'nitrateMgl', value: 30 }, // mild
        { parameter: 'phosphateMgl', value: 8 }, // severe
      ],
      objectives,
    );
    expect(r.failures[0]?.parameter).toBe('phosphateMgl');
    expect(r.failures[0]!.meanExcursion).toBeGreaterThan(r.failures[1]!.meanExcursion);
  });

  it('flags windows carrying fewer parameters than the manual recommends', () => {
    const sparse = computeCcmeWqi([{ parameter: 'ph', value: 7 }], objectives);
    expect(sparse.belowRecommendedParameterCount).toBe(true);
  });

  it('never produces a score outside 0..100 under extreme input', () => {
    const r = computeCcmeWqi(
      [
        { parameter: 'nitrateMgl', value: 1e6 },
        { parameter: 'phosphateMgl', value: 1e6 },
        { parameter: 'dissolvedOxygenMgl', value: 0 },
      ],
      objectives,
    );
    expect(r.wqi).toBeGreaterThanOrEqual(0);
    expect(r.wqi).toBeLessThanOrEqual(100);
  });
});
