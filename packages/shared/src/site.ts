import { z } from 'zod';
import { UrbanClass } from './enums';

/**
 * A monitoring site on an urban stream.
 *
 * The catchment and exposure attributes are not metadata — they are inputs to
 * the scoring model. The same dissolved-oxygen reading means something different
 * in a combined-sewer catchment with a downstream paddling spot than it does in
 * a semi-natural reach nobody touches, and the index has to know the difference.
 */
export const SiteSchema = z.object({
  siteId: z.string().min(1),
  name: z.string().min(1),
  catchment: z.string().min(1),
  waterBodyCode: z.string().default(''),
  city: z.string(),
  country: z.string().length(2),

  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  elevationM: z.number(),
  /** Strahler stream order — a first-order headwater behaves nothing like a fifth-order reach. */
  streamOrder: z.number().int().min(1).max(9),
  upstreamAreaKm2: z.number().nonnegative(),

  urbanClass: UrbanClass,
  imperviousPct: z.number().min(0).max(100),
  /** Catchment served by a combined sewer, so storms can spill untreated sewage. */
  combinedSewer: z.boolean(),

  /** Public physical contact with the water actually occurs here. */
  recreationalAccess: z.boolean(),
  /** Distance downstream to the nearest contact point, in metres. */
  nearestContactM: z.number().int().nonnegative(),
  populationWithin1km: z.number().int().nonnegative(),

  /**
   * Reference conditions for this water body type, used to normalise measured
   * values into an Ecological Quality Ratio. Without a type-specific reference,
   * a chalk stream and an urban ditch get scored against the same yardstick and
   * the result is meaningless for both.
   */
  referenceDoMgl: z.number().positive(),
  referenceCondUscm: z.number().positive(),
});
export type Site = z.infer<typeof SiteSchema>;

/** Site with its current headline score, as returned by the overview endpoint. */
export const SiteSummarySchema = SiteSchema.pick({
  siteId: true,
  name: true,
  catchment: true,
  city: true,
  lat: true,
  lon: true,
  urbanClass: true,
  recreationalAccess: true,
}).extend({
  sohi: z.number().min(0).max(100).nullable(),
  status: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  sohiLow: z.number().nullable(),
  sohiHigh: z.number().nullable(),
  daysSinceLastObs: z.number().int().nullable(),
  activeFindingCount: z.number().int().nonnegative().default(0),
  maxSeverity: z.string().nullable(),
  asOf: z.string().nullable(),
});
export type SiteSummary = z.infer<typeof SiteSummarySchema>;
