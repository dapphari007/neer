-- ─────────────────────────────────────────────────────────────────────────────
-- 003 · Environmental context readings (weather + hydrology)
--
-- Sourced live from Open-Meteo: the historical archive API for weather and the
-- flood API for river discharge. Both are genuinely open — no API key, no
-- registration. See docs/DATA_SOURCES.md for licence terms.
--
-- This table is the reason the insight engine can say *why* something changed
-- rather than only *that* it changed. Hourly grain so an observation can be
-- ASOF-joined to the conditions that actually prevailed when it was taken, and
-- so antecedent rainfall windows (a combined-sewer-overflow predictor) are
-- computable.
--
-- ReplacingMergeTree: re-fetching a date range overwrites rather than duplicates.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS env_readings
(
    site_id              LowCardinality(String),
    recorded_at          DateTime('UTC'),

    air_temp_c           Nullable(Float32),
    relative_humidity    Nullable(Float32),
    precipitation_mm     Nullable(Float32),
    wind_speed_ms        Nullable(Float32),
    shortwave_rad_wm2    Nullable(Float32),
    soil_moisture_frac   Nullable(Float32),

    -- derived antecedent-condition windows, computed at ingest time
    precip_24h_mm        Nullable(Float32),
    precip_48h_mm        Nullable(Float32),
    precip_7d_mm         Nullable(Float32),
    dry_days_before      Nullable(UInt16) COMMENT 'Consecutive dry days preceding — drives first-flush pollutant load',

    -- hydrology (Open-Meteo flood API; daily value broadcast across the day)
    discharge_m3s        Nullable(Float32),

    source               LowCardinality(String) DEFAULT 'open-meteo',
    ingested_at          DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(recorded_at)
ORDER BY (site_id, recorded_at)
COMMENT 'Hourly weather + hydrology context, keyed to sites';
