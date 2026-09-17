-- ─────────────────────────────────────────────────────────────────────────────
-- Anomaly detection via ARIMA_PLUS residuals
--
-- Flags days whose observed index falls outside the prediction interval of a
-- model fitted on that site's own history. This is deliberately not a fixed
-- threshold: a score of 45 is unremarkable at a culverted urban reach and
-- alarming at a semi-natural headwater, and one global cutoff cannot express
-- that difference.
--
-- It complements the rule engine rather than replacing it. The rules encode
-- known mechanisms — first-flush spills, blooms, hypoxia — and explain
-- themselves in terms a person can check. This finds departures nobody wrote a
-- rule for, and explains nothing at all. Both are needed: a system that only
-- detects what it was told to look for is blind to everything else, while one
-- that only flags statistical oddity produces alerts nobody can act on.
--
-- STATUS: dormant. The local detector covers the same ground without credentials.
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  site_id,
  DATE(day)                                AS day,
  ROUND(sohi, 1)                           AS observed,
  ROUND(lower_bound, 1)                    AS expected_lower,
  ROUND(upper_bound, 1)                    AS expected_upper,
  is_anomaly,
  ROUND(anomaly_probability, 3)            AS anomaly_probability,
  -- Direction matters for interpretation. An index above its expected band is a
  -- recovery, not an incident, and an alert list that conflates the two trains
  -- people to stop reading it.
  IF(sohi < lower_bound, 'below', 'above') AS direction
FROM ML.DETECT_ANOMALIES(
  MODEL `@project.@dataset.sohi_arima_plus`,
  -- 0.95 rather than 0.99. On series this short, a 0.99 threshold flags almost
  -- nothing, and a detector that never fires is indistinguishable from one that
  -- has been switched off.
  STRUCT(0.95 AS anomaly_prob_threshold)
)
WHERE is_anomaly
ORDER BY anomaly_probability DESC, day DESC;
