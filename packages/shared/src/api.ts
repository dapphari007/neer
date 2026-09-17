import { z } from 'zod';
import { FindingWithSiteSchema } from './insight';
import { SiteSummarySchema, SiteSchema } from './site';
import { AnomalySchema, ForecastPointSchema, HealthScoreSchema, TrendPointSchema } from './health';

/**
 * API response and query contracts.
 *
 * Responses carry a `meta` block rather than returning bare arrays. The extra
 * nesting earns its keep: `asOf` and `methodVersion` let the dashboard say when
 * data was computed and under which scoring model, and `dataDisclosure` is
 * carried on every payload so the UI cannot render simulated observations
 * without also disclosing that they are simulated. Honesty about provenance is a
 * property of the contract, not of whoever remembered to add a footnote.
 */
export const ResponseMetaSchema = z.object({
  asOf: z.string(),
  methodVersion: z.string(),
  /** Which parts of this payload are real measurements and which are modelled. */
  dataDisclosure: z.object({
    observations: z.enum(['real', 'simulated', 'mixed']),
    environmental: z.enum(['real', 'simulated', 'mixed']),
    note: z.string(),
  }),
});
export type ResponseMeta = z.infer<typeof ResponseMetaSchema>;

export const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ data, meta: ResponseMetaSchema });

// ─── GET /api/sites ───────────────────────────────────────────────────────────
export const SitesResponseSchema = envelope(z.array(SiteSummarySchema));
export type SitesResponse = z.infer<typeof SitesResponseSchema>;

// ─── GET /api/sites/:siteId ──────────────────────────────────────────────────
export const SiteDetailResponseSchema = envelope(
  z.object({
    site: SiteSchema,
    current: HealthScoreSchema.nullable(),
    findings: z.array(FindingWithSiteSchema),
  }),
);
export type SiteDetailResponse = z.infer<typeof SiteDetailResponseSchema>;

// ─── GET /api/sites/:siteId/trend ────────────────────────────────────────────
export const TrendQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  /** Bucket size. Daily is the native grain; weekly smooths sparse citizen series. */
  granularity: z.enum(['day', 'week']).default('day'),
});
export type TrendQuery = z.infer<typeof TrendQuerySchema>;

export const TrendResponseSchema = envelope(
  z.object({
    siteId: z.string(),
    points: z.array(TrendPointSchema),
    anomalies: z.array(AnomalySchema),
    forecast: z.array(ForecastPointSchema),
  }),
);
export type TrendResponse = z.infer<typeof TrendResponseSchema>;

// ─── GET /api/findings ───────────────────────────────────────────────────────
export const FindingsQuerySchema = z.object({
  siteId: z.string().optional(),
  domain: z.string().optional(),
  minSeverity: z.enum(['info', 'watch', 'elevated', 'high']).default('watch'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type FindingsQuery = z.infer<typeof FindingsQuerySchema>;

export const FindingsResponseSchema = envelope(z.array(FindingWithSiteSchema));
export type FindingsResponse = z.infer<typeof FindingsResponseSchema>;

// ─── GET /api/catchments/summary ─────────────────────────────────────────────
export const CatchmentSummarySchema = z.object({
  catchment: z.string(),
  siteCount: z.number().int(),
  meanSohi: z.number().nullable(),
  worstSohi: z.number().nullable(),
  worstSiteId: z.string().nullable(),
  meanConfidence: z.number().nullable(),
  activeFindings: z.number().int(),
  /** Change in mean SOHI over the trailing 30 days, in index points. */
  trend30d: z.number().nullable(),
});
export type CatchmentSummary = z.infer<typeof CatchmentSummarySchema>;

export const CatchmentsResponseSchema = envelope(z.array(CatchmentSummarySchema));
export type CatchmentsResponse = z.infer<typeof CatchmentsResponseSchema>;

// ─── Errors ──────────────────────────────────────────────────────────────────
export const ApiErrorSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.union([z.string(), z.array(z.string())]),
  path: z.string().optional(),
  timestamp: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
