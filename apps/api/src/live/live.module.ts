import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { LiveScoringService } from './scoring.service';
import { WeatherRefreshService } from './weather.service';
import { SensorIngestService } from './sensors.service';
import { LiveController } from './live.controller';
import { ObservationsController } from '../observations/observations.controller';
import { ImportController } from '../observations/import.controller';

/**
 * Everything that makes the system move on its own: the event stream, the
 * incremental scorer, the weather refresh and the sensor ingestion — plus the
 * observation endpoint that feeds them from outside.
 */
@Module({
  controllers: [LiveController, ObservationsController, ImportController],
  providers: [EventsService, LiveScoringService, WeatherRefreshService, SensorIngestService],
  exports: [EventsService, LiveScoringService],
})
export class LiveModule {}
