import { describe, expect, it } from 'vitest';
import { ASPT_EQR_BOUNDARIES, computeBiotic, eqrToScore, TAXON_BMWP_SCORES } from './biotic';
import { classifyQbr, computeQbr, type QbrInputs } from './qbr';
import { computeEcological } from './ecological';
import { computeConfidence, confidenceBand, OBSERVER_WEIGHTS } from './confidence';

// ─── Biotic ───────────────────────────────────────────────────────────────────

describe('computeBiotic', () => {
  it('computes ASPT as the mean tolerance score, independent of richness', () => {
    // ASPT divides by taxon count, so sampling effort cancels. This is the whole
    // reason ASPT is used here instead of a BMWP total.
    const short = computeBiotic(['stonefly', 'flat_bodied_mayfly']); // both score 10
    const long = computeBiotic([
      'stonefly',
      'flat_bodied_mayfly',
      'mayfly_ephemeridae',
      'blue_winged_olive',
    ]); // all four score 10

    expect(short.aspt).toBe(10);
    expect(long.aspt).toBe(10);
    expect(long.bmwpTotal).toBeGreaterThan(short.bmwpTotal);
    expect(long.aspt).toBe(short.aspt);
  });

  it('separates a sensitive assemblage from a tolerant one', () => {
    const clean = computeBiotic(['stonefly', 'flat_bodied_mayfly', 'cased_caddisfly']);
    const degraded = computeBiotic(['worm_oligochaeta', 'bloodworm_chironomid', 'leech']);
    expect(clean.aspt!).toBeGreaterThan(degraded.aspt!);
    expect(clean.score!).toBeGreaterThan(degraded.score!);
  });

  it('returns nulls rather than zero when no survey took place', () => {
    // Zero would assert a dead stream; null asserts an unsurveyed one.
    const r = computeBiotic([]);
    expect(r.aspt).toBeNull();
    expect(r.score).toBeNull();
    expect(r.eqr).toBeNull();
  });

  it('de-duplicates repeated groups, since BMWP is presence/absence', () => {
    const r = computeBiotic(['stonefly', 'stonefly', 'stonefly']);
    expect(r.nTaxa).toBe(1);
    expect(r.aspt).toBe(10);
  });

  it('caps EQR at 1 so an optimistic reference cannot manufacture a score above 100', () => {
    const r = computeBiotic(['stonefly'], [2], 2.0); // ASPT 10 against a reference of 2
    expect(r.eqr).toBe(1);
    expect(r.score!).toBeLessThanOrEqual(100);
  });

  it('falls back to the default reference when given a non-positive one', () => {
    const r = computeBiotic(['stonefly'], [2], 0);
    expect(Number.isFinite(r.eqr!)).toBe(true);
    expect(r.eqr!).toBeGreaterThan(0);
  });

  it('detects tolerant dominance that ASPT structurally cannot see', () => {
    // One stonefly clinging on among thousands of bloodworm. ASPT reads this as
    // a mixed community; the abundance ratio reveals what it actually is.
    const r = computeBiotic(['stonefly', 'bloodworm_chironomid'], [1, 4]);
    expect(r.tolerantDominance).not.toBeNull();
    expect(r.tolerantDominance!).toBeGreaterThan(0.9);
  });

  it('returns null dominance when abundance data is absent or mismatched', () => {
    expect(computeBiotic(['stonefly']).tolerantDominance).toBeNull();
    expect(computeBiotic(['stonefly', 'leech'], [1]).tolerantDominance).toBeNull();
  });

  it('assigns every taxon group a score in the BMWP 1..10 range', () => {
    for (const [group, entry] of Object.entries(TAXON_BMWP_SCORES)) {
      expect(entry.score, group).toBeGreaterThanOrEqual(1);
      expect(entry.score, group).toBeLessThanOrEqual(10);
      expect(entry.provenance.source, group).toBeTruthy();
    }
  });
});

describe('eqrToScore', () => {
  it('places the verified UKTAG class boundaries at the expected score anchors', () => {
    expect(eqrToScore(ASPT_EQR_BOUNDARIES.highGood)).toBeCloseTo(80, 6);
    expect(eqrToScore(ASPT_EQR_BOUNDARIES.goodModerate)).toBeCloseTo(60, 6);
    expect(eqrToScore(ASPT_EQR_BOUNDARIES.moderatePoor)).toBeCloseTo(40, 6);
    expect(eqrToScore(ASPT_EQR_BOUNDARIES.poorBad)).toBeCloseTo(20, 6);
  });

  it('would misclassify under evenly spaced bands, which is why it does not use them', () => {
    // An EQR of 0.9 is Good under the real boundaries (0.860–0.969). A naive
    // implementation using 0.8/0.6/0.4/0.2 bands would call it High.
    const score = eqrToScore(0.9);
    expect(score).toBeGreaterThanOrEqual(60);
    expect(score).toBeLessThan(80);
  });

  it('is monotonic and bounded', () => {
    let previous = -1;
    for (let eqr = 0; eqr <= 1.0001; eqr += 0.05) {
      const score = eqrToScore(Math.min(eqr, 1));
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(score).toBeGreaterThanOrEqual(previous);
      previous = score;
    }
  });
});

// ─── QBR ──────────────────────────────────────────────────────────────────────

const pristineQbr = (over: Partial<QbrInputs> = {}): QbrInputs => ({
  coverPct: 95,
  connectivityPct: 100,
  treeCoverPct: 85,
  shrubCoverPct: 60,
  helophyteChannelPct: 60,
  treesAndShrubsInterspersed: true,
  patchyDiscontinuous: false,
  geomorphType: 2,
  nativeTreeSpecies: 5,
  nativeShrubSpecies: 6,
  continuousTreeCommunityPct: 90,
  galleryStructure: true,
  manMadeBuildings: false,
  isolatedNonNativeTrees: false,
  nonNativeTreeCommunities: false,
  garbagePresent: false,
  channelAlteration: 'unmodified',
  rigidStructuresInBed: false,
  transverseStructures: false,
  ...over,
});

describe('computeQbr', () => {
  it('scores a pristine riparian corridor at the top of the scale', () => {
    const r = computeQbr(pristineQbr());
    expect(r.total).toBe(100);
    expect(r.qbrClass).toBe('natural');
  });

  it('scores a fully channelized urban reach at the bottom', () => {
    const r = computeQbr(
      pristineQbr({
        coverPct: 5,
        connectivityPct: 0,
        treeCoverPct: 0,
        shrubCoverPct: 0,
        helophyteChannelPct: 0,
        treesAndShrubsInterspersed: false,
        nativeTreeSpecies: 0,
        nativeShrubSpecies: 0,
        continuousTreeCommunityPct: 0,
        galleryStructure: false,
        manMadeBuildings: true,
        nonNativeTreeCommunities: true,
        garbagePresent: true,
        channelAlteration: 'channelized',
        rigidStructuresInBed: true,
        transverseStructures: true,
      }),
    );
    expect(r.total).toBe(0);
    expect(r.qbrClass).toBe('very_bad');
  });

  /**
   * The per-block clamp is load-bearing. Without it, generous modifiers in one
   * block would compensate for another block's collapse — which is exactly what
   * the four-block structure exists to prevent.
   */
  it('clamps each block to 0..25 so one block cannot subsidise another', () => {
    const r = computeQbr(pristineQbr({ channelAlteration: 'channelized', rigidStructuresInBed: true }));
    for (const block of r.blocks) {
      expect(block.score).toBeGreaterThanOrEqual(0);
      expect(block.score).toBeLessThanOrEqual(25);
    }
    expect(r.blocks.find((b) => b.block === 4)!.score).toBe(0);
    expect(r.total).toBeLessThan(100);
  });

  it('identifies the limiting block for targeted restoration advice', () => {
    const r = computeQbr(pristineQbr({ channelAlteration: 'channelized' }));
    expect(r.limitingBlock.block).toBe(4);
  });

  it('shifts species thresholds by geomorphological type', () => {
    // Three native tree species is top-band for type 1 but not for type 3 —
    // a narrow reach is not penalised for geology it cannot change.
    const type1 = computeQbr(pristineQbr({ geomorphType: 1, nativeTreeSpecies: 3 }));
    const type3 = computeQbr(pristineQbr({ geomorphType: 3, nativeTreeSpecies: 3 }));
    expect(type1.blocks[2]!.base).toBeGreaterThanOrEqual(type3.blocks[2]!.base);
  });

  it('classifies across the published bands, including their unreachable gaps', () => {
    expect(classifyQbr(100)).toBe('natural');
    expect(classifyQbr(95)).toBe('natural');
    expect(classifyQbr(90)).toBe('good');
    expect(classifyQbr(75)).toBe('good');
    expect(classifyQbr(70)).toBe('fair');
    expect(classifyQbr(55)).toBe('fair');
    expect(classifyQbr(50)).toBe('bad');
    expect(classifyQbr(30)).toBe('bad');
    expect(classifyQbr(25)).toBe('very_bad');
    expect(classifyQbr(0)).toBe('very_bad');
    // Values QBR cannot actually produce still classify rather than throwing.
    expect(classifyQbr(92)).toBe('good');
    expect(classifyQbr(27)).toBe('very_bad');
  });
});

// ─── Ecological: the WFD element asymmetry ────────────────────────────────────

describe('computeEcological', () => {
  const goodChemistry = [
    { parameter: 'dissolvedOxygenMgl', value: 10 },
    { parameter: 'ph', value: 7.4 },
    { parameter: 'nitrateMgl', value: 2 },
    { parameter: 'phosphateMgl', value: 0.05 },
  ];
  const badChemistry = [
    { parameter: 'dissolvedOxygenMgl', value: 2 },
    { parameter: 'ph', value: 9.8 },
    { parameter: 'nitrateMgl', value: 90 },
    { parameter: 'phosphateMgl', value: 6 },
  ];

  it('lets biology, not chemistry, drive a site below Good', () => {
    // Clean chemistry cannot rescue a collapsed invertebrate community.
    const r = computeEcological({
      measurements: goodChemistry,
      taxaGroups: ['worm_oligochaeta', 'bloodworm_chironomid'],
      taxaAbundance: [4, 4],
    });
    expect(r.limitingElement).toBe('biology');
    expect(r.score).toBeLessThan(60);
  });

  it('caps a healthy community at Moderate when chemistry fails badly', () => {
    const r = computeEcological({
      measurements: badChemistry,
      taxaGroups: ['stonefly', 'flat_bodied_mayfly', 'mayfly_ephemeridae'],
      taxaAbundance: [2, 2, 2],
    });
    expect(r.limitingElement).toBe('physico_chemical');
    expect(r.score).toBeLessThanOrEqual(60);
    expect(r.notes.join(' ')).toMatch(/caps ecological status at Moderate/i);
  });

  it('refuses to award High status without a biological survey', () => {
    const r = computeEcological({
      measurements: goodChemistry,
      taxaGroups: [],
      taxaAbundance: [],
    });
    expect(r.biologyMissing).toBe(true);
    expect(r.score).toBeLessThan(80);
    expect(r.notes.join(' ')).toMatch(/cannot establish High status/i);
  });

  it('refuses to assert Poor or Bad from chemistry alone', () => {
    // The Directive does not permit it, and neither does this model — chemistry
    // without biology is bounded on both sides, not just above.
    const r = computeEcological({
      measurements: badChemistry,
      taxaGroups: [],
      taxaAbundance: [],
    });
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.limitingElement).toBe('physico_chemical');
  });

  it('flags tolerant dominance that ASPT alone would hide', () => {
    const r = computeEcological({
      measurements: goodChemistry,
      taxaGroups: ['stonefly', 'bloodworm_chironomid', 'worm_oligochaeta'],
      taxaAbundance: [1, 4, 4],
    });
    expect(r.notes.join(' ')).toMatch(/presence\/absence measure/i);
  });

  it('reports no data rather than a score when the window is empty', () => {
    const r = computeEcological({ measurements: [], taxaGroups: [], taxaAbundance: [] });
    expect(r.limitingElement).toBe('none');
    expect(r.score).toBe(0);
  });
});

// ─── Confidence ───────────────────────────────────────────────────────────────

describe('computeConfidence', () => {
  const full = {
    parametersPresent: 5,
    parametersExpected: 5,
    nObs: 4,
    nObservers: 3,
    daysSinceLastObs: 0,
    observerExperience: ['expert', 'expert', 'trained'] as const,
    measurementCv: 0.02,
    hasBiology: true,
  };

  it('rewards complete, fresh, corroborated, expert data', () => {
    const c = computeConfidence({ ...full, observerExperience: [...full.observerExperience] });
    expect(c.overall).toBeGreaterThan(0.8);
    expect(c.completeness).toBe(1);
    expect(c.recency).toBe(1);
  });

  it('decays with staleness', () => {
    const fresh = computeConfidence({ ...full, observerExperience: [...full.observerExperience] });
    const stale = computeConfidence({
      ...full,
      observerExperience: [...full.observerExperience],
      daysSinceLastObs: 40,
    });
    expect(stale.recency).toBeLessThan(fresh.recency);
    expect(stale.overall).toBeLessThan(fresh.overall);
  });

  it('treats a lone observer as uncorroborated rather than in perfect agreement', () => {
    // Scoring a single observation as 1.0 agreement would reward thin data with
    // maximum confidence — precisely backwards.
    const solo = computeConfidence({
      ...full,
      observerExperience: ['trained'],
      nObservers: 1,
      measurementCv: null,
    });
    expect(solo.agreement).toBeLessThan(1);
    expect(solo.agreement).toBeGreaterThan(0.5);
  });

  it('penalises observer disagreement', () => {
    const agree = computeConfidence({
      ...full,
      observerExperience: [...full.observerExperience],
      measurementCv: 0.02,
    });
    const disagree = computeConfidence({
      ...full,
      observerExperience: [...full.observerExperience],
      measurementCv: 0.45,
    });
    expect(disagree.agreement).toBeLessThan(agree.agreement);
  });

  it('down-weights novices without excluding them', () => {
    expect(OBSERVER_WEIGHTS.novice).toBeLessThan(OBSERVER_WEIGHTS.expert);
    expect(OBSERVER_WEIGHTS.novice).toBeGreaterThan(0);
    const novice = computeConfidence({
      ...full,
      observerExperience: ['novice', 'novice'],
    });
    expect(novice.overall).toBeGreaterThan(0);
  });

  it('reduces completeness when biology is missing', () => {
    const withBio = computeConfidence({ ...full, observerExperience: [...full.observerExperience] });
    const without = computeConfidence({
      ...full,
      observerExperience: [...full.observerExperience],
      hasBiology: false,
    });
    expect(without.completeness).toBeLessThan(withBio.completeness);
  });

  it('keeps every component and the composite within 0..1', () => {
    const extreme = computeConfidence({
      parametersPresent: 0,
      parametersExpected: 5,
      nObs: 0,
      nObservers: 0,
      daysSinceLastObs: 3650,
      observerExperience: [],
      measurementCv: 10,
      hasBiology: false,
    });
    for (const [key, value] of Object.entries(extreme)) {
      expect(value, key).toBeGreaterThanOrEqual(0);
      expect(value, key).toBeLessThanOrEqual(1);
    }
  });
});

describe('confidenceBand', () => {
  it('collapses to a point at full confidence and widens as it falls', () => {
    expect(confidenceBand(50, 1)).toEqual({ low: 50, high: 50 });
    const loose = confidenceBand(50, 0);
    expect(loose.high - loose.low).toBeGreaterThan(50);
  });

  it('clamps asymmetrically near the ends of the scale', () => {
    expect(confidenceBand(5, 0.2).low).toBe(0);
    expect(confidenceBand(97, 0.2).high).toBe(100);
  });
});
