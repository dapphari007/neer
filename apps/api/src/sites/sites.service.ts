import { Injectable, NotFoundException } from '@nestjs/common';
import { ClickHouseService } from '../clickhouse/clickhouse.service';

/**
 * Site and trend queries.
 *
 * Everything reads from the pre-aggregated rollups and the computed index
 * tables, never from the raw observation grain. That is what keeps the
 * dashboard responsive as observation volume grows: a six-month trend merges a
 * few hundred daily rows regardless of how many field visits produced them.
 */
@Injectable()
export class SitesService {
  constructor(private readonly clickhouse: ClickHouseService) {}

  /**
   * Overview list: every site with its current score and active alert count.
   *
   * The finding count is aggregated in a subquery rather than joined row-wise,
   * so a site with twelve findings still yields exactly one row. Joining first
   * and grouping afterwards would multiply the site row and require a DISTINCT
   * that hides the mistake rather than fixing it.
   */
  async listSites() {
    return this.clickhouse.query(`
      SELECT
          h.site_id                              AS siteId,
          h.name                                 AS name,
          h.catchment                            AS catchment,
          h.city                                 AS city,
          h.lat                                  AS lat,
          h.lon                                  AS lon,
          toString(h.urban_class)                AS urbanClass,
          h.recreational_access = 1              AS recreationalAccess,
          toString(h.source)                     AS source,
          h.region                               AS region,
          h.provider                             AS provider,
          round(h.sohi, 1)                       AS sohi,
          toString(h.status)                     AS status,
          round(h.confidence, 3)                 AS confidence,
          round(h.sohi_low, 1)                   AS sohiLow,
          round(h.sohi_high, 1)                  AS sohiHigh,
          round(h.ecological_score, 1)           AS ecologicalScore,
          round(h.pressure_score, 1)             AS pressureScore,
          round(h.exposure_score, 1)             AS exposureScore,
          h.days_since_last_obs                  AS daysSinceLastObs,
          h.n_obs                                AS nObs,
          toString(h.as_of)                      AS asOf,
          ifNull(f.active_findings, 0)           AS activeFindingCount,
          ifNull(f.max_severity, '')             AS maxSeverity
      FROM site_health_overview AS h
      LEFT JOIN (
          SELECT
              site_id,
              count()                            AS active_findings,
              toString(max(severity))            AS max_severity
          FROM findings_active
          GROUP BY site_id
      ) AS f ON f.site_id = h.site_id
      ORDER BY h.sohi ASC`);
  }

  /** Full site record with its current index and score decomposition. */
  async getSite(siteId: string) {
    const [site] = await this.clickhouse.query<Record<string, unknown>>(
      `
      SELECT
          s.site_id                        AS siteId,
          s.name                           AS name,
          s.catchment                      AS catchment,
          s.water_body_code                AS waterBodyCode,
          s.city                           AS city,
          s.country                        AS country,
          s.lat                            AS lat,
          s.lon                            AS lon,
          s.elevation_m                    AS elevationM,
          s.stream_order                   AS streamOrder,
          s.upstream_area_km2              AS upstreamAreaKm2,
          toString(s.urban_class)          AS urbanClass,
          s.impervious_pct                 AS imperviousPct,
          s.combined_sewer = 1             AS combinedSewer,
          s.recreational_access = 1        AS recreationalAccess,
          s.nearest_contact_m              AS nearestContactM,
          s.population_within_1km          AS populationWithin1km,
          s.reference_do_mgl               AS referenceDoMgl,
          s.reference_cond_uscm            AS referenceCondUscm,
          toString(s.source)               AS source,
          s.region                         AS region,
          s.provider                       AS provider,
          s.provider_ref                   AS providerRef
      FROM sites AS s FINAL
      WHERE s.site_id = {siteId:String}
      LIMIT 1`,
      { siteId },
    );

    if (!site) {
      throw new NotFoundException(`No site with id "${siteId}"`);
    }

    const [current] = await this.clickhouse.query<Record<string, unknown>>(
      `
      SELECT
          toString(day)                    AS day,
          round(sohi, 1)                   AS sohi,
          toString(status)                 AS status,
          round(ecological_score, 1)       AS ecologicalScore,
          round(pressure_score, 1)         AS pressureScore,
          round(exposure_score, 1)         AS exposureScore,
          round(confidence, 3)             AS confidence,
          round(sohi_low, 1)               AS sohiLow,
          round(sohi_high, 1)              AS sohiHigh,
          round(completeness, 3)           AS completeness,
          round(density_score, 3)          AS density,
          round(recency_score, 3)          AS recency,
          round(observer_weight, 3)        AS observerWeight,
          round(agreement_score, 3)        AS agreement,
          n_obs                            AS nObs,
          n_observers                      AS nObservers,
          days_since_last_obs              AS daysSinceLastObs,
          drivers                          AS drivers,
          method_version                   AS methodVersion
      FROM site_health_daily FINAL
      WHERE site_id = {siteId:String}
      ORDER BY day DESC
      LIMIT 1`,
      { siteId },
    );

    return { site, current: current ?? null };
  }

  /**
   * Daily index series with environmental context.
   *
   * Weather is returned alongside the index rather than on a separate request so
   * the trend chart can overlay them on one time axis. Correlating a score
   * change with the rainfall that preceded it is the whole point of the view,
   * and two round trips would let the two series arrive out of step.
   */
  async getTrend(siteId: string, from?: string, to?: string) {
    return this.clickhouse.query(
      `
      SELECT
          toString(h.day)                  AS day,
          round(h.sohi, 1)                 AS sohi,
          round(h.sohi_low, 1)             AS sohiLow,
          round(h.sohi_high, 1)            AS sohiHigh,
          round(h.ecological_score, 1)     AS ecologicalScore,
          round(h.pressure_score, 1)       AS pressureScore,
          round(h.exposure_score, 1)       AS exposureScore,
          round(h.confidence, 3)           AS confidence,
          h.n_obs                          AS nObs,
          round(e.temp_mean_c, 1)          AS tempMeanC,
          round(e.precip_mm, 1)            AS precipMm,
          round(e.discharge_mean_m3s, 2)   AS dischargeM3s
      FROM site_health_daily AS h FINAL
      LEFT JOIN (SELECT * FROM site_env_daily FINAL) AS e
             ON e.site_id = h.site_id AND e.day = h.day
      WHERE h.site_id = {siteId:String}
        AND h.day >= {from:Date}
        AND h.day <= {to:Date}
      ORDER BY h.day ASC`,
      {
        siteId,
        from: from ?? '2000-01-01',
        to: to ?? '2100-01-01',
      },
    );
  }

  /**
   * Catchment rollup.
   *
   * Reports the worst site alongside the mean. A catchment mean alone is exactly
   * the kind of aggregate that hides the one reach that needs attention — five
   * healthy headwaters average away a collapsed urban culvert, and the number
   * that gets reported is the one that looks fine.
   */
  async getCatchmentSummary() {
    return this.clickhouse.query(`
      SELECT
          catchment                                     AS catchment,
          count()                                       AS siteCount,
          round(avg(sohi), 1)                           AS meanSohi,
          round(min(sohi), 1)                           AS worstSohi,
          argMin(site_id, sohi)                         AS worstSiteId,
          round(avg(confidence), 3)                     AS meanConfidence,
          sum(active_findings)                          AS activeFindings
      FROM (
          SELECT
              h.catchment                               AS catchment,
              h.site_id                                 AS site_id,
              h.sohi                                    AS sohi,
              h.confidence                              AS confidence,
              ifNull(f.n, 0)                            AS active_findings
          FROM site_health_overview AS h
          LEFT JOIN (
              SELECT site_id, count() AS n FROM findings_active GROUP BY site_id
          ) AS f ON f.site_id = h.site_id
      )
      GROUP BY catchment
      ORDER BY meanSohi ASC`);
  }

  /**
   * Recent measurements in real units, per site.
   *
   * The index is deliberately abstract; these are what make it explainable to a
   * non-specialist. "Turbidity 46 NTU" means nothing to a ten-year-old, but the
   * dashboard can turn it into "about as cloudy as tea with milk" — and it can
   * only do that honestly from the measured value, not from the composite score.
   */
  async getRecentMeasurements() {
    return this.clickhouse.query(`
      SELECT
          site_id                                AS siteId,
          toUInt32(countMerge(obs_count))        AS nObs,
          round(avgMerge(temp_avg), 1)           AS waterTempC,
          round(avgMerge(do_avg), 1)             AS dissolvedOxygenMgl,
          round(avgMerge(turbidity_avg), 0)      AS turbidityNtu,
          round(avgMerge(nitrate_avg), 1)        AS nitrateMgl,
          round(avgMerge(phosphate_avg), 2)      AS phosphateMgl,
          round(avgMerge(ph_avg), 1)             AS ph,
          round(avgMerge(litter_avg), 1)         AS litterScore,
          round(avgMerge(foam_rate), 2)          AS foamRate,
          round(avgMerge(sewage_odour_rate), 2)  AS sewageOdourRate
      FROM site_daily_metrics
      WHERE day > (SELECT max(day) FROM site_daily_metrics) - 14
      GROUP BY site_id
      ORDER BY site_id`);
  }

  /** Most recent date for which any index value exists, for the `asOf` field. */
  async getAsOf(): Promise<string | null> {
    const [row] = await this.clickhouse.query<{ asOf: string }>(
      'SELECT toString(max(day)) AS asOf FROM site_health_daily FINAL',
    );
    return row?.asOf ?? null;
  }
}
