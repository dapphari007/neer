import { describe, expect, it } from 'vitest';
import {
  aggregateSohi,
  classifySohi,
  computeSohi,
  SUB_INDEX_WEIGHTS,
  type SohiInputs,
} from './sohi';
import type { ExposureInputs } from './exposure';
import type { PressureInputs } from './pressure';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const cleanExposure = (over: Partial<ExposureInputs> = {}): ExposureInputs => ({
  combinedSewer: false,
  recreationalAccess: false,
  nearestContactM: 5000,
  populationWithin1km: 500,
  imperviousPct: 10,
  outfallCount: 0,
  sewageOdourRate: 0,
  visibleDischargeRate: 0,
  turbidityNtu: 3,
  algaeCoverPct: 0,
  scumPresent: false,
  phosphateMgl: 0.05,
  waterTempC: 11,
  dissolvedOxygenMgl: 10,
  stagnantFraction: 0,
  litterScore: 0,
  precip48hMm: 0,
  dryDaysBefore: 2,
  consecutiveHotDays: 0,
  ...over,
});

const cleanPressure = (over: Partial<PressureInputs> = {}): PressureInputs => ({
  litterScore: 0,
  foamRate: 0,
  surfaceFilmRate: 0,
  visibleDischargeRate: 0,
  qbr: null,
  riparianScore: 3,
  imperviousPct: 10,
  outfallCount: 0,
  invasivePlantsPresent: false,
  ...over,
});

const baseInputs = (over: Partial<SohiInputs> = {}): SohiInputs => ({
  siteId: 'test-site',
  day: '2026-06-15',
  ecological: {
    measurements: [
      { parameter: 'dissolvedOxygenMgl', value: 10 },
      { parameter: 'ph', value: 7.4 },
      { parameter: 'nitrateMgl', value: 2 },
      { parameter: 'phosphateMgl', value: 0.05 },
      { parameter: 'turbidityNtu', value: 3 },
    ],
    taxaGroups: ['stonefly', 'flat_bodied_mayfly', 'cased_caddisfly', 'freshwater_shrimp'],
    taxaAbundance: [2, 2, 2, 2],
  },
  pressure: cleanPressure(),
  exposure: cleanExposure(),
  confidence: {
    parametersPresent: 5,
    parametersExpected: 5,
    nObs: 4,
    nObservers: 2,
    daysSinceLastObs: 1,
    observerExperience: ['trained', 'expert'],
    measurementCv: 0.05,
    hasBiology: true,
  },
  ...over,
});

// ─── Aggregation ──────────────────────────────────────────────────────────────

describe('aggregateSohi', () => {
  it('returns the common value when all sub-indices agree', () => {
    expect(aggregateSohi({ ecological: 70, pressure: 70, exposure: 70 })).toBeCloseTo(70, 6);
  });

  /**
   * The central design claim of the whole model.
   *
   * A stream with healthy ecology and low pressure but an active sewage
   * discharge must NOT be reported as "Good". An arithmetic mean does exactly
   * that, and publishing it about water people paddle in is the failure mode
   * this index exists to prevent.
   */
  it('does not let healthy sub-indices mask a catastrophic one', () => {
    const scores = { ecological: 85, pressure: 80, exposure: 10 };

    const arithmetic =
      scores.ecological * SUB_INDEX_WEIGHTS.ecological +
      scores.pressure * SUB_INDEX_WEIGHTS.pressure +
      scores.exposure * SUB_INDEX_WEIGHTS.exposure;
    const geometric = aggregateSohi(scores);

    // The arithmetic mean would call this "Good"...
    expect(classifySohi(arithmetic)).toBe('good');
    // ...and the geometric mean refuses to.
    expect(geometric).toBeLessThan(arithmetic);
    expect(classifySohi(geometric)).not.toBe('good');
    expect(classifySohi(geometric)).not.toBe('high');
  });

  it('is monotonic in every sub-index', () => {
    const base = aggregateSohi({ ecological: 50, pressure: 50, exposure: 50 });
    expect(aggregateSohi({ ecological: 60, pressure: 50, exposure: 50 })).toBeGreaterThan(base);
    expect(aggregateSohi({ ecological: 50, pressure: 60, exposure: 50 })).toBeGreaterThan(base);
    expect(aggregateSohi({ ecological: 50, pressure: 50, exposure: 60 })).toBeGreaterThan(base);
  });

  it('weights ecology above exposure, and exposure above pressure', () => {
    const drop = (key: 'ecological' | 'pressure' | 'exposure') => {
      const scores = { ecological: 80, pressure: 80, exposure: 80 };
      scores[key] = 40;
      return aggregateSohi(scores);
    };
    // A bigger weight means a bigger penalty, so a lower resulting score.
    expect(drop('ecological')).toBeLessThan(drop('exposure'));
    expect(drop('exposure')).toBeLessThan(drop('pressure'));
  });

  it('stays finite and bounded when a sub-index is zero', () => {
    const result = aggregateSohi({ ecological: 0, pressure: 0, exposure: 0 });
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('clamps to 0..100 for out-of-range input', () => {
    expect(aggregateSohi({ ecological: 150, pressure: 150, exposure: 150 })).toBeLessThanOrEqual(
      100,
    );
    expect(aggregateSohi({ ecological: -50, pressure: -50, exposure: -50 })).toBeGreaterThanOrEqual(
      0,
    );
  });
});

describe('classifySohi', () => {
  it('maps scores onto the five WFD-aligned classes at the stated boundaries', () => {
    expect(classifySohi(100)).toBe('high');
    expect(classifySohi(80)).toBe('high');
    expect(classifySohi(79.9)).toBe('good');
    expect(classifySohi(60)).toBe('good');
    expect(classifySohi(59.9)).toBe('moderate');
    expect(classifySohi(40)).toBe('moderate');
    expect(classifySohi(39.9)).toBe('poor');
    expect(classifySohi(20)).toBe('poor');
    expect(classifySohi(19.9)).toBe('bad');
    expect(classifySohi(0)).toBe('bad');
  });
});

// ─── End-to-end ───────────────────────────────────────────────────────────────

describe('computeSohi', () => {
  it('scores a clean, well-surveyed headwater highly and with tight uncertainty', () => {
    const r = computeSohi(baseInputs());
    expect(r.sohi).toBeGreaterThan(70);
    expect(r.status === 'good' || r.status === 'high').toBe(true);
    expect(r.confidence.overall).toBeGreaterThan(0.7);
    expect(r.sohiHigh - r.sohiLow).toBeLessThan(20);
  });

  it('scores a degraded urban reach poorly and names the limiting dimension', () => {
    const r = computeSohi(
      baseInputs({
        ecological: {
          measurements: [
            { parameter: 'dissolvedOxygenMgl', value: 3.1 },
            { parameter: 'ph', value: 7.9 },
            { parameter: 'nitrateMgl', value: 48 },
            { parameter: 'phosphateMgl', value: 2.4 },
            { parameter: 'turbidityNtu', value: 90 },
          ],
          taxaGroups: ['worm_oligochaeta', 'bloodworm_chironomid', 'leech'],
          taxaAbundance: [4, 4, 2],
        },
        pressure: cleanPressure({
          litterScore: 3,
          foamRate: 0.6,
          riparianScore: 0,
          imperviousPct: 85,
          outfallCount: 4,
          invasivePlantsPresent: true,
        }),
        exposure: cleanExposure({
          combinedSewer: true,
          recreationalAccess: true,
          nearestContactM: 150,
          populationWithin1km: 9000,
          imperviousPct: 85,
          outfallCount: 4,
          sewageOdourRate: 0.5,
          turbidityNtu: 90,
          waterTempC: 24,
          dissolvedOxygenMgl: 3.1,
          litterScore: 3,
          precip48hMm: 35,
          dryDaysBefore: 12,
        }),
      }),
    );

    expect(r.sohi).toBeLessThan(40);
    expect(['poor', 'bad']).toContain(r.status);
    expect(r.drivers.length).toBeGreaterThan(3);
    // Drivers are sorted worst-first so the UI can render the top offenders.
    expect(r.drivers[0]!.contribution).toBeLessThanOrEqual(r.drivers[1]!.contribution);
  });

  /**
   * Uncertainty must be live, not decorative. Thinning the evidence for an
   * otherwise identical site has to visibly widen the band — this is the
   * behaviour a reviewer can check in the UI in ten seconds.
   */
  it('widens the credible interval as evidence thins', () => {
    const rich = computeSohi(baseInputs());
    const sparse = computeSohi(
      baseInputs({
        confidence: {
          parametersPresent: 2,
          parametersExpected: 5,
          nObs: 1,
          nObservers: 1,
          daysSinceLastObs: 28,
          observerExperience: ['novice'],
          measurementCv: null,
          hasBiology: false,
        },
      }),
    );

    expect(sparse.confidence.overall).toBeLessThan(rich.confidence.overall);
    expect(sparse.sohiHigh - sparse.sohiLow).toBeGreaterThan(rich.sohiHigh - rich.sohiLow);
  });

  it('keeps the credible interval inside 0..100 near the scale ends', () => {
    const r = computeSohi(
      baseInputs({
        confidence: {
          parametersPresent: 1,
          parametersExpected: 5,
          nObs: 1,
          nObservers: 1,
          daysSinceLastObs: 90,
          observerExperience: ['novice'],
          measurementCv: null,
          hasBiology: false,
        },
      }),
    );
    expect(r.sohiLow).toBeGreaterThanOrEqual(0);
    expect(r.sohiHigh).toBeLessThanOrEqual(100);
    expect(r.sohiLow).toBeLessThanOrEqual(r.sohiHigh);
  });

  it('surfaces exposure as limiting when a sewage spill dominates an otherwise healthy reach', () => {
    const r = computeSohi(
      baseInputs({
        exposure: cleanExposure({
          combinedSewer: true,
          recreationalAccess: true,
          nearestContactM: 50,
          populationWithin1km: 10000,
          sewageOdourRate: 1,
          visibleDischargeRate: 1,
          turbidityNtu: 120,
          precip48hMm: 45,
          dryDaysBefore: 14,
          outfallCount: 3,
        }),
      }),
    );
    expect(r.limitingSubIndex).toBe('exposure');
    expect(r.notes.some((n) => n.includes('risk proxy'))).toBe(true);
  });

  it('records the method version on every result so history stays interpretable', () => {
    expect(computeSohi(baseInputs()).methodVersion).toMatch(/^sohi-\d+\.\d+\.\d+$/);
  });
});
