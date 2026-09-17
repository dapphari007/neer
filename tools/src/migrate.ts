import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ClickHouseClient } from '@clickhouse/client';

/**
 * Migration runner.
 *
 * Applies the numbered `.sql` files in `infra/clickhouse/migrations` in order.
 * Every statement in those files is written `CREATE ... IF NOT EXISTS`, so the
 * whole run is idempotent and re-running it after a partial failure is safe
 * rather than destructive.
 *
 * No migration-state table, deliberately. Tracking applied migrations buys
 * nothing while every statement is idempotent, and it adds a failure mode where
 * the tracking table and the actual schema disagree — which is worse than having
 * no tracking at all.
 */

const MIGRATIONS_DIR = resolve(__dirname, '../../infra/clickhouse/migrations');

/**
 * Split a file into statements on semicolons at end of line.
 *
 * The ClickHouse HTTP interface accepts one statement per request, so files have
 * to be split client-side. Splitting on a bare `;` would break on semicolons
 * inside string literals and comments; requiring end-of-line is enough for
 * hand-written DDL and avoids pulling in a SQL parser for the sake of one loop.
 */
function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*$/m)
    .map((statement) =>
      statement
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((statement) => statement.length > 0);
}

export async function runMigrations(client: ClickHouseClient): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  if (files.length === 0) {
    throw new Error(`No migration files found in ${MIGRATIONS_DIR}`);
  }

  console.log(`Applying ${files.length} migration file(s) from ${MIGRATIONS_DIR}`);

  for (const file of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const statements = splitStatements(sql);

    for (const [index, statement] of statements.entries()) {
      try {
        await client.command({ query: statement });
      } catch (error) {
        // Name the file and statement index. A bare ClickHouse syntax error
        // against an anonymous statement is close to useless when eight files
        // are being applied.
        throw new Error(
          `Migration failed in ${file}, statement ${index + 1}:\n` +
            `${statement.slice(0, 400)}\n\n${String(error)}`,
        );
      }
    }

    console.log(`  ${file} — ${statements.length} statement(s)`);
  }

  console.log('Migrations applied.');
}
