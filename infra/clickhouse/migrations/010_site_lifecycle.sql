-- ─────────────────────────────────────────────────────────────────────────────
-- 010 · Site lifecycle
--
-- Sensor sites are created at runtime from whatever stations are reporting.
-- Sondes are deployed for a campaign and moved on, so a station followed last
-- week may be absent from this week's discovery. Its history stays — no
-- observation or daily score is ever deleted — but the site itself has to leave
-- the map and the overview, or the dashboard fills with pins that will never
-- update again.
--
-- `active` is that switch. Retiring a site is an INSERT of its row with
-- `active = 0` and a newer `updated_at`; the ReplacingMergeTree keeps the newer
-- version. A station that reports again is re-inserted with `active = 1`.
-- Nothing is deleted, which is what keeps this reversible.
--
-- The two views that present sites are recreated to honour the flag. Existing
-- rows read the column default, so nothing needs a backfill.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE sites
    ADD COLUMN IF NOT EXISTS active UInt8 DEFAULT 1
        COMMENT '0 = retired: history kept, hidden from the map and the overview';


CREATE OR REPLACE VIEW site_health_overview AS
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
LEFT JOIN (SELECT * FROM site_health_current FINAL) AS c ON c.site_id = s.site_id
WHERE s.active = 1;


CREATE OR REPLACE VIEW findings_active AS
SELECT
    f.finding_id      AS finding_id,
    f.site_id         AS site_id,
    s.name            AS site_name,
    s.catchment       AS catchment,
    s.lat             AS lat,
    s.lon             AS lon,
    f.day             AS day,
    f.rule_id         AS rule_id,
    f.rule_version    AS rule_version,
    f.domain          AS domain,
    f.severity        AS severity,
    f.confidence      AS confidence,
    f.headline        AS headline,
    f.mechanism       AS mechanism,
    f.evidence        AS evidence,
    f.metrics         AS metrics,
    f.citations       AS citations,
    f.action_citizen  AS action_citizen,
    f.action_municipal AS action_municipal,
    f.action_health   AS action_health,
    f.detected_at     AS detected_at,
    f.valid_until     AS valid_until,
    toUInt8(f.severity) * 10 + toUInt8(f.confidence) AS rank_score
FROM findings AS f FINAL
INNER JOIN (SELECT * FROM sites FINAL WHERE active = 1) AS s ON s.site_id = f.site_id
WHERE f.valid_until >= now()
ORDER BY f.site_id, f.rule_id, f.day DESC
LIMIT 1 BY f.site_id, f.rule_id;
