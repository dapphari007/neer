import type { ConfidenceBreakdown, ObserverExperience } from '@neer/shared';
import { modelled } from './provenance';

/**
 * The confidence model.
 *
 * Citizen data is sparse, irregular and uneven in quality. The two usual
 * responses are both wrong: discarding it wastes the only observations that
 * exist at useful frequency, and treating it as authoritative produces confident
 * nonsense. Neer takes the third option — use everything, and quantify how much
 * to trust the result.
 *
 * The components are reported separately rather than only as a composite,
 * because a bare "0.42" tells a programme coordinator nothing they can act on,
 * while "two novice observers, no dissolved-oxygen reading in nine days" is a
 * task list. Uncertainty expressed this way stops being a disclaimer and starts
 * being the product's most actionable output: it tells a network exactly where
 * its next visit is worth most.
 *
 * Every constant here is `modelled`. There is no published standard for
 * confidence in citizen-science water data, and pretending otherwise would be
 * the exact failure this package is built to avoid.
 */

export interface ConfidenceInputs {
  /** Index parameters actually measured, out of those the model wants. */
  readonly parametersPresent: number;
  readonly parametersExpected: number;
  /** Observations contributing to this window. */
  readonly nObs: number;
  readonly nObservers: number;
  readonly daysSinceLastObs: number;
  /** Experience level of each contributing observer. */
  readonly observerExperience: readonly ObserverExperience[];
  /**
   * Within-day spread of a repeated measurement, as a coefficient of variation.
   * Null when only one observer contributed, in which case agreement is unknown
   * rather than perfect.
   */
  readonly measurementCv: number | null;
  /** Whether biology — the primary WFD element — was surveyed at all. */
  readonly hasBiology: boolean;
}

/**
 * Reliability weight per observer experience level.
 *
 * Novices are down-weighted, not excluded. Excluding them would discard most
 * citizen-science data and defeat the purpose of collecting it; the evidence
 * from established programmes is that novice observations carry real signal with
 * wider error, which is precisely what a weight expresses and an exclusion
 * cannot.
 */
export const OBSERVER_WEIGHTS: Record<ObserverExperience, number> = {
  novice: 0.6,
  trained: 0.85,
  expert: 1.0,
  instrument: 1.0,
};

/** Observations per 14-day window at which density stops improving confidence. */
const TARGET_OBS_PER_WINDOW = 4;

/** Recency half-life in days. */
const RECENCY_HALF_LIFE_DAYS = 10;

/**
 * Relative weight of each component in the composite.
 *
 * Combined as a weighted *geometric* mean, for the same reason the headline
 * index is: a near-zero component must drag the composite down rather than be
 * averaged away. Data three months stale is untrustworthy no matter how
 * complete, and an arithmetic mean would hide that behind four healthy
 * components.
 */
const WEIGHTS = {
  completeness: 0.25,
  density: 0.2,
  recency: 0.25,
  observerWeight: 0.15,
  agreement: 0.15,
} as const;

/** Floor applied to each component before aggregation, to keep the product finite. */
const COMPONENT_FLOOR = 0.05;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export function computeConfidence(i: ConfidenceInputs): ConfidenceBreakdown {
  // ─── Completeness ──────────────────────────────────────────────────────────
  // Biology is weighted separately from the count because it is not one
  // parameter among many: under the WFD it is the primary element, and its
  // absence bounds what the score can claim at all.
  const rawCompleteness =
    i.parametersExpected > 0 ? i.parametersPresent / i.parametersExpected : 0;
  const completeness = clamp01(rawCompleteness * (i.hasBiology ? 1 : 0.75));

  // ─── Density ───────────────────────────────────────────────────────────────
  const density = clamp01(i.nObs / TARGET_OBS_PER_WINDOW);

  // ─── Recency ───────────────────────────────────────────────────────────────
  // Exponential decay: a stream is not static, and a month-old reading is a
  // weaker claim about today than a day-old one.
  const recency = clamp01(2 ** (-i.daysSinceLastObs / RECENCY_HALF_LIFE_DAYS));

  // ─── Observer reliability ──────────────────────────────────────────────────
  const observerWeight =
    i.observerExperience.length > 0
      ? clamp01(
          i.observerExperience.reduce((s, e) => s + (OBSERVER_WEIGHTS[e] ?? 0.6), 0) /
            i.observerExperience.length,
        )
      : 0.6;

  // ─── Agreement ─────────────────────────────────────────────────────────────
  // A single observer yields no agreement evidence. Scoring that as 1.0 would
  // reward thin data with maximum confidence — exactly backwards — so a lone
  // observation is capped at 0.7: not penalised as disagreement, but not
  // credited as corroboration either.
  let agreement: number;
  if (i.nObservers <= 1 || i.measurementCv === null) {
    agreement = 0.7;
  } else {
    // CV of 0 is perfect agreement; 0.5 or worse is treated as none.
    agreement = clamp01(1 - i.measurementCv / 0.5);
  }

  const components = { completeness, density, recency, observerWeight, agreement };

  const overall = clamp01(
    Object.entries(WEIGHTS).reduce(
      (product, [key, weight]) =>
        product * Math.max(components[key as keyof typeof components], COMPONENT_FLOOR) ** weight,
      1,
    ),
  );

  return { overall, ...components };
}

/**
 * Maximum half-width of the credible interval, in index points.
 *
 * At zero confidence the band spans ±30 points — wide enough to cross two status
 * classes, which is the honest representation of knowing almost nothing. It is
 * deliberately not ±50: a band that spans the whole scale conveys no information
 * and invites the reader to ignore bands entirely.
 */
export const MAX_BAND_HALF_WIDTH = 30;

export const BAND_PROVENANCE = modelled(
  'Credible interval width scales linearly with (1 − confidence) to a ±30-point maximum. Not a statistical confidence interval: it is a communicated-uncertainty band, since the underlying error distribution of citizen measurements is not characterised.',
);

/**
 * Widen a point score into a credible interval.
 *
 * Clamped to 0–100 at both ends, so a low score near the floor produces an
 * asymmetric band rather than a nonsensical negative bound.
 */
export function confidenceBand(
  score: number,
  confidence: number,
): { low: number; high: number } {
  const halfWidth = (1 - clamp01(confidence)) * MAX_BAND_HALF_WIDTH;
  return {
    low: Math.max(0, score - halfWidth),
    high: Math.min(100, score + halfWidth),
  };
}
