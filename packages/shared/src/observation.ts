import { z } from 'zod';
import {
  FlowState,
  MeasurementMethod,
  ObserverExperience,
  Odour,
  WaterColour,
} from './enums';

/**
 * Macroinvertebrate groups a trained volunteer can realistically identify in the
 * field without a microscope or a taxonomic key.
 *
 * The first eight are the Riverfly Partnership ARMI groups used by volunteer
 * monitors across the UK; the remainder extend the list downward into
 * pollution-tolerant taxa. Spanning the full tolerance gradient is the point —
 * a biotic score needs both ends. Finding only worms and bloodworm is as
 * informative as finding stonefly, and in the opposite direction.
 */
export const TAXON_GROUPS = [
  // sensitive — disappear first under organic pollution
  'stonefly',
  'cased_caddisfly',
  'caseless_caddisfly',
  'mayfly_ephemeridae',
  'flat_bodied_mayfly',
  'blue_winged_olive',
  // intermediate
  'olives_baetidae',
  'freshwater_shrimp',
  'damselfly_nymph',
  'dragonfly_nymph',
  'water_beetle',
  'snail',
  // tolerant — persist, and often dominate, in degraded reaches
  'hoglouse_asellus',
  'leech',
  'bloodworm_chironomid',
  'worm_oligochaeta',
] as const;

export const TaxonGroup = z.enum(TAXON_GROUPS);
export type TaxonGroup = z.infer<typeof TaxonGroup>;

/**
 * Log-abundance category, as recorded in volunteer protocols. Volunteers count
 * in bands rather than individuals because exact counts are neither achievable
 * nor necessary: 0 = absent, 1 = 1–9, 2 = 10–99, 3 = 100–999, 4 = 1000+.
 */
export const AbundanceBand = z.number().int().min(0).max(4);

/**
 * A single field observation.
 *
 * Every measurement is optional because partial submissions are the normal case,
 * not an error — a volunteer with a turbidity tube and no DO meter still
 * contributes real signal. The scoring layer handles absence explicitly and
 * lowers confidence for it rather than rejecting the record or silently
 * substituting a default.
 *
 * The numeric bounds are physical-plausibility gates, not precision claims: they
 * reject transcription errors (a pH of 74, a decimal-slip turbidity) at the door,
 * before a bad value can propagate into an index and out into a public map.
 */
export const ObservationInputSchema = z.object({
  siteId: z.string().min(1),
  observedAt: z.coerce.date(),
  observerId: z.string().min(1),
  observerExperience: ObserverExperience.default('trained'),
  method: MeasurementMethod.default('citizen_kit'),
  source: z.string().default('neer-app'),
  photoCount: z.number().int().min(0).max(50).default(0),

  // ─── physico-chemical (test-kit measurable) ────────────────────────────────
  /** Liquid water in a temperate stream; anything outside this is a bad reading. */
  waterTempC: z.number().min(-5).max(45).nullish(),
  ph: z.number().min(0).max(14).nullish(),
  /** Up to ~20 mg/L allows for genuine supersaturation during an algal bloom. */
  dissolvedOxygenMgl: z.number().min(0).max(25).nullish(),
  conductivityUscm: z.number().min(0).max(20000).nullish(),
  turbidityNtu: z.number().min(0).max(4000).nullish(),
  nitrateMgl: z.number().min(0).max(200).nullish(),
  phosphateMgl: z.number().min(0).max(50).nullish(),
  ammoniumMgl: z.number().min(0).max(100).nullish(),

  // ─── visual / habitat assessment ───────────────────────────────────────────
  waterColour: WaterColour.default('clear'),
  odour: Odour.default('none'),
  foamPresent: z.boolean().default(false),
  surfaceFilm: z.boolean().default(false),
  /** 0 none … 3 heavy. */
  litterScore: z.number().int().min(0).max(3).default(0),
  algaeCoverPct: z.number().int().min(0).max(100).nullish(),
  flowState: FlowState.default('normal'),
  /** 0 degraded … 3 intact, following the QBR riparian quality approach. */
  riparianScore: z.number().int().min(0).max(3).default(0),
  visibleDischarge: z.boolean().default(false),

  // ─── biological ────────────────────────────────────────────────────────────
  taxaGroups: z.array(TaxonGroup).default([]),
  taxaAbundance: z.array(AbundanceBand).default([]),

  notes: z.string().max(2000).default(''),
});
export type ObservationInput = z.input<typeof ObservationInputSchema>;
export type Observation = z.infer<typeof ObservationInputSchema>;

/**
 * Parallel arrays must line up. Enforced as a refinement rather than a nested
 * object array because protocols disagree on which groups they collect, and a
 * fixed object shape would force every programme into one schema.
 */
export const ObservationSchema = ObservationInputSchema.refine(
  (o) => o.taxaGroups.length === o.taxaAbundance.length,
  { message: 'taxaGroups and taxaAbundance must be the same length', path: ['taxaAbundance'] },
);

/** Batch ingestion payload. */
export const ObservationBatchSchema = z.object({
  observations: z.array(ObservationSchema).min(1).max(1000),
});
export type ObservationBatch = z.infer<typeof ObservationBatchSchema>;
