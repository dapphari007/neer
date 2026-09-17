import type { Finding, FindingDomain, RuleConfidence, RuleContext, Severity } from '@neer/shared';

/**
 * The One Health rule engine.
 *
 * Every statement Neer makes about a stream originates here, in a pure function
 * of a `RuleContext`. No rule reads a database, calls a network, or consults a
 * clock — which means the entire rule set is testable by constructing a context
 * literal, and every finding is exactly reproducible from the values that
 * produced it.
 *
 * **No language model participates in deciding what is true.** Prose generation,
 * where it happens at all, only renders an already-decided finding. This is the
 * load-bearing safety property of the system: a fabricated pathogen warning on a
 * public waterway either triggers an unwarranted closure or manufactures false
 * reassurance about a hazard nobody tested for, and neither is recoverable from
 * a system whose reasoning cannot be audited.
 *
 * Auditability is therefore structural. Each finding carries the rule that fired
 * it, the exact metric values behind every claim, and a citation for every
 * threshold. Any assertion can be traced back to a number and a source.
 */

export interface Rule {
  readonly id: string;
  readonly version: string;
  readonly domain: FindingDomain;
  readonly title: string;
  /** What this rule is for, in one line — shown in the rule catalogue. */
  readonly rationale: string;
  readonly citations: readonly string[];
  /** Returns null when the rule does not fire. */
  evaluate(ctx: RuleContext): RuleOutcome | null;
}

export interface RuleOutcome {
  readonly severity: Severity;
  readonly confidence: RuleConfidence;
  readonly headline: string;
  readonly mechanism: string;
  readonly evidence: readonly string[];
  readonly metrics: Readonly<Record<string, number>>;
  readonly actions: {
    readonly citizen: string;
    readonly municipal: string;
    readonly health: string;
  };
  /** Hours the finding stays current before it is treated as stale. */
  readonly validForHours?: number;
}

const DEFAULT_VALIDITY_HOURS = 14 * 24;

export interface EvaluateOptions {
  /** Injected rather than read from the clock, so evaluation stays pure. */
  readonly now: Date;
  readonly rules?: readonly Rule[];
  readonly makeId?: () => string;
}

/**
 * Downgrade a finding's confidence when the underlying index confidence is low.
 *
 * A rule can be certain about its own logic while the data beneath it is thin,
 * and reporting rule certainty alone would let a single novice observation
 * produce a high-confidence public health statement. The two are tracked
 * separately and combined here, taking the weaker.
 */
function temperConfidence(ruleConfidence: RuleConfidence, dataConfidence: number): RuleConfidence {
  const dataTier: RuleConfidence =
    dataConfidence >= 0.65 ? 'high' : dataConfidence >= 0.35 ? 'medium' : 'low';
  const order: RuleConfidence[] = ['low', 'medium', 'high'];
  return order[Math.min(order.indexOf(ruleConfidence), order.indexOf(dataTier))]!;
}

export function evaluateRules(
  ctx: RuleContext,
  rules: readonly Rule[],
  options: EvaluateOptions,
): Finding[] {
  const findings: Finding[] = [];
  const makeId = options.makeId ?? (() => crypto.randomUUID());

  for (const rule of rules) {
    let outcome: RuleOutcome | null;
    try {
      outcome = rule.evaluate(ctx);
    } catch (error) {
      // One malformed rule must not take down the whole evaluation for a site.
      // Silence here would be worse than noise, so it is reported and skipped.
      console.error(`Rule ${rule.id} threw on ${ctx.siteId} ${ctx.day}:`, error);
      continue;
    }
    if (!outcome) continue;

    const detectedAt = options.now;
    const validUntil = new Date(
      detectedAt.getTime() + (outcome.validForHours ?? DEFAULT_VALIDITY_HOURS) * 3_600_000,
    );

    findings.push({
      findingId: makeId(),
      siteId: ctx.siteId,
      day: ctx.day,
      ruleId: rule.id,
      ruleVersion: rule.version,
      domain: rule.domain,
      severity: outcome.severity,
      confidence: temperConfidence(outcome.confidence, ctx.health.confidence),
      headline: outcome.headline,
      mechanism: outcome.mechanism,
      evidence: [...outcome.evidence],
      metrics: { ...outcome.metrics },
      citations: [...rule.citations],
      actions: outcome.actions,
      detectedAt: detectedAt.toISOString(),
      validUntil: validUntil.toISOString(),
    });
  }

  // Worst first: severity, then confidence. A severe finding the engine is
  // unsure of still outranks a certain trivial one, because the cost of missing
  // the former is higher than the cost of investigating it.
  const severityRank: Record<Severity, number> = { info: 0, watch: 1, elevated: 2, high: 3 };
  const confidenceRank: Record<RuleConfidence, number> = { low: 0, medium: 1, high: 2 };

  return findings.sort(
    (a, b) =>
      severityRank[b.severity] - severityRank[a.severity] ||
      confidenceRank[b.confidence] - confidenceRank[a.confidence],
  );
}

// ─── Helpers shared by rules ──────────────────────────────────────────────────

/** Read a metric, treating absent and non-finite alike. */
export const metric = (
  source: Record<string, number | null>,
  key: string,
): number | null => {
  const value = source[key];
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
};

/** Percentage change from `from` to `to`, or null when it is undefined. */
export const pctChange = (from: number | null, to: number | null): number | null => {
  if (from === null || to === null || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
};
