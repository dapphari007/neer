import type { TaxonGroup } from '@neer/shared';
import { type Provenance, SOURCES, modelled } from './provenance';

/**
 * Biotic scoring from citizen-identifiable macroinvertebrate groups.
 *
 * Three decisions here are worth stating explicitly, because each rejects a more
 * obvious alternative.
 *
 * **ASPT, not BMWP total.** BMWP sums tolerance scores across all families
 * present, so it rises with the number of taxa found — which rises with how long
 * and how well someone sampled. Volunteer effort is precisely the variable that
 * is *not* standardised in citizen science. ASPT divides by the number of
 * scoring taxa, removing richness (and therefore effort) from the numerator.
 * A ten-minute sample and a thirty-minute sample of the same reach converge on
 * the same ASPT; their BMWP totals do not.
 *
 * **EQR, not raw score bands.** The widely circulated BMWP class boundaries
 * ("> 100 very good, 51–100 good…") could not be traced to any authoritative
 * source, and the UK abandoned raw BMWP classification entirely in favour of
 * WHPT with site-specific RIVPACS-predicted references. Rather than hard-code
 * folklore, scores are expressed as an Ecological Quality Ratio against a
 * type-specific reference and classified on the *verified* UKTAG WHPT-ASPT EQR
 * boundaries.
 *
 * **Unevenly spaced class boundaries.** Those boundaries are 0.969 / 0.860 /
 * 0.723 / 0.585 — not the evenly spaced 0.8 / 0.6 / 0.4 / 0.2 that an
 * implementer would naturally reach for. The High/Good cut sits within 3% of
 * reference condition. Using even bands would classify genuinely degraded
 * streams as Good, which is the single most consequential calibration error
 * available in this domain.
 */

interface TaxonScore {
  readonly score: number;
  readonly provenance: Provenance;
}

const standard = (note: string): Provenance => ({ ...SOURCES.WHPT_EQR, kind: 'standard', note });
const derived = (note: string): Provenance => ({ ...SOURCES.WHPT_EQR, kind: 'derived', note });

/**
 * BMWP tolerance scores for the field groups volunteers actually record.
 *
 * BMWP is defined at family level. Several of these field groups span multiple
 * families whose published scores differ — "cased caddisfly" covers Phryganeidae
 * (10) through Hydroptilidae (6) — so those entries are tagged `derived` and
 * take a deliberately conservative value within the family range. Being wrong
 * toward "less pristine" is the safer error for a public health-adjacent index:
 * it over-reports concern rather than under-reporting it.
 */
export const TAXON_BMWP_SCORES: Record<TaxonGroup, TaxonScore> = {
  stonefly: {
    score: 10,
    provenance: standard('Plecoptera; Perlidae and Leuctridae both score 10.'),
  },
  mayfly_ephemeridae: { score: 10, provenance: standard('Ephemeridae, BMWP 10.') },
  flat_bodied_mayfly: { score: 10, provenance: standard('Heptageniidae, BMWP 10.') },
  blue_winged_olive: { score: 10, provenance: standard('Ephemerellidae, BMWP 10.') },
  dragonfly_nymph: {
    score: 8,
    provenance: standard('Aeshnidae and Libellulidae both score 8.'),
  },
  cased_caddisfly: {
    score: 7,
    provenance: derived(
      'Spans Phryganeidae (10) to Hydroptilidae (6); 7 taken as a conservative mid-range value.',
    ),
  },
  caseless_caddisfly: {
    score: 6,
    provenance: derived('Spans Rhyacophilidae/Polycentropodidae (7) and Hydropsychidae (5).'),
  },
  freshwater_shrimp: { score: 6, provenance: standard('Gammaridae, BMWP 6.') },
  damselfly_nymph: { score: 6, provenance: standard('Coenagrionidae, BMWP 6.') },
  water_beetle: {
    score: 5,
    provenance: standard('Dytiscidae and related beetle families, BMWP 5.'),
  },
  olives_baetidae: { score: 4, provenance: standard('Baetidae, BMWP 4.') },
  snail: {
    score: 3,
    provenance: derived(
      'Spans Neritidae/Ancylidae (6) to Lymnaeidae/Physidae (3); the tolerant value is taken because Lymnaeidae and Physidae dominate urban reaches.',
    ),
  },
  hoglouse_asellus: { score: 3, provenance: standard('Asellidae, BMWP 3.') },
  leech: { score: 3, provenance: standard('Erpobdellidae and Glossiphoniidae, BMWP 3.') },
  bloodworm_chironomid: { score: 2, provenance: standard('Chironomidae, BMWP 2.') },
  worm_oligochaeta: {
    score: 1,
    provenance: standard('Oligochaeta, BMWP 1 (scored at order level).'),
  },
};

/**
 * UKTAG WHPT-ASPT Ecological Quality Ratio class boundaries.
 *
 * Verified values, and deliberately not rounded. See the class comment above for
 * why even spacing would be a serious miscalibration.
 */
export const ASPT_EQR_BOUNDARIES = {
  highGood: 0.969,
  goodModerate: 0.86,
  moderatePoor: 0.723,
  poorBad: 0.585,
  provenance: { ...SOURCES.WHPT_EQR, kind: 'standard' as const },
} as const;

/**
 * Reference ASPT for a modified urban lowland stream.
 *
 * Real WFD practice derives this per site from RIVPACS/RICT using 43 predictive
 * end-groups and site physical attributes. Neer has no such model, so this is a
 * single modelled constant — and that is a genuine limitation, stated here
 * rather than buried. Sites carry their own override where a better value is
 * known.
 */
export const DEFAULT_REFERENCE_ASPT = {
  value: 6.0,
  provenance: modelled(
    'Stand-in for a RIVPACS/RICT site-specific prediction, which Neer does not implement. Urban modified watercourses have genuinely lower reference expectations than natural reaches; using a pristine-stream reference would classify every urban site as Bad and destroy the index discriminating power.',
  ),
} as const;

export interface BioticResult {
  /** Average Score Per Taxon, 0–10. Null when no taxa were recorded. */
  readonly aspt: number | null;
  /** BMWP-style total, retained for reference only — not used for classification. */
  readonly bmwpTotal: number;
  /** Number of scoring taxa found. */
  readonly nTaxa: number;
  /** ASPT expressed against the site reference. Null when ASPT is null. */
  readonly eqr: number | null;
  /** 0–100 score derived from the EQR, for composition into the index. */
  readonly score: number | null;
  /**
   * Share of total recorded abundance made up of tolerant taxa (BMWP ≤ 3).
   *
   * BMWP and ASPT are presence/absence measures by definition, so a reach where
   * one stonefly clings on among ten thousand bloodworm scores identically to a
   * balanced assemblage. This ratio recovers the signal that ASPT structurally
   * discards, and feeds the insight rules rather than the index itself.
   */
  readonly tolerantDominance: number | null;
  readonly presentGroups: readonly TaxonGroup[];
}

/**
 * Map an EQR onto a 0–100 score using the verified class boundaries as anchors.
 *
 * Each class occupies an equal 20-point span of the output scale while occupying
 * its true, unequal span of EQR. This is what makes "62" mean "solidly Moderate"
 * to a reader and remain faithful to the WFD boundaries underneath — the
 * alternative, scoring EQR × 100 directly, would put the High/Good cut at 97 and
 * compress four of the five classes into the bottom half of the scale.
 */
export function eqrToScore(eqr: number): number {
  const b = ASPT_EQR_BOUNDARIES;
  const segment = (v: number, lo: number, hi: number, outLo: number, outHi: number): number =>
    outLo + ((v - lo) / (hi - lo)) * (outHi - outLo);

  if (eqr >= b.highGood) return Math.min(100, segment(eqr, b.highGood, 1, 80, 100));
  if (eqr >= b.goodModerate) return segment(eqr, b.goodModerate, b.highGood, 60, 80);
  if (eqr >= b.moderatePoor) return segment(eqr, b.moderatePoor, b.goodModerate, 40, 60);
  if (eqr >= b.poorBad) return segment(eqr, b.poorBad, b.moderatePoor, 20, 40);
  return Math.max(0, segment(eqr, 0, b.poorBad, 0, 20));
}

/**
 * Compute biotic metrics from a recorded assemblage.
 *
 * @param groups           Taxon groups observed.
 * @param abundance        Log-abundance band per group, parallel to `groups`.
 * @param referenceAspt    Site-specific reference ASPT.
 */
export function computeBiotic(
  groups: readonly TaxonGroup[],
  abundance: readonly number[] = [],
  referenceAspt: number = DEFAULT_REFERENCE_ASPT.value,
): BioticResult {
  const present = [...new Set(groups)].filter((g) => g in TAXON_BMWP_SCORES);

  if (present.length === 0) {
    return {
      aspt: null,
      bmwpTotal: 0,
      nTaxa: 0,
      eqr: null,
      score: null,
      tolerantDominance: null,
      presentGroups: [],
    };
  }

  const bmwpTotal = present.reduce((sum, g) => sum + TAXON_BMWP_SCORES[g].score, 0);
  const aspt = bmwpTotal / present.length;

  // Guard the reference: a non-positive reference would produce an infinite or
  // negative EQR and silently corrupt every downstream score.
  const safeReference = referenceAspt > 0 ? referenceAspt : DEFAULT_REFERENCE_ASPT.value;
  // EQR is capped at 1: a site outperforming its reference is at reference
  // condition, not better than pristine. Uncapped values would let an
  // optimistically low reference manufacture scores above 100.
  const eqr = Math.min(1, aspt / safeReference);

  // Abundance-weighted tolerant dominance, using band midpoints on the log scale
  // (band 1 = 1–9, 2 = 10–99, 3 = 100–999, 4 = 1000+).
  let tolerantDominance: number | null = null;
  if (abundance.length === groups.length && abundance.length > 0) {
    const bandWeight = (band: number): number => (band <= 0 ? 0 : 10 ** (band - 1) * 5);
    let tolerant = 0;
    let total = 0;
    groups.forEach((g, i) => {
      const scoreEntry = TAXON_BMWP_SCORES[g];
      if (!scoreEntry) return;
      const w = bandWeight(abundance[i] ?? 0);
      total += w;
      if (scoreEntry.score <= 3) tolerant += w;
    });
    tolerantDominance = total > 0 ? tolerant / total : null;
  }

  return {
    aspt,
    bmwpTotal,
    nTaxa: present.length,
    eqr,
    score: eqrToScore(eqr),
    tolerantDominance,
    presentGroups: present,
  };
}
