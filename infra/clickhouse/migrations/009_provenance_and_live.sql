-- ─────────────────────────────────────────────────────────────────────────────
-- 009 · Per-site provenance and live-ingestion support
--
-- Until now every site carried the same provenance — simulated observations,
-- real weather — and one global banner said so. With real sensor stations
-- joining the network, provenance becomes a property of the SITE, and the
-- disclosure has to be as granular as the data: a reader looking at a Thames
-- sonde must see "real, official sensor", and a reader looking at a Coimbra
-- reach must still see "simulated", on the same screen.
--
-- `region` groups sites for the map. A pilot city and a sensor network two
-- thousand kilometres away cannot share one viewport.
--
-- ALTER ... IF NOT EXISTS keeps this idempotent, matching every other migration.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE sites
    ADD COLUMN IF NOT EXISTS source Enum8('simulated' = 1, 'sensor' = 2, 'citizen' = 3) DEFAULT 'simulated'
        COMMENT 'What produces this site''s observations. Drives the per-site disclosure.',
    ADD COLUMN IF NOT EXISTS region LowCardinality(String) DEFAULT 'Coimbra'
        COMMENT 'Map grouping; a viewport fits one region at a time',
    ADD COLUMN IF NOT EXISTS provider LowCardinality(String) DEFAULT ''
        COMMENT 'Upstream network for sensor sites, e.g. ea-hydrology',
    ADD COLUMN IF NOT EXISTS provider_ref String DEFAULT ''
        COMMENT 'Station identifier in the upstream network',
    -- Scoring inputs that previously lived only in the seed definitions. With
    -- sites created at runtime from sensor discovery, the database has to be
    -- the single source of every attribute the scorer needs.
    ADD COLUMN IF NOT EXISTS outfall_count UInt8 DEFAULT 0
        COMMENT 'Outfall pipes discharging to the reach',
    ADD COLUMN IF NOT EXISTS reference_aspt Float32 DEFAULT 6
        COMMENT 'Site-specific reference ASPT for the EQR';


-- ─── Live ingestion log ──────────────────────────────────────────────────────
-- One row per ingest run per source, so the dashboard can say "sensors last
-- refreshed 4 minutes ago" from the database rather than from a process's
-- memory — the API may restart; the truth about freshness should not.

CREATE TABLE IF NOT EXISTS ingest_runs
(
    source          LowCardinality(String),
    started_at      DateTime('UTC'),
    finished_at     DateTime('UTC'),
    rows_written    UInt32,
    ok              UInt8,
    detail          String DEFAULT ''
)
ENGINE = MergeTree
ORDER BY (source, started_at)
TTL started_at + INTERVAL 30 DAY
COMMENT 'Audit trail of live ingestion runs';


-- ─── Overview view ───────────────────────────────────────────────────────────
-- Lives here rather than in 006 because it reads the provenance columns this
-- migration adds; a view cannot reference columns that do not exist yet.

-- Site dimension joined to its current headline, which is what every overview
-- query actually wants.
CREATE VIEW IF NOT EXISTS site_health_overview AS
SELECT
    s.site_id                    AS site_id,
    s.name                       AS name,
    s.catchment                  AS catchment,
    s.city                       AS city,
    s.lat                        AS lat,
    s.lon                        AS lon,
    s.urban_class                AS urban_class,
    s.recreational_access        AS recreational_access,
    s.combined_sewer             AS combined_sewer,
    s.impervious_pct             AS impervious_pct,
    s.source                     AS source,
    s.region                     AS region,
    s.provider                   AS provider,
    c.sohi                       AS sohi,
    c.status                     AS status,
    c.ecological_score           AS ecological_score,
    c.pressure_score             AS pressure_score,
    c.exposure_score             AS exposure_score,
    c.confidence                 AS confidence,
    c.sohi_low                   AS sohi_low,
    c.sohi_high                  AS sohi_high,
    c.drivers                    AS drivers,
    c.n_obs                      AS n_obs,
    c.days_since_last_obs        AS days_since_last_obs,
    c.as_of                      AS as_of
FROM sites AS s FINAL
LEFT JOIN (SELECT * FROM site_health_current FINAL) AS c ON c.site_id = s.site_id;
