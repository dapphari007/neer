-- ─────────────────────────────────────────────────────────────────────────────
-- 008 · Forecasts and detected anomalies
--
-- Both tables are provider-agnostic by design. The `model` column records which
-- engine produced the row, so results from the default local TypeScript
-- forecaster and from BigQuery ML sit side by side in the same schema and are
-- directly comparable. Swapping providers is a configuration change, not a
-- migration — and evaluating one against the other is a single GROUP BY.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS forecasts
(
    site_id              LowCardinality(String),
    metric               LowCardinality(String) COMMENT 'sohi | do_mgl | turbidity_ntu | ...',
    target_date          Date,

    predicted            Float32,
    -- Prediction intervals are mandatory, not optional. A point forecast of a
    -- stream health index with no interval invites exactly the false precision
    -- this whole project exists to correct.
    lower_80             Float32,
    upper_80             Float32,
    lower_95             Float32,
    upper_95             Float32,

    model                LowCardinality(String) COMMENT 'local-holt-winters | bqml-arima-plus | ...',
    model_version        LowCardinality(String),
    horizon_days         UInt8,
    trained_through      Date COMMENT 'Last observation date the model saw — guards against leakage',

    generated_at         DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(generated_at)
PARTITION BY toYYYYMM(target_date)
ORDER BY (site_id, metric, target_date, model)
COMMENT 'Forward projections with prediction intervals, provider-tagged';


CREATE TABLE IF NOT EXISTS anomalies
(
    site_id              LowCardinality(String),
    metric               LowCardinality(String),
    day                  Date,

    observed             Float32,
    expected             Float32,
    deviation            Float32 COMMENT 'observed - expected, in native units',
    z_score              Float32,
    -- Direction matters for interpretation: turbidity spiking up and dissolved
    -- oxygen dropping are both "anomalies", but only one of them is good news
    -- when it reverses.
    direction            Enum8('below' = -1, 'above' = 1),
    severity             Enum8('watch' = 1, 'elevated' = 2, 'high' = 3),

    detector             LowCardinality(String) COMMENT 'local-stl-residual | bqml-arima-detect | ...',
    detector_version     LowCardinality(String),

    generated_at         DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(generated_at)
PARTITION BY toYYYYMM(day)
ORDER BY (site_id, metric, day, detector)
COMMENT 'Point anomalies against an expected baseline, provider-tagged';
