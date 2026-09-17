import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { METHOD_VERSION } from '@neer/scoring';

@ApiTags('health')
@Controller('api')
export class HealthController {
  constructor(private readonly clickhouse: ClickHouseService) {}

  /**
   * Liveness and readiness in one.
   *
   * Reports the database as a dependency rather than only that the process is
   * up. A container that answers HTTP while unable to reach ClickHouse is not
   * healthy in any sense the caller cares about, and Compose's dependency
   * ordering relies on this being truthful.
   */
  @Get('health')
  @ApiOperation({ summary: 'Service and database health' })
  async health() {
    const database = await this.clickhouse.ping();
    return {
      status: database ? 'ok' : 'degraded',
      database: database ? 'up' : 'down',
      methodVersion: METHOD_VERSION,
      forecastProvider: process.env.FORECAST_PROVIDER ?? 'local',
      timestamp: new Date().toISOString(),
    };
  }
}
