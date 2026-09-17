import { describe, expect, it } from 'vitest';
import type { RuleContext } from '@neer/shared';
import { evaluateRules, type Rule } from './engine';
import { RULES, RULES_BY_ID } from './rules';

/**
 * Rule engine tests.
 *
 * These assert the safety properties rather than the arithmetic. The arithmetic
 * is trivial; what matters is that a rule does not fire on insufficient
 * evidence, that a confident rule cannot launder thin data into a confident
 * public health statement, and that every finding can be audited.
 */

const NOW = new Date('2026-09-15T12:00:00Z');
const fixedId = () => '00000000-0000-4000-8000-000000000000';

function context(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    siteId: 'TEST-01',
    day: '2026-07-20',
    site: {
      name: 'Test Reach',
      catchment: 'Testwater',
      urbanClass: 'urban_core',
      combinedSewer: true,
      recreationalAccess: true,
      nearestContactM: 100,
      populationWithin1km: 8000,
      imperviousPct: 70,
      referenceDoMgl: 9,
      ...overrides.site,
    },
    current: {
      dissolvedOxygenMgl: 8.5,
      waterTempC: 18,
      ph: 7.4,
      nitrateMgl: 5,
      phosphateMgl: 0.1,
      ammoniumMgl: 0.1,
      turbidityNtu: 8,
      conductivityUscm: 300,
      litterScore: 0,
      sewageOdourRate: 0,
      visibleDischargeRate: 0,
      algaeCoverPct: 0,
      stagnantFraction: 0,
      outfallCount: 1,
      aspt: 6.2,
      tolerantDominance: 0.2,
      ...overrides.current,
    },
    ma7: { sohi: 70, ...overrides.ma7 },
    ma30: { sohi: 70, phosphateMgl: 0.1, ...overrides.ma30 },
    env: {
      tempMeanC: 18,
      tempMaxC: 22,
      precipMm: 0,
      precip48hMm: 0,
      precip7dMm: 0,
      dryDaysBefore: 2,
      dischargeM3s: 4,
      consecutiveHotDays: 0,
      ...overrides.env,
    },
    health: {
      sohi: 70,
      ecologicalScore: 72,
      pressureScore: 65,
      exposureScore: 75,
      confidence: 0.8,
      sohiDelta7d: 0,
      sohiDelta30d: 0,
      ...overrides.health,
    },
    nObs: 4,
    daysSinceLastObs: 1,
    ...overrides,
  } as RuleContext;
}

const run = (ctx: RuleContext, rules: readonly Rule[] = RULES) =>
  evaluateRules(ctx, rules, { now: NOW, makeId: fixedId });

// ─── Catalogue integrity ──────────────────────────────────────────────────────

describe('rule catalogue', () => {
  it('gives every rule a stable id, version, rationale and citations field', () => {
    for (const rule of RULES) {
      expect(rule.id, 'id').toMatch(/^[a-z0-9-]+$/);
      expect(rule.version, `${rule.id} version`).toMatch(/^\d+\.\d+\.\d+$/);
      expect(rule.title.length, `${rule.id} title`).toBeGreaterThan(0);
      expect(rule.rationale.length, `${rule.id} rationale`).toBeGreaterThan(20);
      expect(Array.isArray(rule.citations), `${rule.id} citations`).toBe(true);
    }
  });

  it('has no duplicate rule ids', () => {
    expect(RULES_BY_ID.size).toBe(RULES.length);
  });

  it('cites a source for every rule that asserts a threshold', () => {
    // monitoring-gap is the one rule with no external threshold to cite: it
    // reports the absence of data, which needs no standard.
    for (const rule of RULES) {
      if (rule.id === 'monitoring-gap') continue;
      expect(rule.citations.length, `${rule.id} must cite a source`).toBeGreaterThan(0);
    }
  });
});

// ─── Purity ───────────────────────────────────────────────────────────────────

describe('purity', () => {
  it('produces identical output for identical input', () => {
    const ctx = context({ env: { precip48hMm: 40, dryDaysBefore: 12 } as never });
    const first = run(ctx);
    const second = run(ctx);
    expect(first).toEqual(second);
  });

  it('does not mutate the context it is given', () => {
    const ctx = context();
    const snapshot = structuredClone(ctx);
    run(ctx);
    expect(ctx).toEqual(snapshot);
  });
});

// ─── Evidence thresholds ──────────────────────────────────────────────────────

describe('cso-first-flush', () => {
  const stormy = (overrides: Partial<RuleContext['current']> = {}) =>
    context({
      env: { precip48hMm: 38, dryDaysBefore: 11 } as never,
      current: overrides as never,
    });

  it('does not fire on rainfall alone', () => {
    // Rain is a forecast, not a finding. Without an observed symptom this would
    // fire on every summer storm and train people to ignore it.
    const findings = run(stormy());
    expect(findings.find((f) => f.ruleId === 'cso-first-flush')).toBeUndefined();
  });

  it('fires once an observed symptom corroborates the weather', () => {
    const findings = run(stormy({ sewageOdourRate: 0.5 }));
    const cso = findings.find((f) => f.ruleId === 'cso-first-flush');
    expect(cso).toBeDefined();
    expect(cso!.evidence.join(' ')).toMatch(/sewage odour/i);
  });

  it('escalates severity with the number of corroborating signals', () => {
    const one = run(stormy({ sewageOdourRate: 0.5 })).find((f) => f.ruleId === 'cso-first-flush')!;
    const three = run(
      stormy({ sewageOdourRate: 0.9, visibleDischargeRate: 0.8, dissolvedOxygenMgl: 3.2 }),
    ).find((f) => f.ruleId === 'cso-first-flush')!;

    const rank = { info: 0, watch: 1, elevated: 2, high: 3 } as const;
    expect(rank[three.severity]).toBeGreaterThan(rank[one.severity]);
  });

  it('never fires on a catchment without a combined sewer', () => {
    const findings = run(
      context({
        site: { combinedSewer: false } as never,
        env: { precip48hMm: 60, dryDaysBefore: 20 } as never,
        current: { sewageOdourRate: 1, visibleDischargeRate: 1 } as never,
      }),
    );
    expect(findings.find((f) => f.ruleId === 'cso-first-flush')).toBeUndefined();
  });

  it('names the Bathing Water limits without claiming a Directive class', () => {
    const cso = run(stormy({ sewageOdourRate: 0.6 })).find((f) => f.ruleId === 'cso-first-flush')!;
    expect(cso.actions.health).toMatch(/cannot measure/i);
    expect(cso.actions.health).toMatch(/confirmatory sampling/i);
  });
});

describe('hypoxia', () => {
  it('fires when oxygen is low relative to what temperature allows', () => {
    const findings = run(context({ current: { dissolvedOxygenMgl: 3, waterTempC: 14 } as never }));
    expect(findings.find((f) => f.ruleId === 'hypoxia')).toBeDefined();
  });

  /**
   * The seasonal confounder, and the reason this rule is not a threshold.
   * Warm water physically holds less oxygen. A rule firing on an absolute
   * value alone raises an alarm at every site every August, and an alarm that
   * always fires is one nobody reads.
   */
  it('does not fire when temperature alone explains the low reading', () => {
    const findings = run(
      context({ current: { dissolvedOxygenMgl: 5.9, waterTempC: 30 } as never }),
    );
    expect(findings.find((f) => f.ruleId === 'hypoxia')).toBeUndefined();
  });

  it('reports percentage saturation as evidence, not just the raw value', () => {
    const hypoxia = run(
      context({ current: { dissolvedOxygenMgl: 2.5, waterTempC: 16 } as never }),
    ).find((f) => f.ruleId === 'hypoxia')!;
    expect(hypoxia.evidence.join(' ')).toMatch(/saturation/i);
  });
});

describe('cyanobacteria-alert-2', () => {
  it('fires at high severity on visible scum where public contact occurs', () => {
    const findings = run(
      context({ current: { algaeCoverPct: 75, waterTempC: 26, phosphateMgl: 0.9 } as never }),
    );
    const bloom = findings.find((f) => f.ruleId === 'cyanobacteria-alert-2');
    expect(bloom?.severity).toBe('high');
    expect(bloom!.evidence.join(' ')).toMatch(/WHO Alert Level 2/i);
  });

  it('warns about dogs specifically, which is where the fatal risk sits', () => {
    const bloom = run(context({ current: { algaeCoverPct: 80 } as never })).find(
      (f) => f.ruleId === 'cyanobacteria-alert-2',
    )!;
    expect(bloom.actions.citizen).toMatch(/dog/i);
  });

  it('does not treat clear water as proof of safety', () => {
    const bloom = run(context({ current: { algaeCoverPct: 70 } as never })).find(
      (f) => f.ruleId === 'cyanobacteria-alert-2',
    )!;
    expect(bloom.actions.health).toMatch(/clear water does not mean safe water/i);
  });
});

describe('monitoring-gap', () => {
  it('stays quiet while a site is being observed', () => {
    expect(
      run(context({ daysSinceLastObs: 5 })).find((f) => f.ruleId === 'monitoring-gap'),
    ).toBeUndefined();
  });

  it('reports a long gap as a finding in its own right', () => {
    const gap = run(context({ daysSinceLastObs: 40 })).find((f) => f.ruleId === 'monitoring-gap');
    expect(gap).toBeDefined();
    // The point of the rule: silence must not be read as safety.
    expect(gap!.actions.health).toMatch(/absence of observation/i);
  });
});

// ─── Confidence handling ──────────────────────────────────────────────────────

describe('confidence tempering', () => {
  /**
   * A rule can be certain of its own logic while the data beneath it is thin.
   * Reporting rule certainty alone would let one novice observation produce a
   * high-confidence public health statement.
   */
  it('caps rule confidence at the confidence of the data beneath it', () => {
    const strongData = run(
      context({
        env: { precip48hMm: 38, dryDaysBefore: 11 } as never,
        current: { sewageOdourRate: 0.9, visibleDischargeRate: 0.8 } as never,
        health: { confidence: 0.9 } as never,
      }),
    ).find((f) => f.ruleId === 'cso-first-flush')!;

    const weakData = run(
      context({
        env: { precip48hMm: 38, dryDaysBefore: 11 } as never,
        current: { sewageOdourRate: 0.9, visibleDischargeRate: 0.8 } as never,
        health: { confidence: 0.15 } as never,
      }),
    ).find((f) => f.ruleId === 'cso-first-flush')!;

    expect(strongData.confidence).toBe('high');
    expect(weakData.confidence).toBe('low');
  });
});

// ─── Output contract ──────────────────────────────────────────────────────────

describe('findings', () => {
  const noisy = context({
    current: { dissolvedOxygenMgl: 2.4, waterTempC: 15, aspt: 2.8, outfallCount: 5 } as never,
    env: { precip48hMm: 40, dryDaysBefore: 14 } as never,
    health: { sohiDelta30d: -22, sohiDelta7d: -9, confidence: 0.7 } as never,
  });

  it('orders worst first: severity, then rule confidence', () => {
    const rank = { info: 0, watch: 1, elevated: 2, high: 3 } as const;
    const findings = run(noisy);
    expect(findings.length).toBeGreaterThan(1);
    for (let i = 1; i < findings.length; i++) {
      expect(rank[findings[i - 1]!.severity]).toBeGreaterThanOrEqual(rank[findings[i]!.severity]);
    }
  });

  it('gives every finding all three audience actions', () => {
    for (const finding of run(noisy)) {
      expect(finding.actions.citizen.length, finding.ruleId).toBeGreaterThan(20);
      expect(finding.actions.municipal.length, finding.ruleId).toBeGreaterThan(20);
      expect(finding.actions.health.length, finding.ruleId).toBeGreaterThan(20);
    }
  });

  it('writes distinct advice per audience rather than repeating one narrative', () => {
    for (const finding of run(noisy)) {
      expect(finding.actions.citizen, finding.ruleId).not.toBe(finding.actions.municipal);
      expect(finding.actions.municipal, finding.ruleId).not.toBe(finding.actions.health);
    }
  });

  it('drops absent metrics instead of encoding them as an impossible value', () => {
    // An ammonium concentration of -1 in an audit trail is exactly the kind of
    // number that later gets read as though it could occur.
    const findings = run(
      context({
        current: { dissolvedOxygenMgl: 2.5, waterTempC: 15, ammoniumMgl: null } as never,
      }),
    );
    const hypoxia = findings.find((f) => f.ruleId === 'hypoxia')!;
    expect(hypoxia.metrics).not.toHaveProperty('ammoniumMgl');
    for (const [key, value] of Object.entries(hypoxia.metrics)) {
      expect(Number.isFinite(value), key).toBe(true);
    }
  });

  it('sets a validity window that ends after it begins', () => {
    for (const finding of run(noisy)) {
      expect(Date.parse(finding.validUntil)).toBeGreaterThan(Date.parse(finding.detectedAt));
    }
  });

  it('takes its timestamp from the injected clock, never from the system clock', () => {
    for (const finding of run(noisy)) {
      expect(finding.detectedAt).toBe(NOW.toISOString());
    }
  });
});

// ─── Robustness ───────────────────────────────────────────────────────────────

describe('robustness', () => {
  it('survives a rule that throws, and still evaluates the rest', () => {
    const exploding: Rule = {
      id: 'exploding-rule',
      version: '1.0.0',
      domain: 'ecological',
      title: 'Always throws',
      rationale: 'Test fixture that raises on evaluation.',
      citations: [],
      evaluate() {
        throw new Error('boom');
      },
    };

    const findings = run(
      context({ current: { dissolvedOxygenMgl: 2.5, waterTempC: 15 } as never }),
      [exploding, ...RULES],
    );
    expect(findings.find((f) => f.ruleId === 'hypoxia')).toBeDefined();
    expect(findings.find((f) => f.ruleId === 'exploding-rule')).toBeUndefined();
  });

  it('handles a context with no measurements at all', () => {
    const empty = context({
      current: Object.fromEntries(
        Object.keys(context().current).map((key) => [key, null]),
      ) as never,
    });
    expect(() => run(empty)).not.toThrow();
  });
});
