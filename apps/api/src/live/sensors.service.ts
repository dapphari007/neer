import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  discoverLiveStations,
  fetchStationObservations,
  insertRows,
  recordIngestRun,
  stationToSite,
  type EaStation,
} from '@neer/pipeline';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { EventsService } from './events.service';
import { LiveScoringService } from './scoring.service';

/**
 * Real sensor ingestion — Environment Agency sondes, discovered at runtime.
 *
 * On boot and every six hours the service asks the EA API which water-quality
 * sondes have reported in the last 36 hours and registers the best-covered
 * ones as sites with `source = 'sensor'`. Every ten minutes it pulls each
 * station's readings newer than the last one stored, folds them into
 * fifteen-minute observations, stores them and re-scores the station.
 *
 * "Newer than the last one stored" is what makes re-running safe: the
 * observations table is an append-only MergeTree, so idempotence has to come
 * from asking the database where it got to rather than from the table
 * deduplicating for us.
 *
 * Disabled with LIVE_SENSORS=off. LIVE_SENSOR_LIMIT sets how many stations to
 * follow (default 6).
 */
@Injectable()
export class SensorIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SensorIngestService.name);
  private stations: EaStation[] = [];
  private pollTimer: NodeJS.Timeout | null = null;
  private discoverTimer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly limit = Number(process.env.LIVE_SENSOR_LIMIT ?? 6);

  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly events: EventsService,
    private readonly scoring: LiveScoringService,
  ) {}

  onModuleInit(): void {
    if ((process.env.LIVE_SENSORS ?? 'on').toLowerCase() === 'off') {
      this.logger.log('Live sensor ingestion disabled (LIVE_SENSORS=off).');
      return;
    }
    setTimeout(() => void this.discoverAndPoll(), 10_000).unref();
    this.pollTimer = setInterval(
      () => void this.poll(),
      Number(process.env.LIVE_SENSOR_INTERVAL_MS ?? 10 * 60_000),
    );
    this.pollTimer.unref();
    this.discoverTimer = setInterval(() => void this.discoverAndPoll(), 6 * 3_600_000);
    this.discoverTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.discoverTimer) clearInterval(this.discoverTimer);
  }

  /** The stations currently followed, for the status endpoint. */
  get followed(): readonly EaStation[] {
    return this.stations;
  }

  async discoverAndPoll(): Promise<void> {
    try {
      const stations = await discoverLiveStations({ limit: this.limit });
      if (stations.length === 0) {
        this.logger.warn('No live EA stations discovered; keeping the previous set.');
      } else {
        this.stations = stations;
        // Sites is a ReplacingMergeTree on updated_at: re-inserting a station
        // refreshes its row rather than duplicating it.
        await insertRows(this.clickhouse.writer, 'sites', stations.map(stationToSite));
        const retired = await this.retireUnfollowed(stations.map((s) => s.id));
        this.logger.log(
          `Following ${stations.length} live EA stations: ${stations.map((s) => s.name).join(' · ')}` +
            (retired > 0 ? ` (${retired} previously followed station(s) retired)` : ''),
        );
      }
    } catch (error) {
      this.logger.error(
        'Sensor discovery failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
    await this.poll();
  }

  /**
   * Sondes move. A station that discovery no longer returns keeps its history,
   * but its site row is re-inserted with `active = 0` so it leaves the map and
   * the overview. If it reports again, discovery re-inserts it with
   * `active = 1`, and the ReplacingMergeTree keeps whichever row is newer.
   * Nothing is deleted.
   */
  private async retireUnfollowed(followedRefs: string[]): Promise<number> {
    const stale = await this.clickhouse.query<{ site_id: string }>(
      `SELECT site_id FROM sites FINAL
       WHERE provider = 'ea-hydrology' AND active = 1
         AND provider_ref NOT IN {refs:Array(String)}`,
      { refs: followedRefs },
    );
    if (stale.length === 0) return 0;
    await this.clickhouse.writer.command({
      query: `INSERT INTO sites
              SELECT * REPLACE (0 AS active, now() AS updated_at)
              FROM sites FINAL
              WHERE site_id IN {siteIds:Array(String)}`,
      query_params: { siteIds: stale.map((row) => row.site_id) },
    });
    this.logger.log(
      `Retired ${stale.length} sensor site(s): ${stale.map((row) => row.site_id).join(', ')}`,
    );
    return stale.length;
  }

  async poll(): Promise<void> {
    if (this.running || this.stations.length === 0) return;
    this.running = true;
    const startedAt = new Date();
    let rows = 0;
    let ok = true;
    let detail = '';
    const touched: string[] = [];

    try {
      for (const station of this.stations) {
        const siteId = `EA-${station.id}`;
        try {
          const [last] = await this.clickhouse.query<{ latest: string | null }>(
            'SELECT toString(max(observed_at)) AS latest FROM observations WHERE site_id = {siteId:String}',
            { siteId },
          );
          const since =
            last?.latest && !last.latest.startsWith('1970')
              ? new Date(`${last.latest.replace(' ', 'T')}Z`)
              : null;

          const observations = await fetchStationObservations(station, since);
          if (observations.length === 0) continue;
          rows += await insertRows(this.clickhouse.writer, 'observations', observations);
          touched.push(siteId);
        } catch (error) {
          ok = false;
          detail += `${station.id}: ${error instanceof Error ? error.message : String(error)}; `;
        }
      }

      if (touched.length > 0) {
        this.logger.log(
          `Sensor readings: ${rows} new observations across ${touched.length} station(s)`,
        );
        this.events.emit({
          type: 'sensors',
          sites: touched.length,
          rows,
          at: new Date().toISOString(),
        });
        this.scoring.schedule(touched, 500);
      }
    } finally {
      this.running = false;
      await recordIngestRun(this.clickhouse.writer, {
        source: 'ea-hydrology',
        startedAt,
        rows,
        ok,
        detail: detail.slice(0, 500),
      }).catch(() => {});
    }
  }
}
