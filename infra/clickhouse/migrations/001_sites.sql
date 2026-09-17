-- ─────────────────────────────────────────────────────────────────────────────
-- 001 · Site dimension
--
-- Monitoring sites on urban streams. Slowly-changing dimension: ReplacingMergeTree
-- de-duplicates on `updated_at` so re-running the seed is idempotent.
--
-- The catchment attributes (combined_sewer, impervious_pct, recreational access)
-- are not decoration — they are direct inputs to the One Health exposure rules.
-- A dissolved-oxygen crash 48h after heavy rain means something very different in
-- a combined-sewer catchment with a downstream swimming spot than it does in a
-- semi-natural reach nobody touches.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sites
(
    site_id              LowCardinality(String),
    name                 String,
    catchment            LowCardinality(String),
    water_body_code      String            COMMENT 'WFD water body identifier where known',
    city                 LowCardinality(String),
    country              LowCardinality(String),

    -- geography
    lat                  Float64,
    lon                  Float64,
    elevation_m          Float32,
    stream_order         UInt8             COMMENT 'Strahler stream order',
    upstream_area_km2    Float32,

    -- catchment pressure context (drives the P and H sub-indices)
    urban_class          Enum8('urban_core' = 1, 'peri_urban' = 2, 'semi_natural' = 3),
    impervious_pct       Float32           COMMENT 'Sealed surface share of upstream catchment',
    combined_sewer       UInt8             COMMENT '1 = catchment served by combined sewer (CSO spill risk)',

    -- human exposure context
    recreational_access  UInt8             COMMENT '1 = public physical contact with the water occurs',
    nearest_contact_m    UInt32            COMMENT 'Distance downstream to nearest contact point, metres',
    population_within_1km UInt32,

    -- WFD reference condition, used to normalise ecological scores into an EQR
    reference_do_mgl     Float32,
    reference_cond_uscm  Float32,

    created_at           DateTime DEFAULT now(),
    updated_at           DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY site_id
COMMENT 'Monitoring site dimension with catchment + exposure context';
