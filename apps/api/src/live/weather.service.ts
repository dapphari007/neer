import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { fetchLiveWeather, insertRows, loadSites, recordIngestRun } from '@neer/pipeline';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { EventsService } from './events.service';
import { LiveScoringService } from './scoring.service';

/**
 * Live weather refresh — real conditions for every site, kept current.
 *
 * Open-Meteo updates hourly; polling every fifteen minutes catches each new
 * hour within a quarter of an hour of publication without wasting the free
 * tier. Each run re-fetches the last week so the antecedent rainfall windows
 * are computed over full context, then every site is re-scored: a storm changes
 * the reading of an oxygen crash even if no volunteer has been out since.
 *
 * Disabled with LIVE_WEATHER=off, for tests and for anyone running the stack
 * without internet access.
 */
@Injectable()
export class WeatherRefreshService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WeatherRefreshService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly intervalMs = Number(process.env.LIVE_WEATHER_INTERVAL_MS ?? 15 * 60_000);

  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly events: EventsService,
    private readonly scoring: LiveScoringService,
  ) {}

  onModuleInit(): void {
    if ((process.env.LIVE_WEATHER ?? 'on').toLowerCase() === 'off') {
      this.logger.log('Live weather refresh disabled (LIVE_WEATHER=off).');
      return;
    }
    // First run shortly after boot, so the dashboard shows current weather
    // within seconds of `docker compose up` rather than after fifteen minutes.
    setTimeout(() => void this.refresh(), 5_000).unref();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const startedAt = new Date();
    let rows = 0;
    let ok = true;
    let detail = '';

    try {
      const sites = await loadSites(this.clickhouse.writer);
      for (const site of sites) {
        try {
          // Fresh coordinates per site; sensor sites are discovered at runtime.
          const [meta] = await this.clickhouse.query<{ lat: number; lon: number }>(
            'SELECT lat, lon FROM sites FINAL WHERE site_id = {siteId:String} LIMIT 1',
            { siteId: site.siteId },
          );
          if (!meta) continue;
          const readings = await fetchLiveWeather({
            siteId: site.siteId,
            lat: meta.lat,
            lon: meta.lon,
          });
          rows += await insertRows(this.clickhouse.writer, 'env_readings', readings);
        } catch (error) {
          ok = false;
          detail += `${site.siteId}: ${error instanceof Error ? error.message : String(error)}; `;
        }
      }

      this.logger.log(`Weather refreshed: ${rows} hourly rows across ${sites.length} sites`);
      this.events.emit({ type: 'weather', sites: sites.length, at: new Date().toISOString() });
      // New antecedent conditions can change every site's reading of its data.
      this.scoring.schedule(sites.map((s) => s.siteId));
    } catch (error) {
      ok = false;
      detail = error instanceof Error ? error.message : String(error);
      this.logger.error('Weather refresh failed', detail);
    } finally {
      this.running = false;
      await recordIngestRun(this.clickhouse.writer, {
        source: 'open-meteo',
        startedAt,
        rows,
        ok,
        detail: detail.slice(0, 500),
      }).catch(() => {});
    }
  }
}
