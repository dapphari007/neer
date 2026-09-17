-- ─────────────────────────────────────────────────────────────────────────────
-- Evaluation — run before trusting any forecast
--
-- A forecast with no reported error is a decoration. These queries produce the
-- numbers that belong in docs/MODEL_CARD.md, reported per site, so that a model
-- performing well on average but badly at the two sites anybody actually cares
-- about cannot hide behind the mean.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Per-site accuracy on the held-out window ────────────────────────────────
SELECT
  site_id,
  ROUND(mean_absolute_error, 2)                       AS mae,
  ROUND(mean_squared_error, 2)                        AS mse,
  ROUND(mean_absolute_percentage_error, 2)            AS mape,
  ROUND(symmetric_mean_absolute_percentage_error, 2)  AS smape
FROM ML.EVALUATE(
  MODEL `@project.@dataset.sohi_arima_plus`,
  (
    SELECT site_id, day, sohi
    FROM `@project.@dataset.site_health_daily`
    WHERE sohi IS NOT NULL
  ),
  STRUCT(TRUE AS perform_aggregation, 21 AS horizon)
)
ORDER BY mae DESC;


-- ─── Baseline comparison ─────────────────────────────────────────────────────
-- The number that decides whether this model earns its cost. A persistence
-- forecast — "tomorrow equals today" — is free, and on short horizons over noisy
-- environmental series it frequently wins. Any model that cannot beat it should
-- be switched off rather than reported.
WITH persistence AS (
  SELECT
    site_id,
    day,
    sohi,
    LAG(sohi) OVER (PARTITION BY site_id ORDER BY day) AS naive_prediction
  FROM `@project.@dataset.site_health_daily`
  WHERE sohi IS NOT NULL
)
SELECT
  site_id,
  COUNT(*)                                        AS days,
  ROUND(AVG(ABS(sohi - naive_prediction)), 2)     AS persistence_mae
FROM persistence
WHERE naive_prediction IS NOT NULL
GROUP BY site_id
ORDER BY persistence_mae DESC;


-- ─── Selected ARIMA order and seasonality, per site ──────────────────────────
-- Worth reading rather than skipping. A site where no seasonal term was selected
-- is telling you its series is too short or too gappy for the model assumptions
-- to hold — which is information about the monitoring network as much as about
-- the model.
SELECT
  site_id,
  non_seasonal_p,
  non_seasonal_d,
  non_seasonal_q,
  has_drift,
  seasonal_periods,
  ROUND(log_likelihood, 2)  AS log_likelihood,
  ROUND(aic, 2)             AS aic,
  variance
FROM ML.ARIMA_EVALUATE(MODEL `@project.@dataset.sohi_arima_plus`)
ORDER BY aic;


-- ─── Explainable forecast ────────────────────────────────────────────────────
-- Decomposes each projected point into trend, seasonal and holiday components.
-- This is the reason ARIMA_PLUS is here rather than a hand-rolled model: it lets
-- a municipal officer see whether a projected decline is a real trend or the
-- weekend-sampling artefact the volunteer rota produces.
SELECT
  site_id,
  DATE(time_series_timestamp)           AS day,
  ROUND(time_series_data, 1)            AS observed,
  ROUND(time_series_adjusted_data, 1)   AS adjusted,
  ROUND(trend, 2)                       AS trend,
  ROUND(seasonal_period_weekly, 2)      AS weekly_seasonality,
  ROUND(holiday_effect, 2)              AS holiday_effect,
  ROUND(spikes_and_dips, 2)             AS spikes_and_dips
FROM ML.EXPLAIN_FORECAST(
  MODEL `@project.@dataset.sohi_arima_plus`,
  STRUCT(14 AS horizon, 0.8 AS confidence_level)
)
ORDER BY site_id, day;
