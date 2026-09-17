-- ─────────────────────────────────────────────────────────────────────────────
-- K-means site archetypes
--
-- The operational question this answers: a network of a hundred sites across
-- five cities cannot be managed one reach at a time, and "which sites behave
-- alike" is what turns it into a small number of intervention classes.
--
-- Clustering also transfers knowledge across the network. A site with three
-- months of data and no findings is not necessarily healthy — it may simply be
-- under-observed. Knowing which well-characterised sites it resembles gives a
-- prior for what to look for, and for where the next volunteer visit is worth
-- most.
--
-- STATUS: dormant, like the forecaster. Real SQL, activated only with credentials.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE MODEL `@project.@dataset.site_archetypes`
OPTIONS (
  MODEL_TYPE            = 'KMEANS',
  -- Let BigQuery choose k by Davies-Bouldin index rather than asserting a
  -- number. Picking k by hand across twelve sites would be fitting the author's
  -- intuition and calling it a result.
  NUM_CLUSTERS          = HPARAM_RANGE(2, 6),
  KMEANS_INIT_METHOD    = 'KMEANS++',
  -- Features span wildly different scales — percentages, microsiemens, counts —
  -- so without standardisation conductivity alone would dominate every distance
  -- calculation and the clusters would be a conductivity histogram.
  STANDARDIZE_FEATURES  = TRUE,
  DISTANCE_TYPE         = 'EUCLIDEAN'
) AS
SELECT
  -- site_id is deliberately excluded from the feature set. Clustering on an
  -- identifier lets a model memorise sites instead of characterising them.
  AVG(h.sohi)                     AS mean_sohi,
  STDDEV(h.sohi)                  AS sohi_volatility,
  AVG(h.ecological_score)         AS mean_ecological,
  AVG(h.pressure_score)           AS mean_pressure,
  AVG(h.exposure_score)           AS mean_exposure,
  AVG(h.confidence)               AS mean_confidence,
  ANY_VALUE(s.impervious_pct)     AS impervious_pct,
  ANY_VALUE(CAST(s.combined_sewer AS INT64)) AS combined_sewer,
  ANY_VALUE(s.upstream_area_km2)  AS upstream_area_km2,
  ANY_VALUE(s.stream_order)       AS stream_order
FROM `@project.@dataset.site_health_daily` AS h
JOIN `@project.@dataset.sites` AS s USING (site_id)
GROUP BY h.site_id
-- A site with a fortnight of data has no stable mean to cluster on, and
-- including it would pull a centroid toward pure sampling noise.
HAVING COUNT(*) >= 30;


-- ─── Archetype profiles ──────────────────────────────────────────────────────
-- What each cluster actually is, in terms a catchment manager can act on.
SELECT
  CENTROID_ID                     AS archetype,
  COUNT(*)                        AS sites,
  ROUND(AVG(mean_sohi), 1)        AS mean_sohi,
  ROUND(AVG(sohi_volatility), 2)  AS volatility,
  ROUND(AVG(mean_ecological), 1)  AS ecological,
  ROUND(AVG(mean_pressure), 1)    AS pressure,
  ROUND(AVG(mean_exposure), 1)    AS exposure,
  ROUND(AVG(impervious_pct), 1)   AS impervious_pct
FROM ML.PREDICT(
  MODEL `@project.@dataset.site_archetypes`,
  (SELECT * FROM `@project.@dataset.site_features`)
)
GROUP BY archetype
ORDER BY mean_sohi;
