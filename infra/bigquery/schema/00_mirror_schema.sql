-- ─────────────────────────────────────────────────────────────────────────────
-- BigQuery mirror of the ClickHouse serving tables
--
-- ClickHouse remains the system of record and the serving layer. This mirror
-- exists only so the batch analytical path has something to train on, and it is
-- loaded by periodic export rather than by dual writes. Dual writes would put a
-- cloud dependency directly in the ingestion path, turning a BigQuery outage
-- into an ingestion outage — an unacceptable trade for a tier whose entire
-- purpose is work that can wait.
--
-- Partitioned by day and clustered by site because every analytical query
-- filters on both. Unpartitioned, each training run would scan the full table
-- and cost would grow with total history rather than with the window being
-- modelled.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS `@project.@dataset`
OPTIONS (
  location = 'EU',
  description = 'Neer batch analytics — the cold path. ClickHouse is the system of record.'
);

CREATE TABLE IF NOT EXISTS `@project.@dataset.site_health_daily`
(
  site_id           STRING NOT NULL,
  day               DATE   NOT NULL,
  sohi              FLOAT64,
  status            STRING,
  ecological_score  FLOAT64,
  pressure_score    FLOAT64,
  exposure_score    FLOAT64,
  confidence        FLOAT64,
  sohi_low          FLOAT64,
  sohi_high         FLOAT64,
  n_obs             INT64,
  -- Carried through the mirror so a scoring-model change remains visible on this
  -- side too. Without it, retraining on a mixture of method versions would blend
  -- two different definitions of the same number.
  method_version    STRING NOT NULL
)
PARTITION BY day
CLUSTER BY site_id
OPTIONS (
  description = 'Daily computed index, mirrored from ClickHouse',
  -- Well beyond any training window used here, and it stops an unattended
  -- dataset from accruing storage cost indefinitely.
  partition_expiration_days = 730
);

CREATE TABLE IF NOT EXISTS `@project.@dataset.sites`
(
  site_id             STRING NOT NULL,
  name                STRING,
  catchment           STRING,
  city                STRING,
  country             STRING,
  lat                 FLOAT64,
  lon                 FLOAT64,
  urban_class         STRING,
  impervious_pct      FLOAT64,
  combined_sewer      BOOL,
  recreational_access BOOL,
  upstream_area_km2   FLOAT64,
  stream_order        INT64
)
CLUSTER BY site_id
OPTIONS (description = 'Site dimension, mirrored from ClickHouse');

-- Feature view consumed by the clustering model, so the feature definition lives
-- in one place rather than being restated in every query that needs it.
CREATE OR REPLACE VIEW `@project.@dataset.site_features` AS
SELECT
  h.site_id                                   AS site_id,
  AVG(h.sohi)                                 AS mean_sohi,
  STDDEV(h.sohi)                              AS sohi_volatility,
  AVG(h.ecological_score)                     AS mean_ecological,
  AVG(h.pressure_score)                       AS mean_pressure,
  AVG(h.exposure_score)                       AS mean_exposure,
  AVG(h.confidence)                           AS mean_confidence,
  ANY_VALUE(s.impervious_pct)                 AS impervious_pct,
  ANY_VALUE(CAST(s.combined_sewer AS INT64))  AS combined_sewer,
  ANY_VALUE(s.upstream_area_km2)              AS upstream_area_km2,
  ANY_VALUE(s.stream_order)                   AS stream_order
FROM `@project.@dataset.site_health_daily` AS h
JOIN `@project.@dataset.sites` AS s USING (site_id)
GROUP BY h.site_id
HAVING COUNT(*) >= 30;
