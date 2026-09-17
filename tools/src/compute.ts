import type { ClickHouseClient } from '@clickhouse/client';
import type { ObserverExperience, RuleContext, TaxonGroup } from '@neer/shared';
import { computeSohi, METHOD_VERSION, type SohiInputs } from '@neer/scoring';
import { evaluateRules, RULES } from '@neer/insights';
import { insertChunked } from './clickhouse';
import { SEED_SITES } from './sites';

/**
 * Batch scoring.
 *
 * Reads the daily rollups out of ClickHouse, runs each site-day through the pure
 * scoring and rule packages, and writes the results back. The database does
 * aggregation; TypeScript does science. Neither does the other's job, which is
 * what keeps the index reviewable by someone who will never read a SQL file.
 */

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
LEFT JOIN site_env_daily AS e ON e.site_id = m.site_id AND e.day = m.day
LEFT JOIN (
    SELECT site_id, toDate(observed_at) AS day,
           avg(toUInt8(flow_state IN ('stagnant', 'dry'))) AS stagnant_rate
    FROM observations
    GROUP BY site_id, day
) AS s ON s.site_id = m.site_id AND s.day = m.day
GROUP BY m.site_id, m.day
ORDER BY m.site_id, m.day`;

const TAXA_QUERY = `
SELECT
    site_id,
    toString(toDate(observed_at))           AS day,
    groupUniqArrayArray(taxa_groups)        AS groups,
    groupArrayArray(taxa_abundance)         AS abundance
FROM observations
WHERE notEmpty(taxa_groups)
GROUP BY site_id, toDate(observed_at)`;

const EXPERIENCE_QUERY = `
SELECT
    site_id,
    toString(toDate(observed_at))                  AS day,
    groupArray(toString(observer_experience))      AS experiences
FROM observations
GROUP BY site_id, toDate(observed_at)`;

/** Trailing mean over a numeric series, ignoring nulls. */
function trailingMean(values: readonly (number | null)[], endIndex: number, window: number): number | null {
  const start = Math.max(0, endIndex - window + 1);
  const present = values.slice(start, endIndex + 1).filter((v): v is number => v !== null);
  return present.length ? present.reduce((s, v) => s + v, 0) / present.length : null;
}

export async function computeHealthIndex(client: ClickHouseClient): Promise<void> {
  console.log('\nLoading daily rollups from ClickHouse');

  const [dailyResult, taxaResult, experienceResult] = await Promise.all([
    client.query({ query: DAILY_QUERY, format: 'JSONEachRow' }),
    client.query({ query: TAXA_QUERY, format: 'JSONEachRow' }),
    client.query({ query: EXPERIENCE_QUERY, format: 'JSONEachRow' }),
  ]);

  const daily = (await dailyResult.json()) as DailyRow[];
  const taxaRows = (await taxaResult.json()) as TaxaRow[];
  const experienceRows = (await experienceResult.json()) as ExperienceRow[];

  if (daily.length === 0) {
    console.log('No daily metrics found — run `seed` first.');
    return;
  }

  const taxaByKey = new Map(taxaRows.map((r) => [`${r.site_id}|${r.day}`, r]));
  const experienceByKey = new Map(experienceRows.map((r) => [`${r.site_id}|${r.day}`, r.experiences]));
  const siteById = new Map(SEED_SITES.map((s) => [s.siteId, s]));

  // Group by site so trends and observation gaps can be walked in order.
  const bySite = new Map<string, DailyRow[]>();
  for (const row of daily) {
    const rows = bySite.get(row.site_id) ?? [];
    rows.push(row);
    bySite.set(row.site_id, rows);
  }

  const healthRows: Record<string, unknown>[] = [];
  const findingRows: Record<string, unknown>[] = [];
  const now = new Date();

  for (const [siteId, rows] of bySite) {
    const site = siteById.get(siteId);
    if (!site) {
      console.warn(`  skipping unknown site ${siteId}`);
      continue;
    }

    const sohiSeries: (number | null)[] = [];
    let lastObservedIndex = -1;

    for (const [index, row] of rows.entries()) {
      const key = `${siteId}|${row.day}`;
      const taxa = taxaByKey.get(key);
      const experiences = (experienceByKey.get(key) ?? []) as ObserverExperience[];

      // Days since the previous day that actually carried observations. Rows
      // exist only for days with data, so the gap is a date difference rather
      // than an index difference.
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

      // Inter-observer disagreement from the t-digest spread: the 10–90 range
      // relative to the median. This is the agreement signal that a single
      // averaged value throws away.
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
      });

      // ─── Rules ──────────────────────────────────────────────────────────────
      const ma7 = trailingMean(sohiSeries, index, 7);
      const ma30 = trailingMean(sohiSeries, index, 30);
      const sohi30dAgo = index >= 30 ? sohiSeries[index - 30] : null;
      const sohi7dAgo = index >= 7 ? sohiSeries[index - 7] : null;

      const numeric = (v: number | null | undefined): number | null =>
        v === null || v === undefined || !Number.isFinite(v) ? null : v;

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
        ma7: { sohi: ma7 },
        ma30: {
          sohi: ma30,
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
          sohiDelta7d: sohi7dAgo !== null && sohi7dAgo !== undefined ? result.sohi - sohi7dAgo : null,
          sohiDelta30d:
            sohi30dAgo !== null && sohi30dAgo !== undefined ? result.sohi - sohi30dAgo : null,
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
        });
      }
    }
  }

  console.log(`Scoring ${healthRows.length.toLocaleString()} site-days across ${bySite.size} sites`);
  await client.command({ query: 'TRUNCATE TABLE IF EXISTS site_health_daily' });
  await insertChunked(client, 'site_health_daily', healthRows);

  console.log(`Writing ${findingRows.length.toLocaleString()} One Health findings`);
  await client.command({ query: 'TRUNCATE TABLE IF EXISTS findings' });
  if (findingRows.length > 0) {
    await insertChunked(client, 'findings', findingRows);
  }

  const summary = await client.query({
    query: `
      SELECT
          status,
          count()                    AS site_days,
          round(avg(sohi), 1)        AS mean_sohi,
          round(avg(confidence), 2)  AS mean_confidence
      FROM site_health_daily
      GROUP BY status
      ORDER BY mean_sohi DESC`,
    format: 'JSONEachRow',
  });
  console.table(await summary.json());

  const ruleSummary = await client.query({
    query: `
      SELECT rule_id, severity, count() AS n
      FROM findings
      GROUP BY rule_id, severity
      ORDER BY n DESC
      LIMIT 20`,
    format: 'JSONEachRow',
  });
  console.table(await ruleSummary.json());
}
