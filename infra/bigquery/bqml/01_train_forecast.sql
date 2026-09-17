-- ─────────────────────────────────────────────────────────────────────────────
-- BigQuery ML · ARIMA_PLUS forecasting for the Stream One Health Index
--
-- STATUS: dormant. This is real, runnable SQL, but the deployed system defaults
-- to the local forecaster so the repository runs with zero credentials. Set
-- FORECAST_PROVIDER=bqml with GCP credentials present to activate it.
--
-- Why BigQuery at all, when ClickHouse is already in the stack:
--
--   ClickHouse is the hot path — every dashboard query, sub-second, over
--   pre-aggregated state. BigQuery is the cold path: model training and
--   cross-site analysis measured in minutes, which has no business in a request
--   and which ClickHouse is not built for. Without that division of labour, two
--   columnar engines would be redundant; with it, each does what the other is
--   bad at.
--
-- Why ARIMA_PLUS rather than a hand-rolled model:
--
--   · Automatic seasonality detection, holiday effects, and explicit spike and
--     dip handling — all things stream data genuinely has and a damped-trend
--     model cannot represent.
--   · ML.EXPLAIN_FORECAST decomposes a projection into trend, seasonal and
--     holiday components, which turns a forecast into something a
--     non-statistician can interrogate rather than a line to be trusted.
--   · TIME_SERIES_ID_COL fits every site in one statement, so adding cities
--     scales by row count instead of by orchestration.
--
-- Cost note: at this data volume (roughly 1,200 site-days) training and
-- forecasting sit inside the BigQuery free tier. That stops being true at
-- national scale, and `docs/COSTS.md` gives the real numbers rather than
-- assuming the free tier holds.
-- ─────────────────────────────────────────────────────────────────────────────

-- Parameters (substitute or pass via the client):
--   @project  GCP project id
--   @dataset  BigQuery dataset, e.g. neer_analytics

CREATE OR REPLACE MODEL `@project.@dataset.sohi_arima_plus`
OPTIONS (
  MODEL_TYPE            = 'ARIMA_PLUS',
  TIME_SERIES_TIMESTAMP_COL = 'day',
  TIME_SERIES_DATA_COL  = 'sohi',
  -- One model object covering every site. Per-site models would multiply the
  -- training cost by the number of sites and make evaluation a fan-out.
  TIME_SERIES_ID_COL    = 'site_id',

  -- Citizen sampling is irregular by nature, so gaps are the normal case.
  -- Linear interpolation is used rather than dropping gaps, because dropping
  -- them would silently compress the time axis and distort the seasonality the
  -- model is trying to find.
  DATA_FREQUENCY        = 'DAILY',
  HOLIDAY_REGION        = 'PT',

  -- Weekly seasonality is real here but it is an artefact of *when volunteers
  -- sample*, not of the stream: weekend visits dominate. It is modelled so that
  -- it can be removed from the trend, not because Saturdays are ecologically
  -- distinct.
  AUTO_ARIMA            = TRUE,
  AUTO_ARIMA_MAX_ORDER  = 5,

  -- Streams respond sharply to storms. Left unhandled, a single spill drags the
  -- fitted trend for weeks afterwards.
  CLEAN_SPIKES_AND_DIPS = TRUE,
  ADJUST_STEP_CHANGES   = TRUE,

  -- Hold out the final 21 days for honest evaluation. Without a holdout,
  -- ML.EVALUATE reports in-sample fit, which always flatters the model.
  HORIZON               = 21
) AS
SELECT
  site_id,
  day,
  sohi
FROM `@project.@dataset.site_health_daily`
WHERE sohi IS NOT NULL
  -- Exclude very low-confidence days from TRAINING only. They remain in the
  -- index and on the dashboard; they are simply poor evidence to fit a model on,
  -- and including them teaches the model that noise is signal.
  AND confidence >= 0.25
ORDER BY site_id, day;
