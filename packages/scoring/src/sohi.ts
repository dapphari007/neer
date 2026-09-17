import type { ConfidenceBreakdown, ScoreDriver, StatusClass } from '@neer/shared';
import { confidenceBand, computeConfidence, type ConfidenceInputs } from './confidence';
import { computeEcological, type EcologicalInputs, type EcologicalResult } from './ecological';
import { computeExposure, type ExposureInputs, type ExposureResult } from './exposure';
import { computePressure, type PressureInputs, type PressureResult } from './pressure';
import { modelled } from './provenance';

/**
 * SOHI — the Stream One Health Index.
 *
 * Aggregates ecological integrity (E), anthropogenic pressure (P) and health
 * exposure (H) into one 0–100 figure.
 */

export const METHOD_VERSION = 'sohi-0.1.0';

/**
 * Sub-index weights.
 *
 * Ecology carries the most weight because it integrates over time in a way no
 * instantaneous measurement does — an invertebrate community is a record of the
 * preceding months of conditions, not of the morning it was sampled. Exposure
 * outweighs pressure because this is a One Health index: where the two diverge,
 * the realised risk to people and animals matters more than the pressure that
 * produced it.
 */
export const SUB_INDEX_WEIGHTS = {
  ecological: 0.45,
  exposure: 0.3,
  pressure: 0.25,
} as const;

export const WEIGHTS_PROVENANCE = modelled(
  'Sub-index weights are a judgement, not a published standard. They are exposed as constants and surfaced in the methodology doc precisely so they can be argued with and recalibrated; no composite environmental index has objectively correct weights.',
);

/**
 * Status class boundaries on the 0–100 scale.
 *
 * Five equal 20-point bands, aligned to WFD class names. The evenness here is
 * legitimate where it would not be on a raw EQR scale: the ecological sub-index
 * has already mapped the *unevenly spaced* WHPT EQR boundaries onto equal output
 * bands, so each 20-point span already corresponds to its true, unequal span of
 * ecological quality.
 */
export const STATUS_BOUNDARIES = { high: 80, good: 60, moderate: 40, poor: 20 } as const;

export function classifySohi(sohi: number): StatusClass {
  if (sohi >= STATUS_BOUNDARIES.high) return 'high';
  if (sohi >= STATUS_BOUNDARIES.good) return 'good';
  if (sohi >= STATUS_BOUNDARIES.moderate) return 'moderate';
  if (sohi >= STATUS_BOUNDARIES.poor) return 'poor';
  return 'bad';
}

/**
 * Floor applied to a sub-index before geometric aggregation.
 *
 * A true zero would take the logarithm to negative infinity and collapse the
 * composite to exactly zero, discarding every other measurement. The floor
 * preserves the intended behaviour — a catastrophic sub-index dominates — while
 * keeping the arithmetic finite and the other sub-indices still legible in the
 * result.
 */
const SUB_INDEX_FLOOR = 1;

export interface SohiInputs {
  readonly siteId: string;
  readonly day: string;
  readonly ecological: EcologicalInputs;
  readonly pressure: PressureInputs;
  readonly exposure: ExposureInputs;
  readonly confidence: ConfidenceInputs;
}

export interface SohiResult {
  readonly siteId: string;
  readonly day: string;
  readonly sohi: number;
  readonly status: StatusClass;
  readonly ecologicalScore: number;
  readonly pressureScore: number;
  readonly exposureScore: number;
  readonly confidence: ConfidenceBreakdown;
  readonly sohiLow: number;
  readonly sohiHigh: number;
  readonly drivers: readonly ScoreDriver[];
  /** The sub-index dragging the composite down hardest. */
  readonly limitingSubIndex: 'ecological' | 'pressure' | 'exposure';
  readonly methodVersion: string;
  readonly detail: {
    readonly ecological: EcologicalResult;
    readonly pressure: PressureResult;
    readonly exposure: ExposureResult;
  };
  readonly notes: readonly string[];
}

/**
 * Weighted geometric mean of the three sub-indices.
 *
 * This is the single most consequential decision in the model, and it is a
 * deliberate rejection of the arithmetic mean that composite indices usually
 * use. Under an arithmetic mean, a stream with intact ecology (85) and low
 * litter (80) but an active sewage discharge driving exposure to 10 scores 62 —
 * "Good". That is not a defensible thing to publish about a waterway people let
 * their children paddle in.
 *
 * Geometric aggregation makes any sub-index approaching zero pull the composite
 * toward zero, so the same site scores 41 — Moderate, limited by exposure, with
 * the reason named. This is the behaviour the WFD's "one out, all out" rule
 * encodes, without that rule's brittleness: OOAO discards all other information
 * once one element fails, and UKTAG warns it amplifies measurement error as the
 * element count grows. The geometric mean degrades smoothly instead of snapping,
 * which is the right property for noisy citizen data.
 */
export function aggregateSohi(scores: {
  ecological: number;
  pressure: number;
  exposure: number;
}): number {
  const e = Math.max(SUB_INDEX_FLOOR, scores.ecological) / 100;
  const p = Math.max(SUB_INDEX_FLOOR, scores.pressure) / 100;
  const h = Math.max(SUB_INDEX_FLOOR, scores.exposure) / 100;

  const composite =
    e ** SUB_INDEX_WEIGHTS.ecological *
    p ** SUB_INDEX_WEIGHTS.pressure *
    h ** SUB_INDEX_WEIGHTS.exposure;

  return Math.max(0, Math.min(100, composite * 100));
}

/**
 * Headroom decomposition.
 *
 * For each sub-index, how many index points the composite would gain if that
 * sub-index alone were perfect. Because the aggregation is multiplicative, this
 * is exact rather than an approximation — and it answers the question a
 * municipality actually asks, which is not "what is wrong" but "what is the
 * single most valuable thing to fix".
 */
function headroom(
  scores: { ecological: number; pressure: number; exposure: number },
  current: number,
): Record<keyof typeof SUB_INDEX_WEIGHTS, number> {
  const gain = (key: keyof typeof SUB_INDEX_WEIGHTS): number => {
    const value = Math.max(SUB_INDEX_FLOOR, scores[key]);
    const lifted = current * (100 / value) ** SUB_INDEX_WEIGHTS[key];
    return Math.min(100, lifted) - current;
  };
  return {
    ecological: gain('ecological'),
    pressure: gain('pressure'),
    exposure: gain('exposure'),
  };
}

export function computeSohi(inputs: SohiInputs): SohiResult {
  const ecological = computeEcological(inputs.ecological);
  const pressure = computePressure(inputs.pressure);
  const exposure = computeExposure(inputs.exposure);

  const scores = {
    ecological: ecological.score,
    pressure: pressure.score,
    exposure: exposure.score,
  };

  const sohi = aggregateSohi(scores);
  const confidence = computeConfidence(inputs.confidence);
  const band = confidenceBand(sohi, confidence.overall);
  const gains = headroom(scores, sohi);

  const limitingSubIndex = (Object.keys(gains) as Array<keyof typeof gains>).reduce(
    (worst, key) => (gains[key] > gains[worst] ? key : worst),
    'ecological' as keyof typeof gains,
  );

  // ─── Drivers ───────────────────────────────────────────────────────────────
  // Sub-index headroom first, then the specific measurements underneath, so the
  // decomposition reads top-down: which dimension, then which parameter.
  const drivers: ScoreDriver[] = [
    {
      parameter: 'sub_index.ecological',
      label: 'Ecological integrity',
      contribution: -gains.ecological,
      value: ecological.score,
      unit: 'score',
      present: ecological.limitingElement !== 'none',
    },
    {
      parameter: 'sub_index.exposure',
      label: 'Health exposure',
      contribution: -gains.exposure,
      value: exposure.score,
      unit: 'score',
      present: true,
    },
    {
      parameter: 'sub_index.pressure',
      label: 'Anthropogenic pressure',
      contribution: -gains.pressure,
      value: pressure.score,
      unit: 'score',
      present: true,
    },
  ];

  for (const failure of ecological.ccme.failures.slice(0, 5)) {
    drivers.push({
      parameter: `physchem.${failure.parameter}`,
      label: failure.label,
      contribution: -failure.meanExcursion * 10,
      value: failure.worstValue,
      unit: failure.unit,
      present: true,
    });
  }

  if (ecological.biotic.aspt !== null) {
    drivers.push({
      parameter: 'biology.aspt',
      label: 'Invertebrate community (ASPT)',
      contribution: (ecological.biotic.score ?? 0) - 60,
      value: ecological.biotic.aspt,
      unit: 'ASPT',
      present: true,
    });
  }

  for (const component of exposure.components.filter((c) => c.risk > 0.2)) {
    drivers.push({
      parameter: `exposure.${component.key}`,
      label: component.label,
      contribution: -component.risk * 20,
      value: component.risk,
      unit: 'risk 0–1',
      present: true,
    });
  }

  for (const component of pressure.components.filter((c) => c.score < 60)) {
    drivers.push({
      parameter: `pressure.${component.key}`,
      label: component.label,
      contribution: -(60 - component.score) * component.weight,
      value: component.value,
      unit: component.unit,
      present: true,
    });
  }

  drivers.sort((a, b) => a.contribution - b.contribution);

  const notes = [...ecological.notes];
  if (pressure.riparianApproximated) {
    notes.push(
      'Riparian condition was approximated from a coarse ordinal rather than a full QBR assessment. A QBR survey is the highest-value single addition here — it is the strongest known predictor of invertebrate community quality and needs no taxonomy.',
    );
  }
  if (exposure.limitingComponent) {
    notes.push(
      `Exposure is dominated by ${exposure.limitingComponent.label.toLowerCase()}; this is a modelled risk proxy from field-observable conditions, not a measurement of the hazard itself.`,
    );
  }

  return {
    siteId: inputs.siteId,
    day: inputs.day,
    sohi,
    status: classifySohi(sohi),
    ecologicalScore: ecological.score,
    pressureScore: pressure.score,
    exposureScore: exposure.score,
    confidence,
    sohiLow: band.low,
    sohiHigh: band.high,
    drivers,
    limitingSubIndex,
    methodVersion: METHOD_VERSION,
    detail: { ecological, pressure, exposure },
    notes,
  };
}
