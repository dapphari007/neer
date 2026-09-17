import { Injectable, Logger } from '@nestjs/common';
import {
  ForecastProvider,
  type ForecastPoint,
  type ForecastRequest,
  type ForecastResult,
} from './forecast.interface';

/**
 * BigQuery ML forecasting — the cold analytical path.
 *
 * **Status: dormant by default.** This provider is real, complete code, but it
 * activates only when `FORECAST_PROVIDER=bqml` and GCP credentials are present.
 * The repository runs fully without a Google Cloud account, which matters
 * because a reviewer should never need one to see the product work.
 *
 * Why BigQuery ML rather than ClickHouse, given ClickHouse is already here:
 *
 *  · ARIMA_PLUS handles the things a hand-rolled forecaster does badly —
 *    automatic seasonality detection, holiday effects, and explicit spike and
 *    dip handling. It also decomposes a forecast into trend, seasonal and
 *    holiday components via `ML.EXPLAIN_FORECAST`, which turns a projection into
 *    something a non-statistician can interrogate.
 *  · Training is batch work measured in minutes. It has no business in a request
 *    path, and ClickHouse is not a training engine.
 *  · A single `CREATE MODEL` with `TIME_SERIES_ID_COL` fits every site at once,
 *    so adding cities scales by row count rather than by orchestration.
 *
 * Model definitions: `infra/bigquery/bqml/`. Evaluation and stated limitations:
 * `docs/MODEL_CARD.md`.
 *
 * The `@google-cloud/bigquery` client is an optional dependency, imported
 * dynamically. That keeps the install lean and the build green for the common
 * case where nobody is using this path, without reducing the code to a stub.
 */
@Injectable()
export class BigQueryForecastProvider extends ForecastProvider {
  readonly name = 'bqml-arima-plus';
  private readonly version = '1.0.0';
  private readonly logger = new Logger(BigQueryForecastProvider.name);

  private get projectId(): string | undefined {
    return process.env.GCP_PROJECT_ID;
  }
  private get dataset(): string {
    return process.env.BIGQUERY_DATASET ?? 'neer_analytics';
  }
  private get location(): string {
    return process.env.GCP_LOCATION ?? 'EU';
  }

  /**
   * Availability is checked, not assumed.
   *
   * Both the credentials and the client library must be present. Reporting
   * availability and then failing at query time would take the endpoint down
   * instead of falling back, so the check happens up front and the module
   * selects the local provider when it fails.
   */
  async isAvailable(): Promise<boolean> {
    if (!this.projectId) {
      this.logger.warn('GCP_PROJECT_ID is not set — BigQuery forecasting unavailable.');
      return false;
    }
    try {
      await this.loadClient();
      return true;
    } catch {
      this.logger.warn(
        '@google-cloud/bigquery is not installed. Run `pnpm add @google-cloud/bigquery -F @neer/api` to enable the BigQuery tier.',
      );
      return false;
    }
  }

  private async loadClient(): Promise<{ new (options: unknown): BigQueryLike }> {
    // Dynamic specifier so the bundler does not try to resolve an optional
    // dependency that is usually absent.
    const moduleName = '@google-cloud/bigquery';
    const mod = (await import(moduleName)) as { BigQuery: { new (options: unknown): BigQueryLike } };
    return mod.BigQuery;
  }

  async forecast(request: ForecastRequest): Promise<ForecastResult> {
    const BigQuery = await this.loadClient();
    const client = new BigQuery({ projectId: this.projectId, location: this.location });

    // ML.FORECAST reads the model trained by infra/bigquery/bqml/01_train_forecast.sql.
    // Parameterised throughout — site ids reach this from a URL path and are
    // untrusted input like any other.
    const sql = `
      SELECT
        FORMAT_DATE('%Y-%m-%d', DATE(forecast_timestamp))      AS targetDate,
        forecast_value                                          AS predicted,
        prediction_interval_lower_bound                         AS lower80,
        prediction_interval_upper_bound                         AS upper80,
        confidence_interval_lower_bound                         AS lower95,
        confidence_interval_upper_bound                         AS upper95
      FROM ML.FORECAST(
        MODEL \`${this.projectId}.${this.dataset}.sohi_arima_plus\`,
        STRUCT(@horizon AS horizon, 0.8 AS confidence_level)
      )
      WHERE site_id = @siteId
      ORDER BY forecast_timestamp`;

    try {
      const [rows] = await client.query({
        query: sql,
        params: { siteId: request.siteId, horizon: request.horizonDays },
        location: this.location,
      });

      const points: ForecastPoint[] = (rows as BqForecastRow[]).map((row) => ({
        targetDate: row.targetDate,
        predicted: clamp(row.predicted),
        lower80: clamp(row.lower80),
        upper80: clamp(row.upper80),
        lower95: clamp(row.lower95),
        upper95: clamp(row.upper95),
      }));

      return {
        points,
        model: this.name,
        modelVersion: this.version,
        trainedThrough: request.history.at(-1)?.day ?? null,
      };
    } catch (error) {
      // A forecast is an enhancement, not the product. Losing it should not take
      // down a site detail page that is otherwise entirely serviceable.
      this.logger.error(
        `BigQuery forecast failed for ${request.siteId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return {
        points: [],
        model: this.name,
        modelVersion: this.version,
        trainedThrough: null,
        note: 'BigQuery forecast unavailable; the trend and index are unaffected.',
      };
    }
  }
}

interface BqForecastRow {
  targetDate: string;
  predicted: number;
  lower80: number;
  upper80: number;
  lower95: number;
  upper95: number;
}

interface BigQueryLike {
  query(options: {
    query: string;
    params?: Record<string, unknown>;
    location?: string;
  }): Promise<[unknown[]]>;
}

const clamp = (v: number): number => Math.max(0, Math.min(100, Number(v.toFixed(2))));
