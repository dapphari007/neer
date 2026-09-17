import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { SeedSite } from './sites';

/**
 * Environmental context from Open-Meteo.
 *
 * This is the one genuinely real dataset in the seed. Weather and hydrology come
 * from Open-Meteo's ERA5-backed historical archive and its GloFAS-backed flood
 * API — actual measurements for actual dates at actual coordinates, with no API
 * key and no registration.
 *
 * Two limitations are stated here rather than discovered later:
 *
 * **Licence.** Open-Meteo's free tier is explicitly non-commercial. Data is
 * CC-BY 4.0. A hackathon entry, academic work or a non-profit deployment
 * qualifies; a commercial product does not, and would need the paid tier.
 *
 * **Resolution.** The flood API is GloFAS at roughly 5 km. That is far too
 * coarse to represent an individual urban stream — a 3 km² catchment like
 * Ribeira dos Covões is a fraction of one grid cell. Discharge is therefore used
 * as a *catchment-scale hydrological covariate*, never as a reach discharge
 * value, and nothing in the product presents it as the latter.
 */

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FLOOD_URL = 'https://flood-api.open-meteo.com/v1/flood';
const CACHE_DIR = resolve(__dirname, '../../data/cache');

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

interface ArchiveResponse {
  hourly?: {
    time: string[];
    temperature_2m: (number | null)[];
    relative_humidity_2m: (number | null)[];
    precipitation: (number | null)[];
    wind_speed_10m: (number | null)[];
    shortwave_radiation: (number | null)[];
    soil_moisture_0_to_7cm: (number | null)[];
  };
}

interface FloodResponse {
  daily?: { time: string[]; river_discharge: (number | null)[] };
}

/**
 * Cache responses on disk.
 *
 * Seeding is re-run constantly during development, and every run would otherwise
 * refetch the same immutable historical window. Beyond being slow, that burns
 * quota against a free service for no benefit — the archive for a past date does
 * not change.
 */
async function cachedFetch<T>(url: string): Promise<T> {
  const key = createHash('sha256').update(url).digest('hex').slice(0, 32);
  const cachePath = join(CACHE_DIR, `${key}.json`);

  try {
    return JSON.parse(await readFile(cachePath, 'utf8')) as T;
  } catch {
    // Cache miss — fall through and fetch.
  }

  const response = await fetch(url, { headers: { 'User-Agent': 'neer-seed/0.1 (hackathon)' } });
  if (!response.ok) {
    throw new Error(`Open-Meteo request failed (${response.status}): ${url}`);
  }
  const body = (await response.json()) as T;

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath, JSON.stringify(body), 'utf8');
  return body;
}

/** Politeness delay between requests, well inside the 600/minute free-tier limit. */
const REQUEST_DELAY_MS = 250;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Derive antecedent-condition windows from an hourly precipitation series.
 *
 * These are the fields that let the insight engine reason about mechanism rather
 * than correlation. A dissolved-oxygen crash is ambiguous on its own; the same
 * crash 48 hours after 40 mm of rain that followed eleven dry days is a specific,
 * checkable hypothesis about a first-flush sewer spill.
 */
function deriveAntecedent(
  times: readonly string[],
  precipitation: readonly (number | null)[],
): {
  precip24h: number[];
  precip48h: number[];
  precip7d: number[];
  dryDaysBefore: number[];
} {
  const n = times.length;
  const precip24h = new Array<number>(n).fill(0);
  const precip48h = new Array<number>(n).fill(0);
  const precip7d = new Array<number>(n).fill(0);
  const dryDaysBefore = new Array<number>(n).fill(0);

  const windowSum = (endIndex: number, hours: number): number => {
    let sum = 0;
    for (let i = Math.max(0, endIndex - hours + 1); i <= endIndex; i++) {
      sum += precipitation[i] ?? 0;
    }
    return sum;
  };

  for (let i = 0; i < n; i++) {
    precip24h[i] = windowSum(i, 24);
    precip48h[i] = windowSum(i, 48);
    precip7d[i] = windowSum(i, 168);

    // Count back in whole days. A day counts as dry below 1 mm rather than at
    // exactly zero: trace precipitation does not wet a catchment or flush a
    // sewer, and treating 0.1 mm as "rain" would reset the counter constantly
    // and destroy the signal.
    let dryDays = 0;
    for (let day = 1; day <= 60; day++) {
      const dayEnd = i - (day - 1) * 24;
      const dayStart = dayEnd - 23;
      if (dayStart < 0) break;
      let dayTotal = 0;
      for (let h = dayStart; h <= dayEnd; h++) dayTotal += precipitation[h] ?? 0;
      if (dayTotal >= 1) break;
      dryDays++;
    }
    dryDaysBefore[i] = dryDays;
  }

  return { precip24h, precip48h, precip7d, dryDaysBefore };
}

export async function fetchEnvironmentalReadings(
  sites: readonly SeedSite[],
  startDate: string,
  endDate: string,
): Promise<EnvReadingRow[]> {
  const rows: EnvReadingRow[] = [];

  for (const [index, site] of sites.entries()) {
    const archiveUrl =
      `${ARCHIVE_URL}?latitude=${site.lat}&longitude=${site.lon}` +
      `&start_date=${startDate}&end_date=${endDate}` +
      '&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,' +
      'shortwave_radiation,soil_moisture_0_to_7cm&timezone=UTC';

    const archive = await cachedFetch<ArchiveResponse>(archiveUrl);
    await sleep(REQUEST_DELAY_MS);

    const floodUrl =
      `${FLOOD_URL}?latitude=${site.lat}&longitude=${site.lon}` +
      `&start_date=${startDate}&end_date=${endDate}&daily=river_discharge`;

    // Discharge is a nice-to-have covariate, not a requirement. GloFAS has gaps
    // and the flood API is occasionally unavailable; losing it should degrade
    // the seed, not abort it.
    let dischargeByDay = new Map<string, number | null>();
    try {
      const flood = await cachedFetch<FloodResponse>(floodUrl);
      if (flood.daily) {
        flood.daily.time.forEach((day, i) => {
          dischargeByDay.set(day, flood.daily!.river_discharge[i] ?? null);
        });
      }
    } catch (error) {
      console.warn(`  discharge unavailable for ${site.siteId}: ${String(error)}`);
      dischargeByDay = new Map();
    }
    await sleep(REQUEST_DELAY_MS);

    const hourly = archive.hourly;
    if (!hourly) {
      console.warn(`  no hourly data returned for ${site.siteId}`);
      continue;
    }

    const antecedent = deriveAntecedent(hourly.time, hourly.precipitation);

    hourly.time.forEach((timestamp, i) => {
      const day = timestamp.slice(0, 10);
      rows.push({
        site_id: site.siteId,
        recorded_at: timestamp.replace('T', ' ') + ':00',
        air_temp_c: hourly.temperature_2m[i] ?? null,
        relative_humidity: hourly.relative_humidity_2m[i] ?? null,
        precipitation_mm: hourly.precipitation[i] ?? null,
        wind_speed_ms: hourly.wind_speed_10m[i] ?? null,
        shortwave_rad_wm2: hourly.shortwave_radiation[i] ?? null,
        soil_moisture_frac: hourly.soil_moisture_0_to_7cm[i] ?? null,
        precip_24h_mm: antecedent.precip24h[i] ?? null,
        precip_48h_mm: antecedent.precip48h[i] ?? null,
        precip_7d_mm: antecedent.precip7d[i] ?? null,
        dry_days_before: antecedent.dryDaysBefore[i] ?? null,
        discharge_m3s: dischargeByDay.get(day) ?? null,
        source: 'open-meteo',
      });
    });

    console.log(
      `  [${index + 1}/${sites.length}] ${site.siteId} — ${hourly.time.length} hourly readings`,
    );
  }

  return rows;
}
