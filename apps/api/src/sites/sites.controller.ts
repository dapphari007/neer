import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SitesService } from './sites.service';
import { FindingsService } from '../findings/findings.service';
import { envelope } from '../common/meta';

@ApiTags('sites')
@Controller('api')
export class SitesController {
  constructor(
    private readonly sites: SitesService,
    private readonly findings: FindingsService,
  ) {}

  @Get('sites')
  @ApiOperation({ summary: 'All monitoring sites with their current index and alert count' })
  async list() {
    const [data, asOf] = await Promise.all([this.sites.listSites(), this.sites.getAsOf()]);
    return envelope(data, asOf);
  }

  @Get('sites/:siteId')
  @ApiOperation({ summary: 'One site with its current index, decomposition and active findings' })
  async detail(@Param('siteId') siteId: string) {
    const [{ site, current }, findings, asOf] = await Promise.all([
      this.sites.getSite(siteId),
      this.findings.listFindings({ siteId }),
      this.sites.getAsOf(),
    ]);
    return envelope({ site, current, findings }, asOf);
  }

  @Get('sites/:siteId/trend')
  @ApiOperation({ summary: 'Daily index series with weather and hydrology context' })
  async trend(
    @Param('siteId') siteId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    // Confirm the site exists first, so an unknown id returns 404 rather than a
    // 200 with an empty series — which reads as "no data here" and is a very
    // different claim from "no such site".
    await this.sites.getSite(siteId);
    const points = await this.sites.getTrend(siteId, from, to);
    return envelope({ siteId, points, anomalies: [], forecast: [] });
  }

  @Get('measurements')
  @ApiOperation({ summary: 'Trailing 14-day mean measurements per site, in real units' })
  async measurements() {
    const [data, asOf] = await Promise.all([
      this.sites.getRecentMeasurements(),
      this.sites.getAsOf(),
    ]);
    return envelope(data, asOf);
  }

  @Get('catchments/summary')
  @ApiOperation({ summary: 'Catchment rollup, reporting the worst site alongside the mean' })
  async catchments() {
    const [data, asOf] = await Promise.all([
      this.sites.getCatchmentSummary(),
      this.sites.getAsOf(),
    ]);
    return envelope(data, asOf);
  }
}
