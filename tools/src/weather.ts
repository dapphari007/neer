import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  defaultFetcher,
  fetchArchiveWeather,
  type EnvReadingRow,
  type Fetcher,
} from '@neer/pipeline';
import type { SeedSite } from './sites';

/**
 * Seeding-time weather: the pipeline's archive fetch, behind an on-disk cache.
 *
 * Seeding is re-run constantly during development, and every run would
 * otherwise refetch the same immutable historical window — slow, and it burns
 * quota against a free service for no benefit. The archive for a past date does
 * not change, so caching it is safe. The live refresh in the API deliberately
 * does NOT use this cache; live data is the opposite of immutable.
 */

const CACHE_DIR = resolve(__dirname, '../../data/cache');

const cachedFetcher: Fetcher = async (url) => {
  const key = createHash('sha256').update(url).digest('hex').slice(0, 32);
  const cachePath = join(CACHE_DIR, `${key}.json`);
  try {
    return JSON.parse(await readFile(cachePath, 'utf8'));
  } catch {
    // miss
  }
  const body = await defaultFetcher(url);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath, JSON.stringify(body), 'utf8');
  return body;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchEnvironmentalReadings(
  sites: readonly SeedSite[],
  startDate: string,
  endDate: string,
): Promise<EnvReadingRow[]> {
  const rows: EnvReadingRow[] = [];
  for (const [index, site] of sites.entries()) {
    const siteRows = await fetchArchiveWeather(
      { siteId: site.siteId, lat: site.lat, lon: site.lon },
      startDate,
      endDate,
      cachedFetcher,
    );
    rows.push(...siteRows);
    console.log(
      `  [${index + 1}/${sites.length}] ${site.siteId} — ${siteRows.length} hourly readings`,
    );
    // Politeness delay, well inside the 600/minute free-tier limit.
    await sleep(250);
  }
  return rows;
}
