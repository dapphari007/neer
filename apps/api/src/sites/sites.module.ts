import { Module } from '@nestjs/common';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';
import { FindingsModule } from '../findings/findings.module';

@Module({
  imports: [FindingsModule],
  controllers: [SitesController],
  providers: [SitesService],
  exports: [SitesService],
})
export class SitesModule {}
