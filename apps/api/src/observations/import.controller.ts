import { BadRequestException, Body, Controller, Post, Query } from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { insertRows, parseOahCsv, recordIngestRun, visitsToRows } from '@neer/pipeline';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { EventsService } from '../live/events.service';
import { LiveScoringService } from '../live/scoring.service';
import { envelope } from '../common/meta';

/**
 * Batch import in OneAquaHealth's own CSV vocabulary.
 *
 * The project's data platform collects field measurements against a fixed code
 * list (WTC, WDO_MG, WPH, WCON_US …). This endpoint accepts a CSV in that
 * format — the body is the file, `Content-Type: text/csv` — resolves each
 * site reference against Neer's sites, stores the visits and re-scores every
 * site touched. Batch and real-time arrive at the same table and are scored by
 * the same function; only the transport differs.
 *
 * `dryRun=1` parses and resolves without writing anything, and returns the
 * same report, so a coordinator can see exactly which columns and sites the
 * importer understood before committing a file.
 *
 * Site references are resolved in this order: an exact Neer site id, then the
 * provider reference recorded on a site, then a case-insensitive name match.
 * Anything that resolves to nothing is reported, never guessed at.
 */
@ApiTags('observations')
@Controller('api')
export class ImportController {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly events: EventsService,
    private readonly scoring: LiveScoringService,
  ) {}

  @Post('import/oah-csv')
  @ApiConsumes('text/csv')
  @ApiOperation({
    summary: 'Import a OneAquaHealth-format CSV of field measurements (text/csv body)',
  })
  async importCsv(@Body() body: unknown, @Query('dryRun') dryRun?: string) {
    const text = typeof body === 'string' ? body : '';
    if (!text.trim()) {
      throw new BadRequestException(
        'Send the CSV as the request body with Content-Type: text/csv.',
      );
    }
    if (text.length > 10_000_000) {
      throw new BadRequestException('CSV larger than 10 MB; split the file.');
    }

    const { visits, report } = parseOahCsv(text);
    if (report.problems.length > 0) {
      throw new BadRequestException(report.problems);
    }

    const sites = await this.clickhouse.query<{
      siteId: string;
      name: string;
      providerRef: string;
    }>('SELECT site_id AS siteId, name, provider_ref AS providerRef FROM sites FINAL');
    const byId = new Map(sites.map((s) => [s.siteId.toLowerCase(), s.siteId]));
    const byRef = new Map(
      sites.filter((s) => s.providerRef).map((s) => [s.providerRef.toLowerCase(), s.siteId]),
    );
    const byName = new Map(sites.map((s) => [s.name.toLowerCase(), s.siteId]));
    const resolve = (ref: string): string | null => {
      const key = ref.trim().toLowerCase();
      return byId.get(key) ?? byRef.get(key) ?? byName.get(key) ?? null;
    };

    const { rows, unresolved } = visitsToRows(visits, resolve);
    const siteIds = [...new Set(rows.map((r) => r.site_id))];
    const startedAt = new Date();

    if (dryRun === '1' || dryRun === 'true') {
      return envelope({
        dryRun: true,
        wouldImport: rows.length,
        siteIds,
        unresolvedSites: unresolved,
        report,
      });
    }

    let imported = 0;
    if (rows.length > 0) {
      imported = await insertRows(this.clickhouse.writer, 'observations', rows);
      this.events.emit({
        type: 'observations',
        siteIds,
        count: imported,
        at: new Date().toISOString(),
      });
      this.scoring.schedule(siteIds);
    }
    await recordIngestRun(this.clickhouse.writer, {
      source: 'oah-csv',
      startedAt,
      rows: imported,
      ok: true,
      detail: `${report.layout}; unknown codes: ${report.unknownCodes.join(',') || 'none'}; unresolved sites: ${unresolved.join(',') || 'none'}`,
    }).catch(() => {});

    return envelope({ dryRun: false, imported, siteIds, unresolvedSites: unresolved, report });
  }
}
