import { Controller, Get, Sse, type MessageEvent } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { map, type Observable } from 'rxjs';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { EventsService } from './events.service';
import { SensorIngestService } from './sensors.service';
import { envelope } from '../common/meta';

@ApiTags('live')
@Controller('api')
export class LiveController {
  constructor(
    private readonly events: EventsService,
    private readonly sensors: SensorIngestService,
    private readonly clickhouse: ClickHouseService,
  ) {}

  /**
   * Server-sent events. One connection per open dashboard; each event names
   * what changed and the client refetches through the endpoints it already
   * trusts.
   */
  @Sse('events')
  @ApiOperation({
    summary: 'Server-sent events: scores, weather, sensors, observations, heartbeat',
  })
  stream(): Observable<MessageEvent> {
    return this.events.stream().pipe(map((event) => ({ type: event.type, data: event })));
  }

  /**
   * Freshness, from the database rather than from process memory: when each
   * source last ran, whether it succeeded, and which sensor stations are being
   * followed right now.
   */
  @Get('live/status')
  @ApiOperation({
    summary: 'Last ingest run per source and the sensor stations currently followed',
  })
  async status() {
    const runs = await this.clickhouse.query<{
      source: string;
      lastRun: string;
      rows: number;
      ok: number;
      detail: string;
    }>(`
      SELECT
          source,
          toString(max(started_at))       AS lastRun,
          argMax(rows_written, started_at) AS rows,
          argMax(ok, started_at)           AS ok,
          argMax(detail, started_at)       AS detail
      FROM ingest_runs
      GROUP BY source
      ORDER BY source`);

    return envelope({
      sources: runs.map((r) => ({ ...r, ok: r.ok === 1 })),
      stations: this.sensors.followed.map((s) => ({
        id: s.id,
        siteId: `EA-${s.id}`,
        name: s.name,
        river: s.river,
        parameters: Object.keys(s.measures),
      })),
      liveWeather: (process.env.LIVE_WEATHER ?? 'on').toLowerCase() !== 'off',
      liveSensors: (process.env.LIVE_SENSORS ?? 'on').toLowerCase() !== 'off',
    });
  }
}
