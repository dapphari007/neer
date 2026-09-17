import { Logger, Module } from '@nestjs/common';
import { ForecastProvider } from './forecast.interface';
import { LocalForecastProvider } from './local-forecast.provider';
import { BigQueryForecastProvider } from './bigquery-forecast.provider';

/**
 * Provider selection, resolved once at startup.
 *
 * If BigQuery is requested but unavailable, the module falls back to the local
 * forecaster and says so, rather than starting in a state where every forecast
 * request fails. A misconfigured optional dependency should degrade one feature,
 * not the service.
 */
@Module({
  providers: [
    LocalForecastProvider,
    BigQueryForecastProvider,
    {
      provide: ForecastProvider,
      inject: [LocalForecastProvider, BigQueryForecastProvider],
      useFactory: async (
        local: LocalForecastProvider,
        bigquery: BigQueryForecastProvider,
      ): Promise<ForecastProvider> => {
        const logger = new Logger('ForecastModule');
        const requested = (process.env.FORECAST_PROVIDER ?? 'local').toLowerCase();

        if (requested === 'bqml') {
          if (await bigquery.isAvailable()) {
            logger.log('Forecasting via BigQuery ML (ARIMA_PLUS).');
            return bigquery;
          }
          logger.warn(
            'FORECAST_PROVIDER=bqml requested but unavailable — using the local forecaster.',
          );
          return local;
        }

        logger.log('Forecasting via the local damped-trend model (no credentials required).');
        return local;
      },
    },
  ],
  exports: [ForecastProvider],
})
export class ForecastModule {}
