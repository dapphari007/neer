import { Global, Module } from '@nestjs/common';
import { ClickHouseService } from './clickhouse.service';

/**
 * Global so every feature module can inject the client without re-importing.
 * There is exactly one connection pool in the process, which is what the
 * `max_open_connections` cap assumes.
 */
@Global()
@Module({
  providers: [ClickHouseService],
  exports: [ClickHouseService],
})
export class ClickHouseModule {}
