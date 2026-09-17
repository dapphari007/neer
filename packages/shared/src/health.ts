import { z } from 'zod';
import { StatusClass } from './enums';

/**
 * A single named contribution to the composite score.
 *
 * `contribution` is signed and expressed in index points: negative values are
 * what is dragging the score down. This is what the site detail view renders as
 * a decomposition, and what the insight rules consume as candidate causes.
 *
 * Without this, a score of 47 is an unfalsifiable assertion. With it, a score of
 * 47 is a claim anyone can audit down to the measurement that caused it — which
 * is the difference between a number a municipality will act on and one they
 * will ignore.
 */
export const ScoreDriverSchema = z.object({
  parameter: z.string(),
  label: z.string(),
  /** Signed index points. Negative drags the score down. */
  contribution: z.number(),
  /** The measured value behind the contribution, in native units. */
  value: z.number().nullable(),
  unit: z.string(),
  /** Whether this parameter was measured or is absent from the window. */
  present: z.boolean(),
});
export type ScoreDriver = z.infer<typeof ScoreDriverSchema>;

/**
 * The confidence model, broken into its inputs.
 *
 * Exposing the components rather than only the composite is a deliberate design
 * choice: "0.42" tells a programme coordinator nothing, while "two novice
 * observers, no dissolved-oxygen reading in nine days" tells them exactly what
 * to fix. Uncertainty reported this way becomes a task list rather than a
 * disclaimer.
 */
export const ConfidenceBreakdownSchema = z.object({
  /** Composite 0..1, the product of the components below. */
  overall: z.number().min(0).max(1),
  /** Share of index parameters actually measured in the window. */
  completeness: z.number().min(0).max(1),
  /** Observation count relative to the target sampling cadence. */
  density: z.number().min(0).max(1),
  /** Decay against the age of the most recent observation. */
  recency: z.number().min(0).max(1),
  /** Mean reliability weight of the contributing observers. */
  observerWeight: z.number().min(0).max(1),
  /** Within-day concordance between observers sampling the same reach. */
  agreement: z.number().min(0).max(1),
});
export type ConfidenceBreakdown = z.infer<typeof ConfidenceBreakdownSchema>;

/**
 * The Stream One Health Index for one site on one day.
 *
 * The three sub-indices are aggregated with a weighted *geometric* mean, not an
 * arithmetic one. This is the single most consequential decision in the model:
 * arithmetic aggregation lets two healthy sub-indices mask a catastrophic third,
 * so a stream with intact ecology and low litter but an active sewage discharge
 * would score "good". Geometric aggregation makes any sub-index approaching zero
 * pull the composite toward zero, which is the behaviour the WFD's "one out, all
 * out" rule encodes — without that rule's brittleness, where a single marginal
 * element discards all other information.
 */
export const HealthScoreSchema = z.object({
  siteId: z.string(),
  day: z.string().describe('ISO date, YYYY-MM-DD'),

  sohi: z.number().min(0).max(100),
  status: StatusClass,

  /** E — physico-chemical quality and biotic integrity. */
  ecologicalScore: z.number().min(0).max(100),
  /** P — anthropogenic pressure, inverted so that high means low pressure. */
  pressureScore: z.number().min(0).max(100),
  /** H — human and animal exposure risk, inverted so that high means low risk. */
  exposureScore: z.number().min(0).max(100),

  confidence: ConfidenceBreakdownSchema,
  /** Credible interval on the composite, widening as confidence falls. */
  sohiLow: z.number().min(0).max(100),
  sohiHigh: z.number().min(0).max(100),

  nObs: z.number().int().nonnegative(),
  nObservers: z.number().int().nonnegative(),
  daysSinceLastObs: z.number().int().nonnegative(),

  drivers: z.array(ScoreDriverSchema),
  methodVersion: z.string(),
});
export type HealthScore = z.infer<typeof HealthScoreSchema>;

/** One point on a trend series. */
export const TrendPointSchema = z.object({
  day: z.string(),
  sohi: z.number().nullable(),
  sohiLow: z.number().nullable(),
  sohiHigh: z.number().nullable(),
  ecologicalScore: z.number().nullable(),
  pressureScore: z.number().nullable(),
  exposureScore: z.number().nullable(),
  confidence: z.number().nullable(),
  nObs: z.number().int(),
  /** Environmental context, for the correlated overlay on the trend chart. */
  tempMeanC: z.number().nullable(),
  precipMm: z.number().nullable(),
  dischargeM3s: z.number().nullable(),
});
export type TrendPoint = z.infer<typeof TrendPointSchema>;

export const ForecastPointSchema = z.object({
  targetDate: z.string(),
  metric: z.string(),
  predicted: z.number(),
  lower80: z.number(),
  upper80: z.number(),
  lower95: z.number(),
  upper95: z.number(),
  model: z.string(),
  horizonDays: z.number().int(),
});
export type ForecastPoint = z.infer<typeof ForecastPointSchema>;

export const AnomalySchema = z.object({
  siteId: z.string(),
  metric: z.string(),
  day: z.string(),
  observed: z.number(),
  expected: z.number(),
  deviation: z.number(),
  zScore: z.number(),
  direction: z.enum(['below', 'above']),
  severity: z.enum(['watch', 'elevated', 'high']),
  detector: z.string(),
});
export type Anomaly = z.infer<typeof AnomalySchema>;
