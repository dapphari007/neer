import { type Provenance, modelled, SOURCES } from './provenance';

/**
 * CCME Water Quality Index 1.0.
 *
 * Implemented verbatim from the CCME user's manual. This index was chosen over
 * the more familiar NSF WQI for one decisive reason: NSF requires nine fixed
 * parameters, two of which (BOD₅ and faecal coliform) are laboratory
 * measurements no volunteer can produce, and its sub-index transfer functions
 * are graphical Delphi curves with no published equations — every software
 * implementation digitises them slightly differently, so no two NSF scores are
 * comparable.
 *
 * CCME needs neither. It takes an arbitrary parameter set and one guideline
 * value per parameter, and everything else is arithmetic. That means a site
 * measuring four parameters and a site measuring twelve are scored by the same
 * published method, and the guideline set can be swapped per water body type
 * without touching the code — which is exactly what the WFD's type-specific
 * reference conditions demand.
 *
 * The three factors:
 *   F1 (Scope)     — how many parameters ever failed
 *   F2 (Frequency) — how often tests failed
 *   F3 (Amplitude) — by how much they failed
 *
 * @see https://ccme.ca/en/res/wqimanualen.pdf
 */

/** Direction in which a guideline is violated. */
export type ObjectiveDirection =
  /** Value must not exceed the guideline (nutrients, turbidity, temperature). */
  | 'max'
  /** Value must not fall below the guideline (dissolved oxygen). */
  | 'min'
  /**
   * Value must stay within a band (pH).
   *
   * A Neer extension, not part of CCME 1.0. The manual handles only one-sided
   * guidelines, but pH is meaningfully bad in both directions and dropping it
   * would lose real signal. The excursion is computed against whichever bound
   * was crossed, using the manual's own one-sided formula, so the arithmetic
   * stays CCME's even though the parameter handling is ours. Flagged here so
   * nobody mistakes the extension for the standard.
   */
  | 'range';

export interface Objective {
  readonly parameter: string;
  readonly label: string;
  readonly unit: string;
  readonly direction: ObjectiveDirection;
  /** Guideline value. For `range`, the lower bound. */
  readonly value: number;
  /** Upper bound — required for `range`, ignored otherwise. */
  readonly upper?: number;
  readonly provenance: Provenance;
}

/** One measurement of one parameter. */
export interface Measurement {
  readonly parameter: string;
  readonly value: number;
}

export interface CcmeResult {
  /** 0–100. Higher is better. */
  readonly wqi: number;
  readonly category: 'excellent' | 'good' | 'fair' | 'marginal' | 'poor';
  readonly f1Scope: number;
  readonly f2Frequency: number;
  readonly f3Amplitude: number;
  readonly parametersTested: number;
  readonly parametersFailed: number;
  readonly testsTotal: number;
  readonly testsFailed: number;
  /** Per-parameter failure detail, for the score decomposition. */
  readonly failures: ReadonlyArray<{
    parameter: string;
    label: string;
    unit: string;
    objective: number;
    worstValue: number;
    failedTests: number;
    totalTests: number;
    meanExcursion: number;
  }>;
  /** True when fewer parameters were available than CCME recommends. */
  readonly belowRecommendedParameterCount: boolean;
}

/**
 * Cap on a single excursion.
 *
 * Without it, one decimal-slip transcription error (turbidity entered as 1400
 * rather than 14.0) drives F3 to ~100 on its own and collapses the whole index
 * for that window. The plausibility gates in the ingestion schema catch most bad
 * values, but this is the second line of defence: a genuinely extreme reading
 * still scores as extreme, it simply cannot single-handedly zero the index.
 */
const MAX_EXCURSION = 100;

/**
 * Excursion: how far past the guideline a failing value sits, as a ratio.
 *
 * Returns 0 for a passing value. The manual's two forms are inverted images of
 * each other so that a 'min' violation and a 'max' violation of equal
 * proportional severity produce the same excursion.
 */
export function excursion(value: number, objective: Objective): number {
  if (!Number.isFinite(value)) return 0;

  switch (objective.direction) {
    case 'max': {
      if (objective.value <= 0) return 0;
      return value > objective.value ? Math.min(value / objective.value - 1, MAX_EXCURSION) : 0;
    }
    case 'min': {
      // A reading of zero against a "must not fall below" guideline is a total
      // failure, not an infinity. Clamping keeps F3 finite without discarding
      // the observation — anoxic water is real and must score as such.
      if (value <= 0) return objective.value > 0 ? MAX_EXCURSION : 0;
      return value < objective.value ? Math.min(objective.value / value - 1, MAX_EXCURSION) : 0;
    }
    case 'range': {
      const lower = objective.value;
      const upper = objective.upper ?? Number.POSITIVE_INFINITY;
      if (value < lower) {
        return value > 0 ? Math.min(lower / value - 1, MAX_EXCURSION) : MAX_EXCURSION;
      }
      if (value > upper) {
        return upper > 0 ? Math.min(value / upper - 1, MAX_EXCURSION) : 0;
      }
      return 0;
    }
  }
}

function categorise(wqi: number): CcmeResult['category'] {
  if (wqi >= 95) return 'excellent';
  if (wqi >= 80) return 'good';
  if (wqi >= 65) return 'fair';
  if (wqi >= 45) return 'marginal';
  return 'poor';
}

/**
 * Compute the CCME WQI over a set of measurements.
 *
 * `measurements` may span any time window and contain repeated readings of the
 * same parameter; each reading is one "test" in the manual's terms. Parameters
 * with no objective defined are ignored rather than silently passed, so an
 * unguided parameter can never inflate the score.
 */
export function computeCcmeWqi(
  measurements: readonly Measurement[],
  objectives: readonly Objective[],
): CcmeResult {
  const byParameter = new Map<string, Objective>();
  for (const o of objectives) byParameter.set(o.parameter, o);

  const scored = measurements.filter(
    (m) => byParameter.has(m.parameter) && Number.isFinite(m.value),
  );

  const testsTotal = scored.length;
  const parametersTested = new Set(scored.map((m) => m.parameter)).size;

  // No data is not the same as clean water. Returning 100 here would paint an
  // unmonitored stream as pristine, which is the exact failure mode this
  // project exists to correct — so absence returns 0 WQI and the confidence
  // model, not the index, carries the "we do not know" signal.
  if (testsTotal === 0 || parametersTested === 0) {
    return {
      wqi: 0,
      category: 'poor',
      f1Scope: 0,
      f2Frequency: 0,
      f3Amplitude: 0,
      parametersTested: 0,
      parametersFailed: 0,
      testsTotal: 0,
      testsFailed: 0,
      failures: [],
      belowRecommendedParameterCount: true,
    };
  }

  const perParameter = new Map<
    string,
    { failed: number; total: number; excursions: number[]; worst: number }
  >();

  let testsFailed = 0;
  const allExcursions: number[] = [];

  for (const m of scored) {
    const objective = byParameter.get(m.parameter);
    if (!objective) continue;

    const e = Math.min(excursion(m.value, objective), MAX_EXCURSION);
    const entry = perParameter.get(m.parameter) ?? {
      failed: 0,
      total: 0,
      excursions: [],
      worst: m.value,
    };
    entry.total += 1;

    if (e > 0) {
      entry.failed += 1;
      entry.excursions.push(e);
      testsFailed += 1;
      allExcursions.push(e);

      const worseThanCurrent =
        objective.direction === 'min' ? m.value < entry.worst : m.value > entry.worst;
      if (entry.failed === 1 || worseThanCurrent) entry.worst = m.value;
    }

    perParameter.set(m.parameter, entry);
  }

  const parametersFailed = [...perParameter.values()].filter((p) => p.failed > 0).length;

  // F1 — Scope: share of parameters that failed at least once.
  const f1Scope = (parametersFailed / parametersTested) * 100;

  // F2 — Frequency: share of individual tests that failed.
  const f2Frequency = (testsFailed / testsTotal) * 100;

  // F3 — Amplitude: normalised sum of excursions, asymptotic to 100.
  const nse = allExcursions.reduce((sum, e) => sum + e, 0) / testsTotal;
  const f3Amplitude = nse > 0 ? nse / (0.01 * nse + 0.01) : 0;

  // 1.732 ≈ sqrt(3) scales the vector magnitude of three 0–100 factors back
  // into 0–100.
  const wqi = Math.max(
    0,
    Math.min(100, 100 - Math.sqrt(f1Scope ** 2 + f2Frequency ** 2 + f3Amplitude ** 2) / 1.732),
  );

  const failures = [...perParameter.entries()]
    .filter(([, v]) => v.failed > 0)
    .map(([parameter, v]) => {
      const objective = byParameter.get(parameter)!;
      return {
        parameter,
        label: objective.label,
        unit: objective.unit,
        objective: objective.value,
        worstValue: v.worst,
        failedTests: v.failed,
        totalTests: v.total,
        meanExcursion: v.excursions.reduce((s, e) => s + e, 0) / v.excursions.length,
      };
    })
    .sort((a, b) => b.meanExcursion - a.meanExcursion);

  return {
    wqi,
    category: categorise(wqi),
    f1Scope,
    f2Frequency,
    f3Amplitude,
    parametersTested,
    parametersFailed,
    testsTotal,
    testsFailed,
    failures,
    // The manual recommends 8–20 parameters. Citizen submissions routinely carry
    // fewer, which does not invalidate the score but does widen its uncertainty —
    // this flag is what the confidence model consumes to express that.
    belowRecommendedParameterCount: parametersTested < 8,
  };
}

/**
 * Default guideline set for temperate lowland urban streams.
 *
 * Read the provenance tags before trusting any of these. Only the faecal
 * indicators are legally binding values; the physico-chemical guidelines are
 * `modelled` — they sit in the range used by WFD good-status standards for this
 * river type, but the Directive sets them per Member State and per water body
 * type, and no single European number exists to cite.
 *
 * This is the honest position and it is deliberately visible in the type system:
 * anyone deploying Neer on real streams must replace this profile with their own
 * competent authority's standards, and the UI marks any score that leans on a
 * `modelled` guideline.
 */
export const DEFAULT_OBJECTIVES: readonly Objective[] = [
  {
    parameter: 'dissolvedOxygenMgl',
    label: 'Dissolved oxygen',
    unit: 'mg/L',
    direction: 'min',
    value: 6,
    provenance: modelled(
      'Within the band used for good ecological status oxygenation in temperate lowland rivers. Type-specific calibration required; salmonid waters demand substantially more.',
    ),
  },
  {
    parameter: 'ph',
    label: 'pH',
    unit: 'pH',
    direction: 'range',
    value: 6,
    upper: 9,
    provenance: modelled(
      'Conventional supporting-element band for rivers. Naturally acidic peat-fed and naturally alkaline karst streams fall outside it without being degraded.',
    ),
  },
  {
    parameter: 'nitrateMgl',
    label: 'Nitrate',
    unit: 'mg NO₃/L',
    direction: 'max',
    value: 25,
    provenance: modelled(
      'Half the 50 mg NO₃/L drinking-water limit. Ecological nutrient standards are set per water body type and are typically stricter than this.',
    ),
  },
  {
    parameter: 'phosphateMgl',
    label: 'Orthophosphate',
    unit: 'mg PO₄/L',
    direction: 'max',
    value: 0.4,
    provenance: modelled(
      'Approximately 0.13 mg P/L. Phosphorus is usually the limiting nutrient in freshwaters, so this is the single most calibration-sensitive guideline in the set.',
    ),
  },
  {
    parameter: 'ammoniumMgl',
    label: 'Ammonium',
    unit: 'mg NH₄/L',
    direction: 'max',
    value: 0.4,
    provenance: modelled(
      'Ammonium is the strongest single chemical predictor of IBMWP in the Iberian reference data (β = −0.322), which is why it is retained despite the absence of a citable pan-European river limit.',
    ),
  },
  {
    parameter: 'turbidityNtu',
    label: 'Turbidity',
    unit: 'NTU',
    direction: 'max',
    value: 25,
    provenance: modelled(
      'Chosen to sit inside the Secchi-tube detection range used by volunteer protocols (~12–240 NTU), so the guideline is actually measurable by the instrument citizens hold.',
    ),
  },
  {
    parameter: 'conductivityUscm',
    label: 'Conductivity',
    unit: 'µS/cm',
    direction: 'max',
    value: 1000,
    provenance: modelled(
      'Conductivity is strongly geology-dependent (r = −0.531 with IBMWP). A fixed guideline is weak; scoring against a site-specific reference is preferable where one exists.',
    ),
  },
  {
    parameter: 'waterTempC',
    label: 'Water temperature',
    unit: '°C',
    direction: 'max',
    value: 25,
    provenance: modelled(
      'Thermal-stress threshold for temperate stream invertebrate assemblages, and the point at which oxygen solubility loss compounds organic loading.',
    ),
  },
];

/**
 * Faecal indicator guidelines from the Bathing Water Directive.
 *
 * Kept separate from the physico-chemical profile because they are *not*
 * interchangeable with it. Two things about these numbers are routinely got
 * wrong, and both are load-bearing:
 *
 *  1. The Directive's "Sufficient" value is numerically *lower* than "Good" —
 *     400 vs 200 for enterococci — because it is evaluated at the 90th
 *     percentile while the others use the 95th. They are not points on one
 *     monotonic scale, and a naive `if (v < x)` ladder misclassifies.
 *  2. A class is defined over a dataset of at least 16 samples across four
 *     bathing seasons. A single measurement has no Directive class, and Neer
 *     never claims otherwise.
 *
 * Neer cannot measure these at all — no citizen kit cultures faecal indicators.
 * They are held here as the anchor the *modelled* pathogen risk proxy is
 * calibrated against and explained in terms of, never as a measured value.
 */
export const BATHING_WATER_INLAND = {
  intestinalEnterococci: {
    excellentP95: 200,
    goodP95: 400,
    sufficientP90: 330,
    unit: 'cfu/100 ml',
    provenance: { ...SOURCES.BATHING_WATER_DIRECTIVE, kind: 'standard' as const },
  },
  escherichiaColi: {
    excellentP95: 500,
    goodP95: 1000,
    sufficientP90: 900,
    unit: 'cfu/100 ml',
    provenance: { ...SOURCES.BATHING_WATER_DIRECTIVE, kind: 'standard' as const },
  },
} as const;
