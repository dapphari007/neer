import { computeCcmeWqi, DEFAULT_OBJECTIVES, type CcmeResult, type Measurement, type Objective } from './ccme';
import { computeBiotic, type BioticResult } from './biotic';
import { SOURCES, type Provenance } from './provenance';
import type { TaxonGroup } from '@neer/shared';

/**
 * E — the ecological integrity sub-index.
 *
 * This module encodes an asymmetry that most composite indices flatten away, and
 * getting it right is what makes the output legible to anyone working to the
 * Water Framework Directive.
 *
 * Under the Directive, biological and physico-chemical elements are **not**
 * interchangeable. Reading the Annex V classification flowchart:
 *
 *   · Biology alone determines Moderate, Poor and Bad. Physico-chemistry cannot
 *     push a classification below Good on its own.
 *   · Physico-chemistry can *prevent* High status, and through one-out-all-out
 *     can cap at Moderate — but it cannot reach down into Poor or Bad.
 *   · Hydromorphology only ever distinguishes High from Good.
 *
 * So a site with clean chemistry and a collapsed invertebrate community is
 * degraded, and a site with no biological survey cannot be called pristine no
 * matter how good its chemistry looks. A naive weighted average of the two
 * reports the opposite in both cases.
 *
 * The other half of the design answers a warning from UKTAG: strict
 * one-out-all-out amplifies measurement error, and the probability of wrongly
 * downgrading a site rises with the number of quality elements assessed. With
 * ordinal, kit-derived citizen data that effect would be severe. Neer therefore
 * takes the Directive's *ordering* — biology primary, chemistry as a ceiling —
 * without taking its brittleness, and reports the limiting element and a
 * confidence level alongside the class rather than the class alone.
 */

export interface EcologicalInputs {
  readonly measurements: readonly Measurement[];
  readonly taxaGroups: readonly TaxonGroup[];
  readonly taxaAbundance: readonly number[];
  readonly referenceAspt?: number;
  readonly objectives?: readonly Objective[];
}

export interface EcologicalResult {
  readonly score: number;
  readonly ccme: CcmeResult;
  readonly biotic: BioticResult;
  /**
   * Which element limited the score. Under the WFD ordering this is nearly
   * always biology where biology exists, and naming it is what turns a number
   * into a decision about what to survey next.
   */
  readonly limitingElement: 'biology' | 'physico_chemical' | 'none';
  /** True when no biological survey was available, so High status is unreachable. */
  readonly biologyMissing: boolean;
  readonly provenance: Provenance;
  readonly notes: readonly string[];
}

/** Score ceiling applied when physico-chemistry fails badly. */
const PHYSCHEM_CAP_MODERATE = 60;
/** Score ceiling applied when no biological survey exists. */
const NO_BIOLOGY_CAP_GOOD = 78;

export function computeEcological(i: EcologicalInputs): EcologicalResult {
  const ccme = computeCcmeWqi(i.measurements, i.objectives ?? DEFAULT_OBJECTIVES);
  const biotic = computeBiotic(i.taxaGroups, i.taxaAbundance, i.referenceAspt);
  const notes: string[] = [];

  const hasBiology = biotic.score !== null;
  const hasChemistry = ccme.testsTotal > 0;

  let score: number;
  let limitingElement: EcologicalResult['limitingElement'];

  if (hasBiology && hasChemistry) {
    // Biology leads. Chemistry acts as a ceiling, never as an averaging partner,
    // so good chemistry cannot lift a collapsed community.
    score = biotic.score!;
    limitingElement = 'biology';

    if (ccme.wqi < 45) {
      // CCME "Poor" — chemistry caps the site at Moderate regardless of biology.
      if (score > PHYSCHEM_CAP_MODERATE) {
        score = PHYSCHEM_CAP_MODERATE;
        limitingElement = 'physico_chemical';
        notes.push(
          `Physico-chemical quality (CCME WQI ${ccme.wqi.toFixed(0)}, ${ccme.category}) caps ecological status at Moderate despite the biological community scoring higher.`,
        );
      }
    } else if (ccme.wqi < 80 && score > 80) {
      // Chemistry below CCME "Good" prevents High status.
      score = 80;
      limitingElement = 'physico_chemical';
      notes.push(
        `Physico-chemical quality prevents High status; biology alone would support it.`,
      );
    }
  } else if (hasBiology) {
    score = biotic.score!;
    limitingElement = 'biology';
    notes.push('No physico-chemical measurements in this window; score rests on biology alone.');
  } else if (hasChemistry) {
    // Chemistry only. Cannot reach High, and cannot be driven below Moderate
    // either — the Directive does not let chemistry alone assert Poor or Bad,
    // and neither does Neer.
    score = Math.max(PHYSCHEM_CAP_MODERATE, Math.min(NO_BIOLOGY_CAP_GOOD, ccme.wqi));
    limitingElement = 'physico_chemical';
    notes.push(
      'No biological survey in this window. Physico-chemistry alone cannot establish High status, nor assert Poor or Bad — the score is bounded accordingly and a survey is the highest-value next observation.',
    );
  } else {
    score = 0;
    limitingElement = 'none';
    notes.push('No ecological data in this window.');
  }

  if (biotic.tolerantDominance !== null && biotic.tolerantDominance > 0.8) {
    notes.push(
      `Pollution-tolerant taxa make up ${(biotic.tolerantDominance * 100).toFixed(0)}% of recorded abundance. ASPT is a presence/absence measure and does not register this, so the community may be more degraded than the score alone suggests.`,
    );
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    ccme,
    biotic,
    limitingElement,
    biologyMissing: !hasBiology,
    provenance: {
      ...SOURCES.UKTAG_CLASSIFICATION,
      kind: 'derived',
      note: 'Element ordering follows the WFD Annex V classification flowchart: biology determines Moderate and below, physico-chemistry acts as a ceiling. Strict one-out-all-out is deliberately not applied, per the UKTAG warning that it amplifies measurement error as element count rises.',
    },
    notes,
  };
}
