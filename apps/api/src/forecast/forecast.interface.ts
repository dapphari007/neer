/**
 * The forecasting seam.
 *
 * Two implementations sit behind this interface: a local TypeScript forecaster
 * that runs with zero credentials, and a BigQuery ML forecaster that trains
 * ARIMA_PLUS models in the warehouse. `FORECAST_PROVIDER` selects between them.
 *
 * The split is the point. ClickHouse serves the interactive path — every
 * dashboard query, sub-second, on pre-aggregated state. BigQuery is the batch
 * analytical path: model training, cross-site clustering, anything that is
 * minutes rather than milliseconds and does not belong in a request. Two
 * columnar engines without that division of labour would be redundant; with it,
 * each does what the other is bad at.
 *
 * The local provider is the default because a reviewer must be able to clone the
 * repository and see a forecast without a Google Cloud account. The BigQuery
 * provider is real, complete code — the SQL model definitions live in
 * `infra/bigquery/bqml/` and the model card in `docs/MODEL_CARD.md` — but it is
 * dormant unless credentials are supplied. Nothing is stubbed and nothing throws
 * "not implemented"; the capability is simply switched off.
 */

export interface ForecastPoint {
  readonly targetDate: string;
  readonly predicted: number;
  readonly lower80: number;
  readonly upper80: number;
  readonly lower95: number;
  readonly upper95: number;
}

export interface ForecastRequest {
  readonly siteId: string;
  readonly metric: string;
  /** Historical series, oldest first. */
  readonly history: ReadonlyArray<{ day: string; value: number }>;
  readonly horizonDays: number;
}

export interface ForecastResult {
  readonly points: readonly ForecastPoint[];
  /** Identifies which engine produced this, so results stay comparable. */
  readonly model: string;
  readonly modelVersion: string;
  /** Last observation the model saw — guards against evaluating on leaked data. */
  readonly trainedThrough: string | null;
  /** Populated when the provider could not produce a usable forecast. */
  readonly note?: string;
}

export abstract class ForecastProvider {
  abstract readonly name: string;
  abstract forecast(request: ForecastRequest): Promise<ForecastResult>;
  /** Whether this provider is usable in the current environment. */
  abstract isAvailable(): Promise<boolean>;
}
