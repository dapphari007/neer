-- ─────────────────────────────────────────────────────────────────────────────
-- 006 · Stream One Health Index (SOHI) — computed results
--
-- The index itself is computed in `packages/scoring`, a pure TypeScript package
-- with no I/O, so the science is unit-testable at its boundaries and reviewable
-- independently of any database. This table only stores the results.
--
-- ReplacingMergeTree keyed on `computed_at`: recomputing the index for a date
-- range overwrites in place rather than accumulating duplicates. `method_version`
-- is stored per row so results produced by different versions of the scoring
-- model are distinguishable after the fact — without it, a methodology change
-- silently rewrites history and no trend can be trusted across the boundary.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS site_health_daily
(
    site_id              LowCardinality(String),
    day                  Date,

    -- ─── headline ───────────────────────────────────────────────────────────
    sohi                 Float32 COMMENT 'Stream One Health Index, 0..100',
    -- Five classes mirroring WFD ecological status, so the output is legible to
    -- anyone already working to the Water Framework Directive.
    status               Enum8('bad' = 1, 'poor' = 2, 'moderate' = 3, 'good' = 4, 'high' = 5),

    -- ─── sub-indices (each 0..100) ──────────────────────────────────────────
    ecological_score     Float32 COMMENT 'E — physico-chemical + biotic integrity',
    pressure_score       Float32 COMMENT 'P — anthropogenic pressure (inverted: high = low pressure)',
    exposure_score       Float32 COMMENT 'H — human/animal health exposure (inverted: high = low risk)',

    -- ─── uncertainty ────────────────────────────────────────────────────────
    -- Citizen data is sparse and uneven. Rather than discard weak observations
    -- or pretend they are authoritative, every score carries an explicit band.
    confidence           Float32 COMMENT '0..1 composite confidence',
    sohi_low             Float32 COMMENT 'Lower bound of the credible interval',
    sohi_high            Float32 COMMENT 'Upper bound of the credible interval',

    -- Confidence inputs stored individually so the UI can explain *why* a score
    -- is uncertain — "two novice observers, no DO reading in 9 days" is
    -- actionable feedback to a coordinator; a bare 0.42 is not.
    completeness         Float32 COMMENT 'Share of index parameters actually present',
    density_score        Float32 COMMENT 'Observation count relative to target cadence',
    recency_score        Float32 COMMENT 'Decay against age of most recent observation',
    observer_weight      Float32 COMMENT 'Mean observer reliability weight',
    agreement_score      Float32 COMMENT 'Within-day concordance between observers',

    n_obs                UInt16,
    n_observers          UInt16,
    days_since_last_obs  UInt16,

    -- ─── explainability ─────────────────────────────────────────────────────
    -- Ranked (parameter, contribution) pairs. Negative contributions are what
    -- is dragging the score down; this is what the site detail view renders as
    -- the decomposition, and what the insight rules consume as candidate causes.
    drivers              Array(Tuple(String, Float32)),

    method_version       LowCardinality(String),
    computed_at          DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(computed_at)
PARTITION BY toYYYYMM(day)
ORDER BY (site_id, day)
COMMENT 'Computed SOHI with sub-indices, uncertainty and score decomposition';


-- ─── Current state per site ──────────────────────────────────────────────────
--
-- A TABLE, not a view over the latest day.
--
-- The obvious implementation — argMax(sohi, day) — turned out to be actively
-- misleading. Sites are sampled irregularly, so "the most recent day with data"
-- can be four days ago at one site and yesterday at another, and a single day's
-- score at a sparsely sampled site is dominated by whatever the weather was
-- doing that morning. Ranking twelve sites that way scrambled a gradient that is
-- unambiguous in the underlying data: the culverted urban reach appeared
-- healthier than the peri-urban ones it is plainly worse than.
--
-- The headline is therefore a trailing 14-day summary, written by the batch
-- scorer rather than derived in SQL. That keeps classification in the one place
-- it is defined — `classifySohi` in @neer/scoring — instead of duplicating the
-- class boundaries into a multiIf here, where the two would drift apart the
-- first time anyone recalibrated. Fourteen days also matches the window the
-- confidence model already assumes.

CREATE TABLE IF NOT EXISTS site_health_current
(
    site_id              LowCardinality(String),
    /** Most recent day contributing to this summary. */
    as_of                Date,
    /** First day of the trailing window. */
    window_start         Date,
    window_days          UInt16,

    sohi                 Float32,
    status               Enum8('bad' = 1, 'poor' = 2, 'moderate' = 3, 'good' = 4, 'high' = 5),
    ecological_score     Float32,
    pressure_score       Float32,
    exposure_score       Float32,
    confidence           Float32,
    sohi_low             Float32,
    sohi_high            Float32,

    n_obs                UInt32,
    n_observers          UInt32,
    days_since_last_obs  UInt16,
    /** Score decomposition from the most recent scored day in the window. */
    drivers              Array(Tuple(String, Float32)),

    method_version       LowCardinality(String),
    computed_at          DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(computed_at)
ORDER BY site_id
COMMENT 'Trailing-window headline index per site — what the overview map reads';


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
FROM sites AS s
LEFT JOIN site_health_current AS c ON c.site_id = s.site_id;
