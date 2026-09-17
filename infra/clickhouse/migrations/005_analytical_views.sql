-- ─────────────────────────────────────────────────────────────────────────────
-- 005 · Analytical views
--
-- Two views that carry most of the interpretive weight in the product.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── observation_context ─────────────────────────────────────────────────────
-- Every field observation, joined to the environmental conditions that actually
-- prevailed at the moment it was taken.
--
-- This is an ASOF JOIN, not an equi-join, because the two series are recorded on
-- unrelated clocks: a volunteer samples at 09:14 on a Saturday, the weather
-- archive ticks hourly. ASOF resolves each observation against the most recent
-- preceding reading in a single pass over sorted data — the alternative
-- (a range join, or bucketing both sides to the hour and equi-joining) is either
-- quadratic or silently wrong at bucket boundaries.
--
-- Interpretation depends on this. "Dissolved oxygen 4.1 mg/L" is a number;
-- "dissolved oxygen 4.1 mg/L, 31°C air temperature, 38 mm of rain in the
-- preceding 48 hours after 11 dry days" is a hypothesis about a first-flush
-- sewer spill.

CREATE VIEW IF NOT EXISTS observation_context AS
SELECT
    o.observation_id            AS observation_id,
    o.site_id                   AS site_id,
    o.observed_at               AS observed_at,
    o.observer_id               AS observer_id,
    o.observer_experience       AS observer_experience,
    o.method                    AS method,

    o.water_temp_c              AS water_temp_c,
    o.ph                        AS ph,
    o.dissolved_oxygen_mgl      AS dissolved_oxygen_mgl,
    o.conductivity_uscm         AS conductivity_uscm,
    o.turbidity_ntu             AS turbidity_ntu,
    o.nitrate_mgl               AS nitrate_mgl,
    o.phosphate_mgl             AS phosphate_mgl,
    o.ammonium_mgl              AS ammonium_mgl,

    o.water_colour              AS water_colour,
    o.odour                     AS odour,
    o.foam_present              AS foam_present,
    o.litter_score              AS litter_score,
    o.algae_cover_pct           AS algae_cover_pct,
    o.flow_state                AS flow_state,
    o.riparian_score            AS riparian_score,
    o.visible_discharge         AS visible_discharge,
    o.taxa_groups               AS taxa_groups,
    o.taxa_abundance            AS taxa_abundance,

    -- environmental conditions at time of sampling
    e.recorded_at               AS context_recorded_at,
    e.air_temp_c                AS air_temp_c,
    e.precipitation_mm          AS precipitation_mm,
    e.precip_24h_mm             AS precip_24h_mm,
    e.precip_48h_mm             AS precip_48h_mm,
    e.precip_7d_mm              AS precip_7d_mm,
    e.dry_days_before           AS dry_days_before,
    e.discharge_m3s             AS discharge_m3s
FROM observations AS o
ASOF LEFT JOIN env_readings AS e
    ON o.site_id = e.site_id
   AND toDateTime(o.observed_at) >= e.recorded_at;


-- ─── site_daily_trends ───────────────────────────────────────────────────────
-- Finalised daily values with 7- and 30-day rolling means and a day-over-day
-- delta, computed with window functions over the merged aggregate state.
--
-- Rolling means are what make a trend legible: raw citizen data is spiky because
-- sampling is irregular, and a single low reading is noise, not a trend. The
-- 7d/30d pair is what the anomaly detector compares to separate "unusual today"
-- from "steadily declining for a month" — two findings that call for completely
-- different responses.

CREATE VIEW IF NOT EXISTS site_daily_trends AS
SELECT
    site_id,
    day,
    n_obs,
    do_mgl,
    turbidity_ntu,
    nitrate_mgl,
    phosphate_mgl,
    litter,

    avg(do_mgl)        OVER w7  AS do_ma7,
    avg(do_mgl)        OVER w30 AS do_ma30,
    avg(turbidity_ntu) OVER w7  AS turbidity_ma7,
    avg(nitrate_mgl)   OVER w7  AS nitrate_ma7,

    do_mgl - any(do_mgl) OVER (PARTITION BY site_id ORDER BY day ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING) AS do_delta_1d,
    avg(do_mgl) OVER w7 - avg(do_mgl) OVER w30 AS do_ma7_vs_ma30
FROM
(
    SELECT
        site_id,
        day,
        countMerge(obs_count)      AS n_obs,
        avgMerge(do_avg)           AS do_mgl,
        avgMerge(turbidity_avg)    AS turbidity_ntu,
        avgMerge(nitrate_avg)      AS nitrate_mgl,
        avgMerge(phosphate_avg)    AS phosphate_mgl,
        avgMerge(litter_avg)       AS litter
    FROM site_daily_metrics
    GROUP BY site_id, day
)
WINDOW
    w7  AS (PARTITION BY site_id ORDER BY day ROWS BETWEEN 6  PRECEDING AND CURRENT ROW),
    w30 AS (PARTITION BY site_id ORDER BY day ROWS BETWEEN 29 PRECEDING AND CURRENT ROW);
