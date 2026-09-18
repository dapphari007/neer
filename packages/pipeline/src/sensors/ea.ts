import { createHash } from 'node:crypto';
import type { ObservationRow, SiteRow } from '../rows';
import type { Fetcher } from '../weather';

/**
 * Environment Agency Hydrology API — real, official, real-time water quality.
 *
 * The EA runs sub-daily water-quality sondes on English rivers and publishes
 * their readings through a keyless open API at roughly fifteen-minute cadence:
 * dissolved oxygen, temperature, pH, conductivity, turbidity, ammonium and, at
 * a few sites, nitrate. This is the one layer of Neer where the observations
 * are REAL measurements of a REAL river, and every site it creates is marked
 * `source = 'sensor'` so the dashboard says so.
 *
 * Stations are discovered rather than hard-coded. Sondes are deployed for a
 * campaign and then moved, so a station that is live today may be silent next
 * month; asking "which measures have readings in the last 36 hours" finds the
 * ones that are actually reporting now.
 *
 * Honest limits, stated where they bite:
 *  · Catchment attributes the exposure rules want — combined sewer, outfall
 *    count, public access — are not published by this API. Sensor sites carry
 *    conservative defaults and the rules that need those inputs stay quiet
 *    there rather than guessing.
 *  · Ammonium is stored as reported; the API does not state whether it is
 *    expressed as NH₄ or as N.
 *  · Readings arrive flagged "Unchecked". They are what the instrument said,
 *    before the EA's own quality review.
 *
 * Licence: Open Government Licence v3. Attribution: "Contains Environment
 * Agency information © Environment Agency and database right".
 */

const BASE = 'https://environment.data.gov.uk/hydrology';

export const EA_PROPERTIES = [
  'dissolved-oxygen',
  'temperature',
  'ph',
  'conductivity',
  'turbidity',
  'ammonium',
  'nitrate',
] as const;
export type EaProperty = (typeof EA_PROPERTIES)[number];

export interface EaStation {
  id: string;
  label: string;
  name: string;
  river: string;
  lat: number;
  lon: number;
  /** property → measure id, e.g. 'dissolved-oxygen' → 'E01336A-do-i-subdaily-mgL' */
  measures: Partial<Record<EaProperty, string>>;
}

interface ReadingsPayload {
  items?: Array<{
    measure: { '@id': string } | string;
    dateTime: string;
    value: number | string;
    quality?: string;
  }>;
}

interface StationPayload {
  items?:
    | Array<{ label?: string; lat?: number; long?: number; riverName?: string }>
    | { label?: string; lat?: number; long?: number; riverName?: string };
}

export const eaFetcher: Fetcher = async (url) => {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'neer/0.1 (stream health; hackathon)', Accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`EA request failed (${response.status}): ${url}`);
  return response.json();
};

const measureId = (measure: { '@id': string } | string): string =>
  (typeof measure === 'string' ? measure : measure['@id']).split('/').pop() ?? '';

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/** "LEE_SPRINGFIELD PARK_K_201906" → { river: "Lee", place: "Springfield Park" } */
export function prettifyLabel(label: string): { river: string; place: string } {
  const title = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(ds|us)\b/g, (m) => (m === 'ds' ? 'downstream' : 'upstream'))
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  const parts = label
    .split('_')
    .map((p) => p.trim())
    .filter(Boolean);
  const river = title(parts[0] ?? label);
  const place = parts[1] ? title(parts[1]) : '';
  return { river, place };
}

/**
 * Find stations reporting now.
 *
 * One request per property, each returning the newest readings network-wide
 * since `sinceHours` ago; stations are ranked by how many properties they
 * currently report. Stations without dissolved oxygen are skipped — it is the
 * parameter the index leans on hardest, and a site that cannot say whether its
 * water holds oxygen cannot be scored honestly.
 */
export async function discoverLiveStations(
  options: { sinceHours?: number; minProperties?: number; limit?: number; fetcher?: Fetcher } = {},
): Promise<EaStation[]> {
  const { sinceHours = 36, minProperties = 4, limit = 6, fetcher = eaFetcher } = options;
  const since = isoDate(new Date(Date.now() - sinceHours * 3_600_000));
  const byStation = new Map<string, Partial<Record<EaProperty, string>>>();

  for (const property of EA_PROPERTIES) {
    const payload = (await fetcher(
      `${BASE}/data/readings?observedProperty=${property}&mineq-date=${since}&_limit=3000`,
    )) as ReadingsPayload;

    for (const item of payload.items ?? []) {
      const id = measureId(item.measure);
      const station = id.split('-')[0];
      if (!station) continue;
      const measures = byStation.get(station) ?? {};
      // Dissolved oxygen is published in both mg/L and % saturation; mg/L is the
      // unit the index uses, so it wins when both are present.
      if (!measures[property] || /mgL/i.test(id)) measures[property] = id;
      byStation.set(station, measures);
    }
  }

  const ranked = [...byStation.entries()]
    .filter(([, m]) => m['dissolved-oxygen'] && Object.keys(m).length >= minProperties)
    .sort((a, b) => Object.keys(b[1]).length - Object.keys(a[1]).length)
    .slice(0, limit);

  const stations: EaStation[] = [];
  for (const [id, measures] of ranked) {
    try {
      const meta = (await fetcher(`${BASE}/id/stations/${id}.json`)) as StationPayload;
      const item = Array.isArray(meta.items) ? meta.items[0] : meta.items;
      if (!item || typeof item.lat !== 'number' || typeof item.long !== 'number') continue;
      const label = item.label ?? id;
      const pretty = prettifyLabel(label);
      stations.push({
        id,
        label,
        name: pretty.place ? `${pretty.river} — ${pretty.place}` : pretty.river,
        river: item.riverName ?? pretty.river,
        lat: item.lat,
        lon: item.long,
        measures,
      });
    } catch {
      // A station whose metadata cannot be read cannot be placed on a map.
      // Skip it rather than inventing coordinates.
    }
  }
  return stations;
}

/** Site row for a discovered station. Unknown catchment attributes take conservative defaults. */
export function stationToSite(station: EaStation): SiteRow {
  return {
    site_id: `EA-${station.id}`,
    name: station.name,
    catchment: station.river,
    water_body_code: '',
    city: 'England',
    country: 'GB',
    lat: station.lat,
    lon: station.lon,
    elevation_m: 0,
    stream_order: 3,
    upstream_area_km2: 0,
    // Not published by the API. Neutral defaults, so the pressure sub-index
    // neither rewards nor penalises a station for attributes nobody measured.
    urban_class: 'peri_urban',
    impervious_pct: 30,
    combined_sewer: 0,
    recreational_access: 0,
    nearest_contact_m: 1000,
    population_within_1km: 5000,
    reference_do_mgl: 9,
    reference_cond_uscm: 400,
    source: 'sensor',
    region: 'England · live sensors',
    provider: 'ea-hydrology',
    provider_ref: station.id,
    outfall_count: 0,
    reference_aspt: 6,
    active: 1,
  };
}

/** Deterministic UUID for a station reading, so the same reading always gets the same id. */
function readingUuid(stationId: string, bucketIso: string): string {
  const hex = createHash('sha1').update(`${stationId}|${bucketIso}`).digest('hex');
  // RFC 4122 layout with version 5 and variant bits, from the first 32 hex chars.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Plausibility gates matching the ingestion schema; out-of-range readings become null, not errors. */
const RANGES: Record<EaProperty, [number, number]> = {
  temperature: [-5, 45],
  ph: [0, 14],
  'dissolved-oxygen': [0, 25],
  conductivity: [0, 20000],
  turbidity: [0, 4000],
  ammonium: [0, 100],
  nitrate: [0, 200],
};

/** Round to the nearest 15 minutes, so readings from separate sondes on one station line up. */
function bucket(dateTime: string): string {
  const date = new Date(dateTime.endsWith('Z') ? dateTime : `${dateTime}Z`);
  const ms = 15 * 60_000;
  return new Date(Math.round(date.getTime() / ms) * ms).toISOString();
}

/**
 * Fetch a station's readings newer than `since` and fold them into one
 * observation per 15-minute bucket.
 */
export async function fetchStationObservations(
  station: EaStation,
  since: Date | null,
  fetcher: Fetcher = eaFetcher,
): Promise<ObservationRow[]> {
  const from = since ?? new Date(Date.now() - 36 * 3_600_000);
  const buckets = new Map<string, Partial<Record<EaProperty, number>>>();

  for (const [property, id] of Object.entries(station.measures) as [EaProperty, string][]) {
    const payload = (await fetcher(
      `${BASE}/id/measures/${id}/readings?mineq-date=${isoDate(from)}&_limit=2000`,
    )) as ReadingsPayload;

    for (const item of payload.items ?? []) {
      const at = new Date(item.dateTime.endsWith('Z') ? item.dateTime : `${item.dateTime}Z`);
      if (at.getTime() <= from.getTime()) continue;
      const value = Number(item.value);
      if (!Number.isFinite(value)) continue;
      const [lo, hi] = RANGES[property];
      if (value < lo || value > hi) continue;
      const key = bucket(item.dateTime);
      const entry = buckets.get(key) ?? {};
      entry[property] = value;
      buckets.set(key, entry);
    }
  }

  const siteId = `EA-${station.id}`;
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([iso, v]) => ({
      observation_id: readingUuid(station.id, iso),
      site_id: siteId,
      observed_at: `${iso.slice(0, 19).replace('T', ' ')}.000`,
      observer_id: `EA-${station.id}`,
      observer_experience: 'instrument',
      method: 'sensor',
      source: 'ea-hydrology',
      photo_count: 0,
      water_temp_c: v.temperature ?? null,
      ph: v.ph ?? null,
      dissolved_oxygen_mgl: v['dissolved-oxygen'] ?? null,
      conductivity_uscm: v.conductivity ?? null,
      turbidity_ntu: v.turbidity ?? null,
      nitrate_mgl: v.nitrate ?? null,
      phosphate_mgl: null,
      ammonium_mgl: v.ammonium ?? null,
      // A sonde sees chemistry, not the bank. Visual fields stay at their
      // "nothing observed" defaults rather than being inferred from chemistry.
      water_colour: 'clear',
      odour: 'none',
      foam_present: 0,
      surface_film: 0,
      litter_score: 0,
      algae_cover_pct: null,
      flow_state: 'normal',
      riparian_score: 0,
      visible_discharge: 0,
      taxa_groups: [],
      taxa_abundance: [],
      notes: '',
    }));
}
