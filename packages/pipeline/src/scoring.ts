import type { ClickHouseClient } from '@clickhouse/client';
import type { ObserverExperience, RuleContext, TaxonGroup } from '@neer/shared';
import {
  aggregateSohi,
  classifySohi,
  computeSohi,
  confidenceBand,
  METHOD_VERSION,
  type SohiInputs,
  type SohiResult,
} from '@neer/scoring';
import { evaluateRules, RULES } from '@neer/insights';
import { insertRows, toClickHouseDateTime } from './rows';

/**
 * Per-site scoring against ClickHouse.
 *
 * Used two ways: the batch tool scores every site from scratch, and the API
 * re-scores one site the moment new observations land. Both go through this
 * one function so an incremental score can never drift from a batch score.
 *
 * The database aggregates; TypeScript does science. Rollups leave ClickHouse,
 * get scored by the pure packages, and results are written back.
 *
 * Re-scoring a site rewrites its rows. The result tables are ReplacingMergeTree
 * keyed on computed_at, so a rewritten day supersedes the old one at merge time
 * and readers use FINAL to see the winner before the merge happens. A batch run
 * truncates first; an incremental run must not, since it touches one site.
 */

export interface SiteRecord {
  siteId: string;
  name: string;
  catchment: string;
  urbanClass: string;
  combinedSewer: boolean;
  recreationalAccess: boolean;
  nearestContactM: number;
  populationWithin1km: number;
  imperviousPct: number;
  referenceDoMgl: number;
  referenceAspt: number;
  outfallCount: number;
  source: string;
  region: string;
}

interface DailyRow {
  site_id: string;
  day: string;
  n_obs: number;
  n_observers: number;
  experience_avg: number;
  temp_avg: number | null;
  ph_avg: number | null;
  do_avg: number | null;
  cond_avg: number | null;
  turbidity_avg: number | null;
  nitrate_avg: number | null;
  phosphate_avg: number | null;
  ammonium_avg: number | null;
  do_q: number[];
  litter_avg: number | null;
  riparian_avg: number | null;
  foam_rate: number | null;
  discharge_rate: number | null;
  sewage_odour_rate: number | null;
  algae_avg: number | null;
  stagnant_rate: number | null;
  temp_mean_c: number | null;
  temp_max_c: number | null;
  precip_mm: number | null;
  precip_48h_mm: number | null;
  precip_7d_mm: number | null;
  dry_days_before: number | null;
  discharge_mean_m3s: number | null;
}

interface TaxaRow {
  site_id: string;
  day: string;
  groups: string[];
  abundance: number[];
}

interface ExperienceRow {
  site_id: string;
  day: string;
  experiences: string[];
}

/** Window for the headline "current" score — matches the confidence model's density window. */
export const CURRENT_WINDOW_DAYS = 14;

const SITE_FILTER = `({siteIds:Array(String)} = [] OR site_id IN {siteIds:Array(String)})`;

export async function loadSites(
  client: ClickHouseClient,
  siteIds: string[] = [],
): Promise<SiteRecord[]> {
  const result = await client.query({
    query: `
      SELECT
          site_id                       AS siteId,
          name,
          catchment,
          toString(urban_class)         AS urbanClass,
          combined_sewer = 1            AS combinedSewer,
          recreational_access = 1       AS recreationalAccess,
          nearest_contact_m             AS nearestContactM,
          population_within_1km         AS populationWithin1km,
          impervious_pct                AS imperviousPct,
          reference_do_mgl              AS referenceDoMgl,
          reference_aspt                AS referenceAspt,
          outfall_count                 AS outfallCount,
          toString(source)              AS source,
          region
      FROM sites FINAL
      WHERE ${SITE_FILTER} AND active = 1
      ORDER BY site_id`,
    query_params: { siteIds },
    format: 'JSONEachRow',
  });
  return (await result.json()) as SiteRecord[];
}

const DAILY_QUERY = `
SELECT
    m.site_id                                          AS site_id,
    toString(m.day)                                    AS day,
    toUInt32(countMerge(m.obs_count))                  AS n_obs,
    toUInt32(uniqExactMerge(m.observer_count))         AS n_observers,
    avgMerge(m.experience_avg)                         AS experience_avg,
    avgMerge(m.temp_avg)                               AS temp_avg,
    avgMerge(m.ph_avg)                                 AS ph_avg,
    avgMerge(m.do_avg)                                 AS do_avg,
    avgMerge(m.cond_avg)                               AS cond_avg,
    avgMerge(m.turbidity_avg)                          AS turbidity_avg,
    avgMerge(m.nitrate_avg)                            AS nitrate_avg,
    avgMerge(m.phosphate_avg)                          AS phosphate_avg,
    avgMerge(m.ammonium_avg)                           AS ammonium_avg,
    quantilesTDigestMerge(0.1, 0.5, 0.9)(m.do_q)       AS do_q,
    avgMerge(m.litter_avg)                             AS litter_avg,
    avgMerge(m.riparian_avg)                           AS riparian_avg,
    avgMerge(m.foam_rate)                              AS foam_rate,
    avgMerge(m.discharge_rate)                         AS discharge_rate,
    avgMerge(m.sewage_odour_rate)                      AS sewage_odour_rate,
    avgMerge(m.algae_avg)                              AS algae_avg,
    any(s.stagnant_rate)                               AS stagnant_rate,
    any(e.temp_mean_c)                                 AS temp_mean_c,
    any(e.temp_max_c)                                  AS temp_max_c,
    any(e.precip_mm)                                   AS precip_mm,
    any(e.precip_48h_mm)                               AS precip_48h_mm,
    any(e.precip_7d_mm)                                AS precip_7d_mm,
    any(e.dry_days_before)                             AS dry_days_before,
    any(e.discharge_mean_m3s)                          AS discharge_mean_m3s
FROM site_daily_metrics AS m
LEFT JOIN (SELECT * FROM site_env_daily FINAL) AS e
       ON e.site_id = m.site_id AND e.day = m.day
LEFT JOIN (
    SELECT site_id, toDate(observed_at) AS day,
           avg(toUInt8(flow_state IN ('stagnant', 'dry'))) AS stagnant_rate
    FROM observations
    WHERE ${SITE_FILTER}
    GROUP BY site_id, day
) AS s ON s.site_id = m.site_id AND s.day = m.day
WHERE ${SITE_FILTER.replaceAll('site_id', 'm.site_id')}
GROUP BY m.site_id, m.day
ORDER BY m.site_id, m.day`;

const TAXA_QUERY = `
SELECT site_id, toString(toDate(observed_at)) AS day,
       groupUniqArrayArray(taxa_groups) AS groups,
       groupArrayArray(taxa_abundance)  AS abundance
FROM observations
WHERE notEmpty(taxa_groups) AND ${SITE_FILTER}
GROUP BY site_id, toDate(observed_at)`;

const EXPERIENCE_QUERY = `
SELECT site_id, toString(toDate(observed_at)) AS day,
       groupArray(toString(observer_experience)) AS experiences
FROM observations
WHERE ${SITE_FILTER}
GROUP BY site_id, toDate(observed_at)`;

function trailingMean(
  values: readonly (number | null)[],
  endIndex: number,
  window: number,
): number | null {
  const start = Math.max(0, endIndex - window + 1);
  const present = values.slice(start, endIndex + 1).filter((v): v is number => v !== null);
  return present.length ? present.reduce((s, v) => s + v, 0) / present.length : null;
}

const numeric = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v;

export interface ScoreOptions {
  /** Restrict to these sites; empty scores every site. */
  siteIds?: string[];
  /** Injected clock, so results are reproducible. */
  now?: Date;
  /** Batch mode: clear result tables first. Never for an incremental run. */
  truncate?: boolean;
  log?: (message: string) => void;
}

export interface ScoreSummary {
  sites: number;
  siteDays: number;
  findings: number;
}

export async function scoreSites(
  client: ClickHouseClient,
  options: ScoreOptions = {},
): Promise<ScoreSummary> {
  const siteIds = options.siteIds ?? [];
  const now = options.now ?? new Date();
  const log = options.log ?? (() => {});
  const params = { siteIds };

  const [sites, dailyResult, taxaResult, experienceResult] = await Promise.all([
    loadSites(client, siteIds),
    client.query({ query: DAILY_QUERY, query_params: params, format: 'JSONEachRow' }),
    client.query({ query: TAXA_QUERY, query_params: params, format: 'JSONEachRow' }),
    client.query({ query: EXPERIENCE_QUERY, query_params: params, format: 'JSONEachRow' }),
  ]);

  const daily = (await dailyResult.json()) as DailyRow[];
  const taxaByKey = new Map(
    ((await taxaResult.json()) as TaxaRow[]).map((r) => [`${r.site_id}|${r.day}`, r]),
  );
  const experienceByKey = new Map(
    ((await experienceResult.json()) as ExperienceRow[]).map((r) => [
      `${r.site_id}|${r.day}`,
      r.experiences,
    ]),
  );
  const siteById = new Map(sites.map((s) => [s.siteId, s]));

  if (daily.length === 0) {
    log('No daily metrics for the requested sites.');
    return { sites: 0, siteDays: 0, findings: 0 };
  }

  const bySite = new Map<string, DailyRow[]>();
  for (const row of daily) {
    const rows = bySite.get(row.site_id) ?? [];
    rows.push(row);
    bySite.set(row.site_id, rows);
  }

  // Staleness is measured against the newest day anywhere in the dataset, not
  // against each site's own last visit — measured per site it is always zero.
  const datasetLatestDay = daily.reduce(
    (latest, r) => (r.day > latest ? r.day : latest),
    daily[0]!.day,
  );

  const healthRows: Record<string, unknown>[] = [];
  const currentRows: Record<string, unknown>[] = [];
  const findingRows: Record<string, unknown>[] = [];

  for (const [siteId, rows] of bySite) {
    const site = siteById.get(siteId);
    if (!site) continue;

    const sohiSeries: (number | null)[] = [];
    const scored: Array<{ day: string; result: SohiResult; nObs: number; nObservers: number }> = [];
    let lastObservedIndex = -1;

    for (const [index, row] of rows.entries()) {
      const key = `${siteId}|${row.day}`;
      const taxa = taxaByKey.get(key);
      const experiences = (experienceByKey.get(key) ?? []) as ObserverExperience[];

      const daysSinceLastObs =
        lastObservedIndex >= 0
          ? Math.round(
              (Date.parse(row.day) - Date.parse(rows[lastObservedIndex]!.day)) / 86_400_000,
            )
          : 0;
      if (row.n_obs > 0) lastObservedIndex = index;

      const measurements = [
        { parameter: 'dissolvedOxygenMgl', value: row.do_avg },
        { parameter: 'ph', value: row.ph_avg },
        { parameter: 'nitrateMgl', value: row.nitrate_avg },
        { parameter: 'phosphateMgl', value: row.phosphate_avg },
        { parameter: 'ammoniumMgl', value: row.ammonium_avg },
        { parameter: 'turbidityNtu', value: row.turbidity_avg },
        { parameter: 'conductivityUscm', value: row.cond_avg },
        { parameter: 'waterTempC', value: row.temp_avg },
      ].filter((m): m is { parameter: string; value: number } => m.value !== null);

      const [q10, q50, q90] = row.do_q ?? [];
      const measurementCv =
        row.n_observers > 1 && q50 && q50 > 0 && q10 !== undefined && q90 !== undefined
          ? Math.abs(q90 - q10) / (2 * q50)
          : null;

      const consecutiveHotDays = rows
        .slice(Math.max(0, index - 10), index + 1)
        .reduce((count, r) => ((r.temp_max_c ?? 0) >= 25 ? count + 1 : 0), 0);

      const inputs: SohiInputs = {
        siteId,
        day: row.day,
        ecological: {
          measurements,
          taxaGroups: (taxa?.groups ?? []) as TaxonGroup[],
          taxaAbundance: taxa?.abundance ?? [],
          referenceAspt: site.referenceAspt,
        },
        pressure: {
          litterScore: row.litter_avg,
          foamRate: row.foam_rate,
          surfaceFilmRate: null,
          visibleDischargeRate: row.discharge_rate,
          qbr: null,
          riparianScore: row.riparian_avg,
          imperviousPct: site.imperviousPct,
          outfallCount: site.outfallCount,
          invasivePlantsPresent: null,
        },
        exposure: {
          combinedSewer: site.combinedSewer,
          recreationalAccess: site.recreationalAccess,
          nearestContactM: site.nearestContactM,
          populationWithin1km: site.populationWithin1km,
          imperviousPct: site.imperviousPct,
          outfallCount: site.outfallCount,
          sewageOdourRate: row.sewage_odour_rate,
          visibleDischargeRate: row.discharge_rate,
          turbidityNtu: row.turbidity_avg,
          algaeCoverPct: row.algae_avg,
          scumPresent: (row.algae_avg ?? 0) >= 60,
          phosphateMgl: row.phosphate_avg,
          waterTempC: row.temp_avg,
          dissolvedOxygenMgl: row.do_avg,
          stagnantFraction: row.stagnant_rate,
          litterScore: row.litter_avg,
          precip48hMm: row.precip_48h_mm,
          dryDaysBefore: row.dry_days_before,
          consecutiveHotDays,
        },
        confidence: {
          parametersPresent: measurements.length,
          parametersExpected: 8,
          nObs: row.n_obs,
          nObservers: row.n_observers,
          daysSinceLastObs,
          observerExperience: experiences,
          measurementCv,
          hasBiology: (taxa?.groups.length ?? 0) > 0,
        },
      };

      const result = computeSohi(inputs);
      sohiSeries.push(result.sohi);
      scored.push({ day: row.day, result, nObs: row.n_obs, nObservers: row.n_observers });

      healthRows.push({
        site_id: siteId,
        day: row.day,
        sohi: result.sohi,
        status: result.status,
        ecological_score: result.ecologicalScore,
        pressure_score: result.pressureScore,
        exposure_score: result.exposureScore,
        confidence: result.confidence.overall,
        sohi_low: result.sohiLow,
        sohi_high: result.sohiHigh,
        completeness: result.confidence.completeness,
        density_score: result.confidence.density,
        recency_score: result.confidence.recency,
        observer_weight: result.confidence.observerWeight,
        agreement_score: result.confidence.agreement,
        n_obs: row.n_obs,
        n_observers: row.n_observers,
        days_since_last_obs: daysSinceLastObs,
        drivers: result.drivers
          .slice(0, 8)
          .map((d) => [d.label, Number(d.contribution.toFixed(2))] as [string, number]),
        method_version: METHOD_VERSION,
        computed_at: toClickHouseDateTime(now),
      });

      const sohi30dAgo = index >= 30 ? sohiSeries[index - 30] : null;
      const sohi7dAgo = index >= 7 ? sohiSeries[index - 7] : null;

      const ctx: RuleContext = {
        siteId,
        day: row.day,
        site: {
          name: site.name,
          catchment: site.catchment,
          urbanClass: site.urbanClass,
          combinedSewer: site.combinedSewer,
          recreationalAccess: site.recreationalAccess,
          nearestContactM: site.nearestContactM,
          populationWithin1km: site.populationWithin1km,
          imperviousPct: site.imperviousPct,
          referenceDoMgl: site.referenceDoMgl,
        },
        current: {
          dissolvedOxygenMgl: numeric(row.do_avg),
          waterTempC: numeric(row.temp_avg),
          ph: numeric(row.ph_avg),
          nitrateMgl: numeric(row.nitrate_avg),
          phosphateMgl: numeric(row.phosphate_avg),
          ammoniumMgl: numeric(row.ammonium_avg),
          turbidityNtu: numeric(row.turbidity_avg),
          conductivityUscm: numeric(row.cond_avg),
          litterScore: numeric(row.litter_avg),
          sewageOdourRate: numeric(row.sewage_odour_rate),
          visibleDischargeRate: numeric(row.discharge_rate),
          algaeCoverPct: numeric(row.algae_avg),
          stagnantFraction: numeric(row.stagnant_rate),
          outfallCount: site.outfallCount,
          aspt: result.detail.ecological.biotic.aspt,
          tolerantDominance: result.detail.ecological.biotic.tolerantDominance,
        },
        ma7: { sohi: trailingMean(sohiSeries, index, 7) },
        ma30: {
          sohi: trailingMean(sohiSeries, index, 30),
          phosphateMgl: trailingMean(
            rows.map((r) => r.phosphate_avg),
            index,
            30,
          ),
        },
        env: {
          tempMeanC: numeric(row.temp_mean_c),
          tempMaxC: numeric(row.temp_max_c),
          precipMm: numeric(row.precip_mm),
          precip48hMm: numeric(row.precip_48h_mm),
          precip7dMm: numeric(row.precip_7d_mm),
          dryDaysBefore: numeric(row.dry_days_before),
          dischargeM3s: numeric(row.discharge_mean_m3s),
          consecutiveHotDays,
        },
        health: {
          sohi: result.sohi,
          ecologicalScore: result.ecologicalScore,
          pressureScore: result.pressureScore,
          exposureScore: result.exposureScore,
          confidence: result.confidence.overall,
          sohiDelta7d: sohi7dAgo != null ? result.sohi - sohi7dAgo : null,
          sohiDelta30d: sohi30dAgo != null ? result.sohi - sohi30dAgo : null,
        },
        nObs: row.n_obs,
        daysSinceLastObs,
      };

      for (const finding of evaluateRules(ctx, RULES, { now })) {
        findingRows.push({
          finding_id: finding.findingId,
          site_id: finding.siteId,
          day: finding.day,
          rule_id: finding.ruleId,
          rule_version: finding.ruleVersion,
          domain: finding.domain,
          severity: finding.severity,
          confidence: finding.confidence,
          headline: finding.headline,
          mechanism: finding.mechanism,
          evidence: finding.evidence,
          metrics: finding.metrics,
          citations: finding.citations,
          action_citizen: finding.actions.citizen,
          action_municipal: finding.actions.municipal,
          action_health: finding.actions.health,
          detected_at: finding.detectedAt.slice(0, 19).replace('T', ' '),
          valid_until: finding.validUntil.slice(0, 19).replace('T', ' '),
          computed_at: toClickHouseDateTime(now),
        });
      }
    }

    // ─── Trailing-window headline ───────────────────────────────────────────
    // Sub-indices are averaged over the window and re-aggregated through the
    // same geometric mean the daily scores use. Averaging composites would let
    // one catastrophic day be diluted by good ones — the masking the geometric
    // mean exists to prevent.
    if (scored.length > 0) {
      const latestDay = scored.at(-1)!.day;
      const windowStart = new Date(Date.parse(latestDay) - CURRENT_WINDOW_DAYS * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const window = scored.filter((entry) => entry.day > windowStart);
      const mean = (pick: (r: SohiResult) => number): number =>
        window.reduce((sum, entry) => sum + pick(entry.result), 0) / window.length;

      const subIndices = {
        ecological: mean((r) => r.ecologicalScore),
        pressure: mean((r) => r.pressureScore),
        exposure: mean((r) => r.exposureScore),
      };
      const sohi = aggregateSohi(subIndices);
      const confidence = mean((r) => r.confidence.overall);
      const band = confidenceBand(sohi, confidence);
      const latest = window.at(-1)!;

      currentRows.push({
        site_id: siteId,
        as_of: latestDay,
        window_start: windowStart,
        window_days: CURRENT_WINDOW_DAYS,
        sohi,
        status: classifySohi(sohi),
        ecological_score: subIndices.ecological,
        pressure_score: subIndices.pressure,
        exposure_score: subIndices.exposure,
        confidence,
        sohi_low: band.low,
        sohi_high: band.high,
        n_obs: window.reduce((sum, entry) => sum + entry.nObs, 0),
        n_observers: Math.max(...window.map((entry) => entry.nObservers)),
        days_since_last_obs: Math.max(
          0,
          Math.round((Date.parse(datasetLatestDay) - Date.parse(latestDay)) / 86_400_000),
        ),
        drivers: latest.result.drivers
          .slice(0, 8)
          .map((d) => [d.label, Number(d.contribution.toFixed(2))] as [string, number]),
        method_version: METHOD_VERSION,
        computed_at: toClickHouseDateTime(now),
      });
    }
  }

  if (options.truncate) {
    await client.command({ query: 'TRUNCATE TABLE IF EXISTS site_health_daily' });
    await client.command({ query: 'TRUNCATE TABLE IF EXISTS site_health_current' });
    await client.command({ query: 'TRUNCATE TABLE IF EXISTS findings' });
  }

  await insertRows(client, 'site_health_daily', healthRows);
  await insertRows(client, 'site_health_current', currentRows);
  if (findingRows.length > 0) await insertRows(client, 'findings', findingRows);

  log(
    `Scored ${healthRows.length.toLocaleString()} site-days across ${bySite.size} site(s); ${findingRows.length.toLocaleString()} findings`,
  );
  return { sites: bySite.size, siteDays: healthRows.length, findings: findingRows.length };
}
