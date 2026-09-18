import type { EnvReadingRow } from './rows';

/**
 * Open-Meteo — real weather and hydrology, no key, no registration.
 *
 * Two entry points against two Open-Meteo services:
 *
 *  · `fetchArchiveWeather` — the ERA5-backed historical archive, for seeding a
 *    long window once.
 *  · `fetchLiveWeather` — the forecast service with `past_days`, which carries
 *    the last week of observed hours plus today, refreshed hourly upstream.
 *    This is what keeps every site's environmental context current while the
 *    system runs.
 *
 * Both return the same row shape and both derive the antecedent windows
 * (24 h / 48 h / 7 d rainfall, consecutive dry days) that let the rule engine
 * reason about mechanism: an oxygen crash is ambiguous alone, and specific 48
 * hours after 40 mm of rain that followed eleven dry days.
 *
 * Licence: the free tier is non-commercial; data is CC-BY 4.0. A hackathon,
 * academic or non-profit deployment qualifies. A commercial one needs the paid
 * tier. Limits are 10,000 calls/day, 600/minute; the live refresh uses roughly
 * two calls per site per hour.
 */

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const FLOOD_URL = 'https://flood-api.open-meteo.com/v1/flood';
const HOURLY_VARS =
  'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,shortwave_radiation,soil_moisture_0_to_7cm';

export interface WeatherSite {
  siteId: string;
  lat: number;
  lon: number;
}

interface HourlyPayload {
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

interface FloodPayload {
  daily?: { time: string[]; river_discharge: (number | null)[] };
}

export type Fetcher = (url: string) => Promise<unknown>;

/** Default fetcher: plain fetch with a polite identifier and a timeout. */
export const defaultFetcher: Fetcher = async (url) => {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'neer/0.1 (stream health; hackathon)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Open-Meteo request failed (${response.status}): ${url}`);
  return response.json();
};

/**
 * Antecedent-condition windows from an hourly precipitation series.
 *
 * A day counts as dry below 1 mm rather than at exactly zero: trace
 * precipitation does not wet a catchment or flush a sewer, and treating 0.1 mm
 * as rain would reset the dry-day counter constantly and destroy the signal.
 */
export function deriveAntecedent(precipitation: readonly (number | null)[]): {
  precip24h: number[];
  precip48h: number[];
  precip7d: number[];
  dryDaysBefore: number[];
} {
  const n = precipitation.length;
  const precip24h = new Array<number>(n).fill(0);
  const precip48h = new Array<number>(n).fill(0);
  const precip7d = new Array<number>(n).fill(0);
  const dryDaysBefore = new Array<number>(n).fill(0);

  const windowSum = (endIndex: number, hours: number): number => {
    let sum = 0;
    for (let i = Math.max(0, endIndex - hours + 1); i <= endIndex; i++)
      sum += precipitation[i] ?? 0;
    return sum;
  };

  for (let i = 0; i < n; i++) {
    precip24h[i] = windowSum(i, 24);
    precip48h[i] = windowSum(i, 48);
    precip7d[i] = windowSum(i, 168);

    let dryDays = 0;
    for (let day = 1; day <= 60; day++) {
      const dayEnd = i - (day - 1) * 24;
      const dayStart = dayEnd - 23;
      if (dayStart < 0) break;
      let total = 0;
      for (let h = dayStart; h <= dayEnd; h++) total += precipitation[h] ?? 0;
      if (total >= 1) break;
      dryDays++;
    }
    dryDaysBefore[i] = dryDays;
  }

  return { precip24h, precip48h, precip7d, dryDaysBefore };
}

function toRows(
  siteId: string,
  hourly: NonNullable<HourlyPayload['hourly']>,
  dischargeByDay: Map<string, number | null>,
): EnvReadingRow[] {
  const antecedent = deriveAntecedent(hourly.precipitation);
  return hourly.time.map((timestamp, i) => ({
    site_id: siteId,
    recorded_at: `${timestamp.replace('T', ' ')}:00`,
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
    discharge_m3s: dischargeByDay.get(timestamp.slice(0, 10)) ?? null,
    source: 'open-meteo',
  }));
}

async function fetchDischarge(
  site: WeatherSite,
  startDate: string,
  endDate: string,
  fetcher: Fetcher,
): Promise<Map<string, number | null>> {
  const byDay = new Map<string, number | null>();
  try {
    const flood = (await fetcher(
      `${FLOOD_URL}?latitude=${site.lat}&longitude=${site.lon}&start_date=${startDate}&end_date=${endDate}&daily=river_discharge`,
    )) as FloodPayload;
    flood.daily?.time.forEach((day, i) => byDay.set(day, flood.daily!.river_discharge[i] ?? null));
  } catch {
    // Discharge is a covariate, not a requirement. GloFAS has gaps and the
    // flood service is occasionally unavailable; losing it degrades the data,
    // it must not abort the run.
  }
  return byDay;
}

/** Historical window for seeding. Rows are hourly; the caller inserts them. */
export async function fetchArchiveWeather(
  site: WeatherSite,
  startDate: string,
  endDate: string,
  fetcher: Fetcher = defaultFetcher,
): Promise<EnvReadingRow[]> {
  const archive = (await fetcher(
    `${ARCHIVE_URL}?latitude=${site.lat}&longitude=${site.lon}&start_date=${startDate}&end_date=${endDate}&hourly=${HOURLY_VARS}&timezone=UTC`,
  )) as HourlyPayload;
  if (!archive.hourly) return [];
  const discharge = await fetchDischarge(site, startDate, endDate, fetcher);
  return toRows(site.siteId, archive.hourly, discharge);
}

/**
 * Live window: the last `pastDays` of observed hours plus today.
 *
 * Seven days of history are requested even though only the newest hours are
 * new, because the antecedent windows need a week of context to be right — a
 * 7-day rainfall sum computed over 24 hours of data is silently wrong, not
 * missing. The table is a ReplacingMergeTree, so re-inserting the overlap is
 * an overwrite rather than a duplicate.
 */
export async function fetchLiveWeather(
  site: WeatherSite,
  pastDays = 7,
  fetcher: Fetcher = defaultFetcher,
): Promise<EnvReadingRow[]> {
  const forecast = (await fetcher(
    `${FORECAST_URL}?latitude=${site.lat}&longitude=${site.lon}&hourly=${HOURLY_VARS}&past_days=${pastDays}&forecast_days=1&timezone=UTC`,
  )) as HourlyPayload;
  if (!forecast.hourly) return [];

  // Only hours that have actually happened. The forecast service pads today to
  // midnight; storing forecast hours as readings would let the rule engine cite
  // rain that has not fallen yet.
  const nowIso = new Date().toISOString().slice(0, 13);
  const keep = forecast.hourly.time.map((t) => t.slice(0, 13) <= nowIso);
  const hourly = {
    time: forecast.hourly.time.filter((_, i) => keep[i]),
    temperature_2m: forecast.hourly.temperature_2m.filter((_, i) => keep[i]),
    relative_humidity_2m: forecast.hourly.relative_humidity_2m.filter((_, i) => keep[i]),
    precipitation: forecast.hourly.precipitation.filter((_, i) => keep[i]),
    wind_speed_10m: forecast.hourly.wind_speed_10m.filter((_, i) => keep[i]),
    shortwave_radiation: forecast.hourly.shortwave_radiation.filter((_, i) => keep[i]),
    soil_moisture_0_to_7cm: forecast.hourly.soil_moisture_0_to_7cm.filter((_, i) => keep[i]),
  };
  if (hourly.time.length === 0) return [];

  const startDate = hourly.time[0]!.slice(0, 10);
  const endDate = hourly.time.at(-1)!.slice(0, 10);
  const discharge = await fetchDischarge(site, startDate, endDate, fetcher);
  return toRows(site.siteId, hourly, discharge);
}
