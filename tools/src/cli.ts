import { createNeerClient, insertChunked, waitForClickHouse } from './clickhouse';
import { runMigrations } from './migrate';
import { SEED_SITES } from './sites';
import { fetchEnvironmentalReadings } from './weather';
import { simulateObservations } from './simulate';
import { computeHealthIndex } from './compute';
import { exportDemoData } from './export-demo';

/**
 * Neer batch CLI.
 *
 * Commands are ordered as a pipeline and each is independently re-runnable:
 *
 *   migrate      apply the ClickHouse schema
 *   seed         load sites, fetch real weather, generate observations
 *   compute      score every site-day and derive findings
 *   export-demo  dump rollups to static JSON for the zero-cost public demo
 *   all          migrate → seed → compute → export-demo
 *
 * Every step is idempotent. Re-running `seed` replaces rather than duplicates,
 * which matters because the most common thing anyone does with a seed script is
 * run it twice.
 */

const DEFAULTS = {
  startDate: process.env.SEED_START_DATE ?? '2026-03-01',
  endDate: process.env.SEED_END_DATE ?? '2026-09-15',
  seed: Number(process.env.SEED_RANDOM_SEED ?? 20260918),
};

async function commandMigrate(): Promise<void> {
  const client = createNeerClient();
  try {
    await waitForClickHouse(client);
    await runMigrations(client);
  } finally {
    await client.close();
  }
}

async function commandSeed(): Promise<void> {
  const client = createNeerClient();

  try {
    await waitForClickHouse(client);

    // ─── Sites ───────────────────────────────────────────────────────────────
    console.log(`\nLoading ${SEED_SITES.length} sites (Coimbra, PT)`);
    await client.command({ query: 'TRUNCATE TABLE IF EXISTS sites' });
    await insertChunked(
      client,
      'sites',
      SEED_SITES.map((s) => ({
        site_id: s.siteId,
        name: s.name,
        catchment: s.catchment,
        water_body_code: s.waterBodyCode,
        city: s.city,
        country: s.country,
        lat: s.lat,
        lon: s.lon,
        elevation_m: s.elevationM,
        stream_order: s.streamOrder,
        upstream_area_km2: s.upstreamAreaKm2,
        urban_class: s.urbanClass,
        impervious_pct: s.imperviousPct,
        combined_sewer: s.combinedSewer ? 1 : 0,
        recreational_access: s.recreationalAccess ? 1 : 0,
        nearest_contact_m: s.nearestContactM,
        population_within_1km: s.populationWithin1km,
        reference_do_mgl: s.referenceDoMgl,
        reference_cond_uscm: s.referenceCondUscm,
      })),
    );

    // ─── Environmental context (real data) ───────────────────────────────────
    console.log(
      `\nFetching real weather and hydrology from Open-Meteo ` +
        `(${DEFAULTS.startDate} to ${DEFAULTS.endDate})`,
    );
    const envReadings = await fetchEnvironmentalReadings(
      SEED_SITES,
      DEFAULTS.startDate,
      DEFAULTS.endDate,
    );
    await client.command({ query: 'TRUNCATE TABLE IF EXISTS env_readings' });
    await client.command({ query: 'TRUNCATE TABLE IF EXISTS site_env_daily' });
    const envCount = await insertChunked(client, 'env_readings', envReadings);
    console.log(`  inserted ${envCount.toLocaleString()} hourly environmental readings`);

    // ─── Citizen observations (simulated) ────────────────────────────────────
    console.log('\nGenerating simulated citizen observations');
    console.log('  NOTE: these are synthetic. No real person recorded them.');
    const observations = simulateObservations({
      sites: SEED_SITES,
      envReadings,
      seed: DEFAULTS.seed,
    });
    await client.command({ query: 'TRUNCATE TABLE IF EXISTS observations' });
    await client.command({ query: 'TRUNCATE TABLE IF EXISTS site_daily_metrics' });
    const obsCount = await insertChunked(client, 'observations', observations);
    console.log(`  inserted ${obsCount.toLocaleString()} observations (seed ${DEFAULTS.seed})`);

    // Materialized views populate on insert, so summarise from the rollup to
    // prove the whole pipeline actually ran rather than just the insert.
    // -Merge combinators are themselves aggregate functions, so they cannot be
    // nested inside another aggregate. The per-day merge has to be finalised in
    // a subquery before it can be summed across days.
    const summary = await client.query({
      query: `
        SELECT
            count()                     AS site_days,
            sum(n_obs)                  AS observations,
            round(avg(do_mgl), 2)       AS mean_do_mgl
        FROM (
            SELECT
                site_id,
                day,
                countMerge(obs_count)   AS n_obs,
                avgMerge(do_avg)        AS do_mgl
            FROM site_daily_metrics
            GROUP BY site_id, day
        )`,
      format: 'JSONEachRow',
    });
    console.table(await summary.json());
  } finally {
    await client.close();
  }
}

async function commandCompute(): Promise<void> {
  const client = createNeerClient();
  try {
    await waitForClickHouse(client);
    await computeHealthIndex(client);
  } finally {
    await client.close();
  }
}

async function commandExportDemo(): Promise<void> {
  const client = createNeerClient();
  try {
    await waitForClickHouse(client);
    await exportDemoData(client);
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case 'migrate':
      await commandMigrate();
      break;
    case 'seed':
      await commandSeed();
      break;
    case 'compute':
      await commandCompute();
      break;
    case 'export-demo':
      await commandExportDemo();
      break;
    case 'all':
      await commandMigrate();
      await commandSeed();
      await commandCompute();
      await commandExportDemo();
      break;
    default:
      console.error(
        'Usage: neer-tools <migrate|seed|compute|export-demo|all>\n\n' +
          '  migrate      apply the ClickHouse schema\n' +
          '  seed         load sites, fetch real weather, generate observations\n' +
          '  compute      score every site-day and derive One Health findings\n' +
          '  export-demo  dump rollups to static JSON for the public demo\n' +
          '  all          run the full pipeline in order',
      );
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('\nFailed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
