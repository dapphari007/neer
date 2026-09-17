import { Module } from '@nestjs/common';
import { ClickHouseModule } from './clickhouse/clickhouse.module';
import { SitesModule } from './sites/sites.module';
import { FindingsModule } from './findings/findings.module';
import { ForecastModule } from './forecast/forecast.module';
import { HealthController } from './common/health.controller';

@Module({
  imports: [ClickHouseModule, SitesModule, FindingsModule, ForecastModule],
  controllers: [HealthController],
})
export class AppModule {}
