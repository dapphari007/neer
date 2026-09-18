import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ClickHouseClient } from '@clickhouse/client';

/**
 * Static demo export.
 *
 * Dumps the already-aggregated rollups to JSON so the dashboard can run with no
 * backend at all.
 *
 * The reason this exists is cost. Hosting ClickHouse and an always-on API
 * publicly costs real money, and the free tiers that do not cost money sleep
 * after fifteen minutes and take the better part of a minute to wake — which is
 * precisely the experience a judge following a submission link would get. Since
 * the rollups for twelve sites over six months compress to a few hundred
 * kilobytes, the dashboard can read them as static files from any CDN, forever,
 * for nothing.
 *
 * The full ClickHouse and NestJS stack remains the real architecture and runs
 * with one command. This is a second adapter behind the same interface, not a
 * replacement for it — and nothing in the exported data is fabricated for the
 * demo, it is the same computed output the API serves.
 */

const OUTPUT_DIR = resolve(__dirname, '../../apps/web/public/data');

interface ExportSpec {
  readonly file: string;
  readonly query: string;
  readonly description: string;
}

const EXPORTS: readonly ExportSpec[] = [
  {
    file: 'sites.json',
    description: 'Site dimension with current headline score',
    query: `
      SELECT
          s.site_id                        AS siteId,
          s.name                           AS name,
          s.catchment                      AS catchment,
          s.city                           AS city,
          s.country                        AS country,
          s.lat                            AS lat,
          s.lon                            AS lon,
          toString(s.urban_class)          AS urbanClass,
          s.impervious_pct                 AS imperviousPct,
          s.combined_sewer                 AS combinedSewer,
          s.recreational_access            AS recreationalAccess,
          s.nearest_contact_m              AS nearestContactM,
          s.population_within_1km          AS populationWithin1km,
          s.stream_order                   AS streamOrder,
          s.upstream_area_km2              AS upstreamAreaKm2,
          toString(s.source)               AS source,
          s.region                         AS region,
          s.provider                       AS provider,
          h.sohi                           AS sohi,
          toString(h.status)               AS status,
          h.confidence                     AS confidence,
          h.sohi_low                       AS sohiLow,
          h.sohi_high                      AS sohiHigh,
          h.ecological_score               AS ecologicalScore,
          h.pressure_score                 AS pressureScore,
          h.exposure_score                 AS exposureScore,
          h.days_since_last_obs            AS daysSinceLastObs,
          toString(h.as_of)                AS asOf
      FROM sites AS s FINAL
      LEFT JOIN (SELECT * FROM site_health_current FINAL) AS h ON h.site_id = s.site_id
      WHERE s.active = 1
      ORDER BY s.site_id`,
  },
  {
    file: 'trends.json',
    description: 'Daily index series per site, with environmental context',
    query: `
      SELECT
          h.site_id                        AS siteId,
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
      LEFT JOIN (SELECT * FROM site_env_daily FINAL) AS e ON e.site_id = h.site_id AND e.day = h.day
      ORDER BY h.site_id, h.day`,
  },
  {
    file: 'findings.json',
    description: 'Active One Health findings with evidence and audience-specific actions',
    query: `
      SELECT
          f.finding_id                     AS findingId,
          f.site_id                        AS siteId,
          toString(f.day)                  AS day,
          f.rule_id                        AS ruleId,
          f.site_name                      AS siteName,
          f.catchment                      AS catchment,
          toString(f.domain)               AS domain,
          toString(f.severity)             AS severity,
          toString(f.confidence)           AS confidence,
          f.headline                       AS headline,
          f.mechanism                      AS mechanism,
          f.evidence                       AS evidence,
          f.metrics                        AS metrics,
          f.citations                      AS citations,
          f.action_citizen                 AS actionCitizen,
          f.action_municipal               AS actionMunicipal,
          f.action_health                  AS actionHealth,
          toString(f.detected_at)          AS detectedAt,
          toString(f.valid_until)          AS validUntil
      FROM findings_active AS f
      ORDER BY f.site_id, f.rule_id`,
  },
  {
    file: 'measurements.json',
    description: 'Trailing 14-day mean measurements per site, in real units',
    query: `
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
      ORDER BY site_id`,
  },
  {
    file: 'drivers.json',
    description: 'Latest score decomposition per site',
    query: `
      SELECT
          site_id                          AS siteId,
          toString(day)                    AS day,
          drivers                          AS drivers
      FROM site_health_daily FINAL
      WHERE (site_id, day) IN (
          SELECT site_id, max(day) FROM site_health_daily FINAL GROUP BY site_id
      )
      ORDER BY site_id`,
  },
];

export async function exportDemoData(client: ClickHouseClient): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  console.log(`\nExporting static demo data to ${OUTPUT_DIR}`);

  const manifest: Record<string, { rows: number; bytes: number; description: string }> = {};

  for (const spec of EXPORTS) {
    const result = await client.query({ query: spec.query, format: 'JSONEachRow' });
    const rows = await result.json();
    const json = JSON.stringify(rows);

    await writeFile(join(OUTPUT_DIR, spec.file), json, 'utf8');
    manifest[spec.file] = {
      rows: rows.length,
      bytes: json.length,
      description: spec.description,
    };
    console.log(
      `  ${spec.file.padEnd(16)} ${String(rows.length).padStart(7)} rows  ${(json.length / 1024).toFixed(0)} KB`,
    );
  }

  // The manifest carries the provenance disclosure with the data, so a static
  // deployment cannot end up presenting simulated observations without saying
  // so. The disclosure travels with the payload rather than depending on
  // whoever assembles the page remembering to add a footnote.
  await writeFile(
    join(OUTPUT_DIR, 'manifest.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        files: manifest,
        dataDisclosure: {
          observations: 'simulated',
          environmental: 'real',
          note:
            'Citizen observations are synthetic, generated by a documented physical model (see docs/DATA_SOURCES.md). ' +
            'Weather and hydrology are real measurements from Open-Meteo. Site locations are approximate representative ' +
            'points on real watercourses near Coimbra, Portugal. Nothing here describes the measured condition of any real stream.',
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  const totalBytes = Object.values(manifest).reduce((sum, m) => sum + m.bytes, 0);
  console.log(`  total ${(totalBytes / 1024).toFixed(0)} KB uncompressed`);
}
