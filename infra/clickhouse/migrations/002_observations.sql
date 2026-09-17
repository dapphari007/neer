-- ─────────────────────────────────────────────────────────────────────────────
-- 002 · Raw citizen + instrument observations
--
-- The grain is one field visit. Every column here is something a real European
-- citizen-science protocol actually asks a volunteer to record (test-kit
-- physico-chemistry, visual/habitat assessment, coarse invertebrate groups) —
-- see docs/DATA_SOURCES.md for the protocol mapping.
--
-- Design notes:
--   · ORDER BY (site_id, observed_at) — every dashboard query filters site then
--     time range, so this is the primary-key prefix that matters.
--   · PARTITION BY month keeps partition count sane over a multi-year horizon.
--   · Nullable ONLY on measurements, never on key columns. A volunteer with a
--     turbidity tube but no DO meter is the normal case, not an error — the
--     scoring layer handles absence explicitly and degrades confidence for it.
--   · Taxa as parallel arrays (group, abundance) rather than a wide table:
--     protocols differ in which groups they collect, and arrays keep that open.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS observations
(
    observation_id       UUID,
    site_id              LowCardinality(String),
    observed_at          DateTime64(3, 'UTC'),
    ingested_at          DateTime DEFAULT now(),

    -- provenance / reliability inputs
    observer_id          String,
    observer_experience  Enum8('novice' = 1, 'trained' = 2, 'expert' = 3, 'instrument' = 4),
    method               Enum8('citizen_kit' = 1, 'handheld_probe' = 2, 'sensor' = 3, 'lab' = 4),
    source               LowCardinality(String) COMMENT 'Programme or feed the record came from',
    photo_count          UInt8 DEFAULT 0,

    -- physico-chemical (test-kit measurable)
    water_temp_c         Nullable(Float32),
    ph                   Nullable(Float32),
    dissolved_oxygen_mgl Nullable(Float32),
    conductivity_uscm    Nullable(Float32),
    turbidity_ntu        Nullable(Float32),
    nitrate_mgl          Nullable(Float32),
    phosphate_mgl        Nullable(Float32),
    ammonium_mgl         Nullable(Float32),

    -- visual / habitat assessment (ordinal 0-3 unless noted)
    water_colour         Enum8('clear' = 0, 'slightly_turbid' = 1, 'murky' = 2, 'discoloured' = 3),
    odour                Enum8('none' = 0, 'earthy' = 1, 'sewage' = 2, 'chemical' = 3),
    foam_present         UInt8 DEFAULT 0,
    surface_film         UInt8 DEFAULT 0,
    litter_score         UInt8 DEFAULT 0 COMMENT '0 none .. 3 heavy',
    algae_cover_pct      Nullable(UInt8),
    flow_state           Enum8('dry' = 0, 'stagnant' = 1, 'low' = 2, 'normal' = 3, 'high' = 4),
    riparian_score       UInt8 DEFAULT 0 COMMENT '0 degraded .. 3 intact, QBR-style',
    visible_discharge    UInt8 DEFAULT 0,

    -- biological — coarse groups a trained volunteer can identify (ARMI-style)
    taxa_groups          Array(LowCardinality(String)),
    taxa_abundance       Array(UInt8) COMMENT 'Log-abundance category per group, parallel to taxa_groups',

    notes                String DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(observed_at)
ORDER BY (site_id, observed_at)
SETTINGS index_granularity = 8192
COMMENT 'One row per field visit — raw, unscored';
