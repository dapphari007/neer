import type { ClickHouseClient } from '@clickhouse/client';

/**
 * Row shapes for the ClickHouse tables the pipeline writes, and one insert helper.
 *
 * Kept as plain snake_case records matching the DDL exactly, so an insert is a
 * JSONEachRow of these with no mapping layer in between — the mapping layer is
 * where column drift hides.
 */

export type SiteSource = 'simulated' | 'sensor' | 'citizen';

export interface SiteRow {
  site_id: string;
  name: string;
  catchment: string;
  water_body_code: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  elevation_m: number;
  stream_order: number;
  upstream_area_km2: number;
  urban_class: 'urban_core' | 'peri_urban' | 'semi_natural';
  impervious_pct: number;
  combined_sewer: 0 | 1;
  recreational_access: 0 | 1;
  nearest_contact_m: number;
  population_within_1km: number;
  reference_do_mgl: number;
  reference_cond_uscm: number;
  source: SiteSource;
  region: string;
  provider: string;
  provider_ref: string;
  outfall_count: number;
  reference_aspt: number;
  /** 0 = retired: history kept, hidden from the map and the overview. */
  active: 0 | 1;
}

export interface EnvReadingRow {
  site_id: string;
  recorded_at: string;
  air_temp_c: number | null;
  relative_humidity: number | null;
  precipitation_mm: number | null;
  wind_speed_ms: number | null;
  shortwave_rad_wm2: number | null;
  soil_moisture_frac: number | null;
  precip_24h_mm: number | null;
  precip_48h_mm: number | null;
  precip_7d_mm: number | null;
  dry_days_before: number | null;
  discharge_m3s: number | null;
  source: string;
}

export interface ObservationRow {
  observation_id: string;
  site_id: string;
  observed_at: string;
  observer_id: string;
  observer_experience: 'novice' | 'trained' | 'expert' | 'instrument';
  method: 'citizen_kit' | 'handheld_probe' | 'sensor' | 'lab';
  source: string;
  photo_count: number;
  water_temp_c: number | null;
  ph: number | null;
  dissolved_oxygen_mgl: number | null;
  conductivity_uscm: number | null;
  turbidity_ntu: number | null;
  nitrate_mgl: number | null;
  phosphate_mgl: number | null;
  ammonium_mgl: number | null;
  water_colour: 'clear' | 'slightly_turbid' | 'murky' | 'discoloured';
  odour: 'none' | 'earthy' | 'sewage' | 'chemical';
  foam_present: number;
  surface_film: number;
  litter_score: number;
  algae_cover_pct: number | null;
  flow_state: 'dry' | 'stagnant' | 'low' | 'normal' | 'high';
  riparian_score: number;
  visible_discharge: number;
  taxa_groups: string[];
  taxa_abundance: number[];
  notes: string;
}

/** Insert in chunks so a large batch does not become one enormous request body. */
export async function insertRows<T>(
  client: ClickHouseClient,
  table: string,
  rows: readonly T[],
  chunkSize = 5_000,
): Promise<number> {
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    await client.insert({ table, values: chunk, format: 'JSONEachRow' });
    inserted += chunk.length;
  }
  return inserted;
}

/** ClickHouse DateTime literal from a Date, second precision, UTC. */
export const toClickHouseDateTime = (date: Date): string =>
  date.toISOString().slice(0, 19).replace('T', ' ');

/** Record an ingest run, so freshness is a fact in the database rather than in a process's memory. */
export async function recordIngestRun(
  client: ClickHouseClient,
  run: { source: string; startedAt: Date; rows: number; ok: boolean; detail?: string },
): Promise<void> {
  await client.insert({
    table: 'ingest_runs',
    values: [
      {
        source: run.source,
        started_at: toClickHouseDateTime(run.startedAt),
        finished_at: toClickHouseDateTime(new Date()),
        rows_written: run.rows,
        ok: run.ok ? 1 : 0,
        detail: run.detail ?? '',
      },
    ],
    format: 'JSONEachRow',
  });
}
