import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SitesService } from './sites.service';
import { FindingsService } from '../findings/findings.service';
import { ForecastProvider } from '../forecast/forecast.interface';
import { envelope } from '../common/meta';

@ApiTags('sites')
@Controller('api')
export class SitesController {
  constructor(
    private readonly sites: SitesService,
    private readonly findings: FindingsService,
    private readonly forecaster: ForecastProvider,
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
    const points = (await this.sites.getTrend(siteId, from, to)) as Array<{
      day: string;
      sohi: number | null;
    }>;

    // Forecast from the same series the chart draws. Advisory only — no finding
    // or alert is ever derived from it; see docs/MODEL_CARD.md.
    const history = points
      .filter((p) => p.sohi !== null)
      .map((p) => ({ day: p.day, value: p.sohi as number }));
    const forecast = await this.forecaster.forecast({
      siteId,
      metric: 'sohi',
      history,
      horizonDays: 7,
    });

    return envelope({
      siteId,
      points,
      anomalies: [],
      forecast: forecast.points.map((f) => ({
        ...f,
        metric: 'sohi',
        model: forecast.model,
        horizonDays: 7,
      })),
      forecastNote: forecast.note ?? null,
    });
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
