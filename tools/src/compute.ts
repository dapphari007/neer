import type { ClickHouseClient } from '@clickhouse/client';
import { scoreSites } from '@neer/pipeline';

/**
 * Batch scoring — every site, from scratch.
 *
 * The scoring itself lives in @neer/pipeline so this and the API's incremental
 * path are the same function. This wrapper adds only what a batch run wants:
 * truncate first, print a summary after.
 */
export async function computeHealthIndex(client: ClickHouseClient): Promise<void> {
  console.log('\nScoring every site from the daily rollups');
  await scoreSites(client, { truncate: true, log: (m) => console.log(`  ${m}`) });

  const summary = await client.query({
    query: `
      SELECT status, count() AS sites, round(avg(sohi), 1) AS mean_sohi, round(avg(confidence), 2) AS mean_confidence
      FROM site_health_current FINAL
      GROUP BY status ORDER BY mean_sohi DESC`,
    format: 'JSONEachRow',
  });
  console.table(await summary.json());

  const rules = await client.query({
    query: `SELECT rule_id, severity, count() AS n FROM findings_active GROUP BY rule_id, severity ORDER BY n DESC LIMIT 12`,
    format: 'JSONEachRow',
  });
  console.table(await rules.json());
}
