import { BadRequestException, Body, Controller, HttpCode, Post, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { ObservationBatchSchema, type ObservationBatch } from '@neer/shared';
import { insertRows, type ObservationRow } from '@neer/pipeline';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { EventsService } from '../live/events.service';
import { LiveScoringService } from '../live/scoring.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { envelope } from '../common/meta';

/**
 * Observation ingestion — the front door for a phone app, a sensor bridge, or
 * the simulated field crew.
 *
 * The payload is validated against the same Zod schema the dashboard compiles
 * against, with physical-plausibility bounds on every measurement, so a
 * decimal-slip turbidity of 1400 is refused here rather than propagating into
 * an index and out onto a public map.
 *
 * Accepting a record and scoring it are decoupled on purpose: the request
 * returns as soon as ClickHouse has the rows, and the site is re-scored a
 * couple of seconds later by the live scoring service. A caller never waits on
 * the science, and a burst of readings produces one scoring run, not many.
 */
@ApiTags('observations')
@Controller('api')
export class ObservationsController {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly events: EventsService,
    private readonly scoring: LiveScoringService,
  ) {}

  @Post('observations')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Submit one or more field observations (accepted, then scored within seconds)',
  })
  @UsePipes(new ZodValidationPipe(ObservationBatchSchema))
  async submit(@Body() batch: ObservationBatch) {
    const siteIds = [...new Set(batch.observations.map((o) => o.siteId))];

    // Only sites that exist can be observed. Silently creating a site from a
    // typo would put an invented reach on the map.
    const known = await this.clickhouse.query<{ siteId: string }>(
      'SELECT site_id AS siteId FROM sites FINAL WHERE site_id IN {siteIds:Array(String)}',
      { siteIds },
    );
    const knownIds = new Set(known.map((k) => k.siteId));
    const unknown = siteIds.filter((id) => !knownIds.has(id));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown site id(s): ${unknown.join(', ')}`);
    }

    const rows: ObservationRow[] = batch.observations.map((o) => ({
      observation_id: randomUUID(),
      site_id: o.siteId,
      observed_at: o.observedAt.toISOString().slice(0, 23).replace('T', ' '),
      observer_id: o.observerId,
      observer_experience: o.observerExperience,
      method: o.method,
      source: o.source,
      photo_count: o.photoCount,
      water_temp_c: o.waterTempC ?? null,
      ph: o.ph ?? null,
      dissolved_oxygen_mgl: o.dissolvedOxygenMgl ?? null,
      conductivity_uscm: o.conductivityUscm ?? null,
      turbidity_ntu: o.turbidityNtu ?? null,
      nitrate_mgl: o.nitrateMgl ?? null,
      phosphate_mgl: o.phosphateMgl ?? null,
      ammonium_mgl: o.ammoniumMgl ?? null,
      water_colour: o.waterColour,
      odour: o.odour,
      foam_present: o.foamPresent ? 1 : 0,
      surface_film: o.surfaceFilm ? 1 : 0,
      litter_score: o.litterScore,
      algae_cover_pct: o.algaeCoverPct ?? null,
      flow_state: o.flowState,
      riparian_score: o.riparianScore,
      visible_discharge: o.visibleDischarge ? 1 : 0,
      taxa_groups: o.taxaGroups,
      taxa_abundance: o.taxaAbundance,
      notes: o.notes,
    }));

    const accepted = await insertRows(this.clickhouse.writer, 'observations', rows);
    this.events.emit({
      type: 'observations',
      siteIds,
      count: accepted,
      at: new Date().toISOString(),
    });
    this.scoring.schedule(siteIds);

    return envelope({ accepted, siteIds, scoring: 'scheduled' });
  }
}
