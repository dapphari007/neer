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


-- ─── Latest state per site ───────────────────────────────────────────────────
-- Uses argMax rather than a correlated subquery or a LIMIT 1 BY: a single pass
-- over the ordered data, which is what the overview map hits on every load.

CREATE VIEW IF NOT EXISTS site_health_current AS
SELECT
    h.site_id                        AS site_id,
    s.name                           AS name,
    s.catchment                      AS catchment,
    s.city                           AS city,
    s.lat                            AS lat,
    s.lon                            AS lon,
    s.urban_class                    AS urban_class,
    s.recreational_access            AS recreational_access,

    argMax(h.sohi, h.day)            AS sohi,
    argMax(h.status, h.day)          AS status,
    argMax(h.ecological_score, h.day) AS ecological_score,
    argMax(h.pressure_score, h.day)  AS pressure_score,
    argMax(h.exposure_score, h.day)  AS exposure_score,
    argMax(h.confidence, h.day)      AS confidence,
    argMax(h.sohi_low, h.day)        AS sohi_low,
    argMax(h.sohi_high, h.day)       AS sohi_high,
    argMax(h.drivers, h.day)         AS drivers,
    argMax(h.n_obs, h.day)           AS n_obs,
    argMax(h.days_since_last_obs, h.day) AS days_since_last_obs,
    max(h.day)                       AS as_of
FROM site_health_daily AS h
INNER JOIN sites AS s ON s.site_id = h.site_id
GROUP BY
    h.site_id, s.name, s.catchment, s.city, s.lat, s.lon,
    s.urban_class, s.recreational_access;
