import type { ClickHouseClient } from '@clickhouse/client';
import { SEED_SITES, type SeedSite } from './sites';
import { generateVisit, Rng, type DayContext } from './simulate';

/**
 * The field crew — a simulated volunteer network that keeps posting.
 *
 * Every `intervalMs` it picks a Coimbra site (busier sites more often), asks
 * ClickHouse for that site's latest REAL weather, generates one observation
 * from the same physical model the seed uses, and POSTs it to the API exactly
 * as a phone app would. The API validates it, stores it, re-scores the site and
 * pushes an event to every open dashboard — so the live path is exercised end
 * to end by traffic that looks like the real thing.
 *
 * These observations are simulated, are tagged `neer-field-crew`, and land only
 * on sites whose `source` is `simulated`. The real sensor sites are never
 * touched by this process.
 */

export interface LiveOptions {
  apiUrl: string;
  intervalMs: number;
  client: ClickHouseClient;
}

interface EnvDailyRow {
  day: string;
  temp_mean_c: number | null;
  temp_max_c: number | null;
  precip_mm: number | null;
  precip_48h_mm: number | null;
  dry_days_before: number | null;
  discharge_mean_m3s: number | null;
}

async function latestContext(client: ClickHouseClient, siteId: string): Promise<DayContext> {
  const result = await client.query({
    query: `
      SELECT toString(day) AS day, temp_mean_c, temp_max_c, precip_mm, precip_48h_mm, dry_days_before, discharge_mean_m3s
      FROM site_env_daily FINAL
      WHERE site_id = {siteId:String}
      ORDER BY day DESC
      LIMIT 1`,
    query_params: { siteId },
    format: 'JSONEachRow',
  });
  const [row] = (await result.json()) as EnvDailyRow[];
  const today = new Date().toISOString().slice(0, 10);
  return {
    day: today,
    tempMeanC: row?.temp_mean_c ?? 15,
    tempMaxC: row?.temp_max_c ?? 18,
    precipMm: row?.precip_mm ?? 0,
    precip48hMm: row?.precip_48h_mm ?? 0,
    dryDaysBefore: row?.dry_days_before ?? 2,
    dischargeM3s: row?.discharge_mean_m3s ?? null,
  };
}

/** Busier sites are visited more often — the same weighting the seed uses. */
function pickSite(rng: Rng, sites: readonly SeedSite[]): SeedSite {
  const total = sites.reduce((s, site) => s + site.samplingIntensity, 0);
  let roll = rng.float(0, total);
  for (const site of sites) {
    roll -= site.samplingIntensity;
    if (roll <= 0) return site;
  }
  return sites[sites.length - 1]!;
}

export async function runFieldCrew(options: LiveOptions): Promise<never> {
  const rng = Rng.seeded(Date.now() % 2_147_483_647);
  const observers = new Map(
    SEED_SITES.map((site) => [
      site.siteId,
      Array.from({ length: 6 }, (_, i) => ({
        id: `${site.siteId}-OBS-${String(i + 1).padStart(2, '0')}`,
        experience: rng.pick([
          'novice',
          'novice',
          'novice',
          'trained',
          'trained',
          'expert',
        ] as const),
      })),
    ]),
  );

  console.log(`Field crew reporting to ${options.apiUrl} every ${options.intervalMs / 1000}s`);

  for (;;) {
    const site = pickSite(rng, SEED_SITES);
    try {
      const ctx = await latestContext(options.client, site.siteId);
      const row = generateVisit(site, ctx, rng, observers.get(site.siteId)!, 'neer-field-crew');

      const response = await fetch(`${options.apiUrl}/api/observations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          observations: [
            {
              siteId: row.site_id,
              observedAt: new Date().toISOString(),
              observerId: row.observer_id,
              observerExperience: row.observer_experience,
              method: row.method,
              source: row.source,
              photoCount: row.photo_count,
              waterTempC: row.water_temp_c,
              ph: row.ph,
              dissolvedOxygenMgl: row.dissolved_oxygen_mgl,
              conductivityUscm: row.conductivity_uscm,
              turbidityNtu: row.turbidity_ntu,
              nitrateMgl: row.nitrate_mgl,
              phosphateMgl: row.phosphate_mgl,
              ammoniumMgl: row.ammonium_mgl,
              waterColour: row.water_colour,
              odour: row.odour,
              foamPresent: row.foam_present === 1,
              surfaceFilm: row.surface_film === 1,
              litterScore: row.litter_score,
              algaeCoverPct: row.algae_cover_pct,
              flowState: row.flow_state,
              riparianScore: row.riparian_score,
              visibleDischarge: row.visible_discharge === 1,
              taxaGroups: row.taxa_groups,
              taxaAbundance: row.taxa_abundance,
              notes: '',
            },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });

      const body = (await response.json().catch(() => ({}))) as {
        accepted?: number;
        message?: unknown;
      };
      const stamp = new Date().toISOString().slice(11, 19);
      if (response.ok) {
        console.log(
          `${stamp}  ${site.siteId}  ${row.observer_experience.padEnd(7)}  DO ${row.dissolved_oxygen_mgl ?? '—'}  turb ${row.turbidity_ntu ?? '—'}  → accepted`,
        );
      } else {
        console.warn(
          `${stamp}  ${site.siteId}  rejected ${response.status}: ${JSON.stringify(body.message)}`,
        );
      }
    } catch (error) {
      console.warn(`field crew: ${error instanceof Error ? error.message : String(error)}`);
    }

    await new Promise((r) => setTimeout(r, options.intervalMs));
  }
}
