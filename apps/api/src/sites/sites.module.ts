import { Module } from '@nestjs/common';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';
import { FindingsModule } from '../findings/findings.module';
import { ForecastModule } from '../forecast/forecast.module';

@Module({
  imports: [FindingsModule, ForecastModule],
  controllers: [SitesController],
  providers: [SitesService],
  exports: [SitesService],
})
export class SitesModule {}
