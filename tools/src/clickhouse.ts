import { createClient, type ClickHouseClient } from '@clickhouse/client';

/**
 * ClickHouse client factory.
 *
 * Settings here are tuned for bulk seeding, which has a very different profile
 * from the API's read path: large multi-row inserts, no concurrency, and a
 * tolerance for latency that an interactive query does not have.
 */
export function createNeerClient(): ClickHouseClient {
  return createClient({
    url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
    username: process.env.CLICKHOUSE_USER ?? 'neer',
    password: process.env.CLICKHOUSE_PASSWORD ?? 'neer_local_dev',
    database: process.env.CLICKHOUSE_DATABASE ?? 'neer',
    request_timeout: 120_000,
    clickhouse_settings: {
      // Let the server batch small inserts rather than creating a part per
      // statement. Without this, seeding tens of thousands of rows produces
      // thousands of tiny parts and the merge backlog dominates runtime.
      async_insert: 1,
      wait_for_async_insert: 1,
      // Seeding is idempotent by design and re-runnable, so a partial batch on
      // error is recoverable — fail fast rather than silently dropping rows.
      input_format_skip_unknown_fields: 0,
    },
  });
}

/**
 * A client bound to no particular database.
 *
 * Needed for readiness probing and for creating the application database, both
 * of which have to work before that database exists.
 */
function createServerClient(): ClickHouseClient {
  return createClient({
    url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
    username: process.env.CLICKHOUSE_USER ?? 'neer',
    password: process.env.CLICKHOUSE_PASSWORD ?? 'neer_local_dev',
    database: 'default',
    request_timeout: 30_000,
  });
}

/**
 * Wait for ClickHouse to accept queries, then guarantee the database exists.
 *
 * Two distinct races are handled here, and both produce confusing failures if
 * they are not.
 *
 * **Readiness.** Compose's healthcheck reports the HTTP port open before the
 * server reliably answers DDL, so a seed run immediately after
 * `docker compose up` hits a window where connections succeed and statements
 * fail. Polling closes it.
 *
 * **Database existence.** The image's `CLICKHOUSE_DB` variable only takes effect
 * on *first* container initialisation. If the server crashes during that first
 * boot — a bad config value, say — the data volume survives, initialisation
 * never re-runs, and every later start comes up healthy with no application
 * database. The failure then surfaces as `UNKNOWN_DATABASE` from the migration
 * runner, pointing at the migrations rather than at the volume that is actually
 * at fault.
 *
 * Creating the database here makes the tooling independent of container init
 * state, so a reviewer never has to know that `docker compose down -v` is the
 * fix for a problem they should not have hit.
 */
export async function waitForClickHouse(
  client: ClickHouseClient,
  { attempts = 40, delayMs = 1_000 } = {},
): Promise<void> {
  const database = process.env.CLICKHOUSE_DATABASE ?? 'neer';
  const server = createServerClient();
  let lastError: unknown;

  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        // Drain each probe response. An unread stream makes the client warn and
        // can surface later as an uncaught ECONNRESET on socket teardown.
        await (await server.query({ query: 'SELECT 1', format: 'JSONEachRow' })).json();
        await server.command({ query: `CREATE DATABASE IF NOT EXISTS ${database}` });
        await (await client.query({ query: 'SELECT 1', format: 'JSONEachRow' })).json();
        if (attempt > 1) process.stdout.write('\n');
        return;
      } catch (error) {
        lastError = error;
        if (attempt === 1) process.stdout.write('waiting for ClickHouse');
        process.stdout.write('.');
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  } finally {
    await server.close();
  }

  process.stdout.write('\n');
  throw new Error(
    `ClickHouse did not become ready after ${attempts} attempts. Last error: ${String(lastError)}`,
  );
}

/** Insert rows in chunks, so a large seed does not build one enormous request body. */
export async function insertChunked<T>(
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
