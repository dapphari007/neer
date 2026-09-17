-- ─────────────────────────────────────────────────────────────────────────────
-- 004 · Daily rollups via AggregatingMergeTree + incremental materialized views
--
-- The serving layer never scans raw observations. These materialized views
-- maintain pre-aggregated daily state incrementally on insert, so a 180-day
-- trend for a site merges ~180 rows instead of scanning every field visit ever
-- recorded at it.
--
-- Aggregate *states* are stored rather than finalised values, which is what
-- makes them composable: the same table answers daily, weekly and monthly
-- questions by merging at different granularities, with no second rollup table
-- and no re-scan of the raw grain.
--
-- Read with the -Merge combinator:
--
--     SELECT site_id,
--            countMerge(obs_count)                          AS n,
--            avgMerge(do_avg)                               AS do_mgl,
--            quantilesTDigestMerge(0.1, 0.5, 0.9)(do_q)     AS do_spread
--     FROM site_daily_metrics
--     WHERE site_id = {siteId:String} AND day >= today() - 90
--     GROUP BY site_id;
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS site_daily_metrics
(
    site_id              LowCardinality(String),
    day                  Date,

    obs_count            AggregateFunction(count),
    observer_count       AggregateFunction(uniqExact, String),
    -- mean observer experience 1..4 — a direct input to the confidence model
    experience_avg       AggregateFunction(avg, UInt8),

    -- physico-chemical central tendency
    temp_avg             AggregateFunction(avg, Nullable(Float32)),
    ph_avg               AggregateFunction(avg, Nullable(Float32)),
    do_avg               AggregateFunction(avg, Nullable(Float32)),
    do_min               AggregateFunction(min, Nullable(Float32)),
    cond_avg             AggregateFunction(avg, Nullable(Float32)),
    turbidity_avg        AggregateFunction(avg, Nullable(Float32)),
    nitrate_avg          AggregateFunction(avg, Nullable(Float32)),
    phosphate_avg        AggregateFunction(avg, Nullable(Float32)),
    ammonium_avg         AggregateFunction(avg, Nullable(Float32)),

    -- within-day spread. Wide disagreement between volunteers sampling the same
    -- reach on the same day is itself evidence that the day's value is soft —
    -- the confidence model consumes this directly rather than assuming agreement.
    do_q                 AggregateFunction(quantilesTDigest(0.1, 0.5, 0.9), Nullable(Float32)),
    turbidity_q          AggregateFunction(quantilesTDigest(0.1, 0.5, 0.9), Nullable(Float32)),

    -- anthropogenic pressure signals
    litter_avg           AggregateFunction(avg, UInt8),
    riparian_avg         AggregateFunction(avg, UInt8),
    foam_rate            AggregateFunction(avg, UInt8),
    discharge_rate       AggregateFunction(avg, UInt8),
    sewage_odour_rate    AggregateFunction(avg, UInt8),
    algae_avg            AggregateFunction(avg, Nullable(UInt8))

    -- NOTE: taxon richness is deliberately NOT aggregated here. It would need
    -- arrayJoin(taxa_groups) in the view's SELECT, and arrayJoin expands the row
    -- set for *every* aggregate in that SELECT, not only the one referencing it —
    -- so countState() would count once per taxon rather than once per visit and
    -- silently inflate every observation count downstream. Richness is derived
    -- in a separate query against the raw grain instead.
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (site_id, day)
COMMENT 'Composable daily aggregate state — the dashboard serving layer';


CREATE MATERIALIZED VIEW IF NOT EXISTS site_daily_metrics_mv
TO site_daily_metrics
AS
SELECT
    site_id,
    toDate(observed_at)                                        AS day,

    countState()                                               AS obs_count,
    uniqExactState(observer_id)                                AS observer_count,
    avgState(toUInt8(observer_experience))                     AS experience_avg,

    avgState(water_temp_c)                                     AS temp_avg,
    avgState(ph)                                               AS ph_avg,
    avgState(dissolved_oxygen_mgl)                             AS do_avg,
    minState(dissolved_oxygen_mgl)                             AS do_min,
    avgState(conductivity_uscm)                                AS cond_avg,
    avgState(turbidity_ntu)                                    AS turbidity_avg,
    avgState(nitrate_mgl)                                      AS nitrate_avg,
    avgState(phosphate_mgl)                                    AS phosphate_avg,
    avgState(ammonium_mgl)                                     AS ammonium_avg,

    quantilesTDigestState(0.1, 0.5, 0.9)(dissolved_oxygen_mgl) AS do_q,
    quantilesTDigestState(0.1, 0.5, 0.9)(turbidity_ntu)        AS turbidity_q,

    avgState(litter_score)                                     AS litter_avg,
    avgState(riparian_score)                                   AS riparian_avg,
    avgState(foam_present)                                     AS foam_rate,
    avgState(visible_discharge)                                AS discharge_rate,
    avgState(toUInt8(odour = 'sewage'))                        AS sewage_odour_rate,
    avgState(algae_cover_pct)                                  AS algae_avg
FROM observations
GROUP BY site_id, day;


-- ─── Daily environmental context ─────────────────────────────────────────────
-- Already one row per site-day after aggregation and only ever read at day
-- grain, so plain values are stored rather than aggregate state.

CREATE TABLE IF NOT EXISTS site_env_daily
(
    site_id              LowCardinality(String),
    day                  Date,
    temp_mean_c          Nullable(Float32),
    temp_max_c           Nullable(Float32),
    precip_mm            Nullable(Float32),
    precip_48h_mm        Nullable(Float32),
    precip_7d_mm         Nullable(Float32),
    dry_days_before      Nullable(UInt16),
    discharge_mean_m3s   Nullable(Float32),
    updated_at           DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(day)
ORDER BY (site_id, day)
COMMENT 'Daily weather/hydrology context aligned to the health index grain';


CREATE MATERIALIZED VIEW IF NOT EXISTS site_env_daily_mv
TO site_env_daily
AS
SELECT
    site_id,
    toDate(recorded_at)        AS day,
    avg(air_temp_c)            AS temp_mean_c,
    max(air_temp_c)            AS temp_max_c,
    sum(precipitation_mm)      AS precip_mm,
    max(precip_48h_mm)         AS precip_48h_mm,
    max(precip_7d_mm)          AS precip_7d_mm,
    max(dry_days_before)       AS dry_days_before,
    avg(discharge_m3s)         AS discharge_mean_m3s,
    now()                      AS updated_at
FROM env_readings
GROUP BY site_id, day;
