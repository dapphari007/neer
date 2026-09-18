-- ─────────────────────────────────────────────────────────────────────────────
-- 007 · One Health findings — the output of the insight engine
--
-- A finding is a structured, evidence-bearing statement produced by a
-- deterministic rule, never by a language model. The rule engine decides *what
-- is true*; language generation is confined to rendering a finding into prose.
--
-- That split is deliberate and is the core safety property of this system. A
-- hallucinated pathogen-risk statement attached to a public waterway is not a
-- cosmetic bug — it either triggers an unwarranted closure or, worse, fails to
-- trigger a warranted one. So every finding here is traceable to a rule_id, a
-- set of evidence strings, the exact metric values that fired it, and a citation
-- to the standard or study the threshold came from.
--
-- The three action columns exist because the same fact demands different
-- responses from different people. A citizen needs to know whether to let a dog
-- swim; a municipal officer needs to know whether to inspect a sewer outfall;
-- a public health officer needs to know whether the exposure warrants
-- surveillance. One narrative serving all three serves none.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS findings
(
    finding_id           UUID,
    site_id              LowCardinality(String),
    day                  Date,

    -- ─── provenance ─────────────────────────────────────────────────────────
    rule_id              LowCardinality(String) COMMENT 'Stable identifier of the rule that fired',
    rule_version         LowCardinality(String),

    domain               Enum8(
                             'ecological'    = 1,
                             'pressure'      = 2,
                             'human_health'  = 3,
                             'animal_health' = 4,
                             'data_quality'  = 5
                         ),
    severity             Enum8('info' = 1, 'watch' = 2, 'elevated' = 3, 'high' = 4),
    -- Confidence is the rule's own, and is NOT the same as the index confidence:
    -- a rule can fire with high certainty on well-measured data yet describe a
    -- mechanism that is only plausible, or fire on a strong mechanism with thin
    -- data. Both are surfaced separately rather than collapsed into one number.
    confidence           Enum8('low' = 1, 'medium' = 2, 'high' = 3),

    -- ─── content ────────────────────────────────────────────────────────────
    headline             String,
    mechanism            String COMMENT 'The causal story the rule asserts, in one sentence',
    evidence             Array(String) COMMENT 'Human-readable facts that fired the rule',
    metrics              Map(String, Float64) COMMENT 'Exact values behind the evidence, for audit',
    citations            Array(String) COMMENT 'Standards or studies the thresholds derive from',

    -- ─── audience-specific actions ──────────────────────────────────────────
    action_citizen       String,
    action_municipal     String,
    action_health        String,

    -- ─── validity window ────────────────────────────────────────────────────
    detected_at          DateTime,
    valid_until          DateTime COMMENT 'After this the finding is stale and is not surfaced',

    computed_at          DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(computed_at)
PARTITION BY toYYYYMM(day)
ORDER BY (site_id, day, rule_id)
COMMENT 'Deterministic, auditable One Health findings';


-- ─── Active findings, ranked ─────────────────────────────────────────────────
--
-- The alert list shows the CURRENT state of each rule at each site — the most
-- recent day a rule fired — not every day it has ever fired.
--
-- Without the `LIMIT 1 BY`, structural findings drown everything else. A site
-- with five outfall pipes trips the AMR pressure rule every single day it has
-- data, because the pipes do not go away; in a six-month window that is one
-- rule producing hundreds of identical rows and burying the acute sewage spill
-- that actually needs attention today. Deduplicating to the latest occurrence
-- keeps a persistent condition visible exactly once, which is how often it is
-- worth saying.

CREATE VIEW IF NOT EXISTS findings_active AS
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
    -- Severity dominates, confidence breaks ties. A severe finding the engine is
    -- unsure of still outranks a certain trivial one: the cost of missing the
    -- former exceeds the cost of investigating it.
    toUInt8(f.severity) * 10 + toUInt8(f.confidence) AS rank_score
FROM findings AS f FINAL
INNER JOIN (SELECT * FROM sites FINAL) AS s ON s.site_id = f.site_id
WHERE f.valid_until >= now()
ORDER BY f.site_id, f.rule_id, f.day DESC
LIMIT 1 BY f.site_id, f.rule_id;
