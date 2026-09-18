import { readFile } from 'node:fs/promises';

/**
 * `neer-tools import <file.csv> [--dry-run]` — push a OneAquaHealth-format CSV
 * through the API's importer from the command line.
 *
 * Goes through the API rather than writing to ClickHouse directly so that the
 * command line, a browser upload and any future integration all take the same
 * path, with the same validation and the same re-scoring afterwards.
 */
export async function runImport(options: {
  apiUrl: string;
  file: string;
  dryRun: boolean;
}): Promise<void> {
  const text = await readFile(options.file, 'utf8');
  const url = `${options.apiUrl}/api/import/oah-csv${options.dryRun ? '?dryRun=1' : ''}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: text,
    signal: AbortSignal.timeout(120_000),
  });
  const payload = (await response.json()) as { data?: Record<string, unknown>; message?: unknown };

  if (!response.ok) {
    console.error(
      `Import rejected (${response.status}):`,
      JSON.stringify(payload.message, null, 2),
    );
    process.exitCode = 1;
    return;
  }

  const d = payload.data ?? {};
  const report = d.report as {
    layout: string;
    rowsRead: number;
    observations: number;
    unknownCodes: string[];
    ignoredCodes: string[];
    siteRefs: string[];
  };
  console.log(`${options.dryRun ? 'Dry run' : 'Imported'} — layout: ${report.layout}`);
  console.log(`  rows read:          ${report.rowsRead}`);
  console.log(`  visits parsed:      ${report.observations}`);
  console.log(
    `  ${options.dryRun ? 'would import' : 'imported'}:       ${d.wouldImport ?? d.imported}`,
  );
  console.log(`  sites touched:      ${(d.siteIds as string[]).join(', ') || 'none'}`);
  const unresolved = d.unresolvedSites as string[];
  if (unresolved.length)
    console.log(`  UNRESOLVED sites:   ${unresolved.join(', ')}  (not imported)`);
  if (report.unknownCodes.length)
    console.log(`  unknown codes:      ${report.unknownCodes.join(', ')}`);
  if (report.ignoredCodes.length)
    console.log(`  recorded, unused:   ${report.ignoredCodes.join(', ')}`);
}
