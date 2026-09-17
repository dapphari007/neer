import { type Provenance, SOURCES, modelled } from './provenance';

/**
 * H — the human and animal health exposure sub-index.
 *
 * This is the part of Neer that does the thing Track 2 actually asks for:
 * turning a stream measurement into a statement about health risk. It is also
 * the part most able to do harm, so its limits are enforced in the code rather
 * than described in a footnote.
 *
 * **Everything here is a risk proxy, never a measurement.** Faecal indicators,
 * cyanotoxins, pathogens and antibiotic resistance genes are all laboratory
 * measurements. No citizen kit cultures enterococci; no volunteer runs qPCR for
 * ARGs. What volunteers *can* observe — sewage odour, visible discharge, scum,
 * stagnation, litter, water clarity, outfall pipes — are the field-observable
 * correlates of those hazards, and this module scores those correlates.
 *
 * So the output is a statement about *conditions associated with elevated risk*,
 * and every finding derived from it is phrased that way. The distinction is not
 * pedantry: asserting a measured pathogen level from a turbidity reading would
 * either trigger an unwarranted closure or, worse, manufacture false reassurance
 * about a hazard nobody actually tested for.
 *
 * Regulatory values from the Bathing Water Directive and WHO are held here as
 * the anchors these proxies are *explained in terms of* — they give a reader a
 * real yardstick for what "elevated" means, without Neer pretending to have
 * measured against them.
 */

export interface ExposureInputs {
  // ─── site context ──────────────────────────────────────────────────────────
  readonly combinedSewer: boolean;
  readonly recreationalAccess: boolean;
  /** Distance downstream to the nearest point of human contact, metres. */
  readonly nearestContactM: number;
  readonly populationWithin1km: number;
  readonly imperviousPct: number;
  /**
   * Count of stormwater / wastewater outfall pipes discharging to the reach.
   * The OneAquaHealth field protocol already records this, so it is a real
   * observation rather than a modelled input.
   */
  readonly outfallCount: number;

  // ─── observed water condition ──────────────────────────────────────────────
  readonly sewageOdourRate: number | null;
  readonly visibleDischargeRate: number | null;
  readonly turbidityNtu: number | null;
  readonly algaeCoverPct: number | null;
  /** True where a surface scum was recorded — WHO Alert Level 2 trigger. */
  readonly scumPresent: boolean;
  readonly phosphateMgl: number | null;
  readonly waterTempC: number | null;
  readonly dissolvedOxygenMgl: number | null;
  /** Fraction of the reach recorded as stagnant or with no perceptible flow. */
  readonly stagnantFraction: number | null;
  readonly litterScore: number | null;

  // ─── antecedent conditions ─────────────────────────────────────────────────
  readonly precip48hMm: number | null;
  readonly dryDaysBefore: number | null;
  readonly consecutiveHotDays: number;
}

export interface RiskComponent {
  readonly key: string;
  readonly label: string;
  /** 0 = no elevated risk indicated, 1 = strongly indicated. */
  readonly risk: number;
  readonly drivers: readonly string[];
  readonly provenance: Provenance;
}

export interface ExposureResult {
  /** 0–100, inverted so that a high score means low exposure risk. */
  readonly score: number;
  readonly components: readonly RiskComponent[];
  /** Multiplier reflecting how much human contact actually occurs here. */
  readonly exposurePotential: number;
  /** The single highest-risk component, for headline reporting. */
  readonly limitingComponent: RiskComponent | null;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * Faecal contamination risk after rainfall.
 *
 * The mechanism is first flush: a combined sewer carries foul and storm water in
 * one pipe, so a storm exceeding its capacity spills untreated sewage directly
 * to the stream. Risk concentrates in the first hours of a storm that follows a
 * dry spell, because the dry period accumulates the load that the first rain
 * then mobilises. That interaction — rain *after* drought — is the signal, and
 * it is why antecedent dry days are weighted rather than rainfall alone.
 *
 * Anchor: EU Bathing Water Directive inland limits (E. coli 500/1000, intestinal
 * enterococci 200/400 cfu/100 ml). Neer does not measure these and does not
 * claim a Directive class — the Directive defines a class over at least 16
 * samples across four bathing seasons, not over one observation.
 */
function pathogenRisk(i: ExposureInputs): RiskComponent {
  const drivers: string[] = [];
  let risk = 0;

  const rain48 = i.precip48hMm ?? 0;
  const dryBefore = i.dryDaysBefore ?? 0;

  if (i.combinedSewer && rain48 >= 10) {
    // Rises with rainfall up to ~40 mm, then saturates: beyond the point where
    // the sewer is already overflowing, more rain dilutes as much as it mobilises.
    const stormFactor = clamp01((rain48 - 10) / 30);
    // A first flush after a long dry spell is materially worse than the same
    // storm on already-wet ground.
    const firstFlush = clamp01(dryBefore / 10);
    risk += 0.45 * stormFactor * (0.6 + 0.4 * firstFlush);
    drivers.push(
      `${rain48.toFixed(0)} mm rain in 48 h on a combined-sewer catchment after ${dryBefore} dry day(s)`,
    );
  }

  if ((i.sewageOdourRate ?? 0) > 0) {
    risk += 0.3 * clamp01(i.sewageOdourRate ?? 0);
    drivers.push('sewage odour reported');
  }

  if ((i.visibleDischargeRate ?? 0) > 0) {
    risk += 0.25 * clamp01(i.visibleDischargeRate ?? 0);
    drivers.push('visible discharge observed');
  }

  // Turbidity is a weak standalone indicator but a well-established covariate of
  // faecal indicator organisms in urban runoff — included with low weight.
  if ((i.turbidityNtu ?? 0) > 25) {
    risk += 0.15 * clamp01(((i.turbidityNtu ?? 0) - 25) / 75);
    drivers.push(`turbidity ${(i.turbidityNtu ?? 0).toFixed(0)} NTU`);
  }

  if (i.outfallCount > 0) {
    risk += 0.1 * clamp01(i.outfallCount / 5);
    drivers.push(`${i.outfallCount} outfall pipe(s) discharging to the reach`);
  }

  return {
    key: 'pathogen',
    label: 'Faecal contamination risk',
    risk: clamp01(risk),
    drivers,
    provenance: modelled(
      'Field-observable proxy for faecal indicator organisms, which citizen kits cannot measure. Explained against Bathing Water Directive 2006/7/EC inland limits; no Directive class is asserted, since that requires ≥16 samples across four seasons.',
    ),
  };
}

/**
 * Cyanobacterial bloom risk.
 *
 * Follows the WHO 2021 Alert Level Framework, whose Alert Level 2 triggers are
 * deliberately the two things a volunteer *can* assess without equipment:
 * visible surface scum, or transparency below 0.5–1 m. That makes this the one
 * health hazard in the set where citizen observation maps directly onto an
 * international guideline rather than onto a proxy for one.
 *
 * WHO also warns that clear, low-biomass water can still carry toxic benthic
 * cyanobacterial mats on sediments and submerged plants — so the absence of a
 * visible bloom is not evidence of absent risk, and this component never scores
 * a clean zero on visual grounds alone.
 */
function cyanobacteriaRisk(i: ExposureInputs): RiskComponent {
  const drivers: string[] = [];
  let risk = 0;

  if (i.scumPresent) {
    // WHO Alert Level 2 — the highest tier in the framework, and directly
    // observable. Nothing else in this module produces a jump this large.
    risk += 0.6;
    drivers.push('visible surface scum — WHO Alert Level 2 trigger');
  }

  const algae = i.algaeCoverPct ?? 0;
  if (algae > 20) {
    risk += 0.25 * clamp01((algae - 20) / 60);
    drivers.push(`algal cover ${algae}%`);
  }

  // Bloom preconditions: warmth, phosphorus, and residence time.
  const temp = i.waterTempC ?? 0;
  if (temp >= 20) {
    risk += 0.15 * clamp01((temp - 20) / 8);
    drivers.push(`water temperature ${temp.toFixed(1)} °C`);
  }
  if (i.consecutiveHotDays >= 3) {
    risk += 0.15 * clamp01(i.consecutiveHotDays / 10);
    drivers.push(`${i.consecutiveHotDays} consecutive warm days`);
  }
  if ((i.phosphateMgl ?? 0) > 0.4) {
    risk += 0.2 * clamp01(((i.phosphateMgl ?? 0) - 0.4) / 1.6);
    drivers.push(`orthophosphate ${(i.phosphateMgl ?? 0).toFixed(2)} mg PO₄/L`);
  }
  if ((i.stagnantFraction ?? 0) > 0.3) {
    risk += 0.2 * clamp01(i.stagnantFraction ?? 0);
    drivers.push('low flow / stagnant conditions increasing residence time');
  }

  return {
    key: 'cyanobacteria',
    label: 'Cyanobacterial bloom risk',
    risk: clamp01(risk),
    drivers,
    provenance: {
      ...SOURCES.WHO_RECREATIONAL,
      kind: 'derived',
      note: 'Alert Level 2 visual triggers (scum, low transparency) are used directly as WHO defines them. The precondition weighting — temperature, phosphorus, residence time — is modelled, since WHO specifies alert levels rather than a predictive combination.',
    },
  };
}

/**
 * Mosquito vector risk, oriented to West Nile virus.
 *
 * Culex pipiens and Cx. modestus are the principal WNV vectors in Europe, and
 * Cx. pipiens breeds readily in exactly the conditions urban streams produce
 * under stress: stagnant, organically enriched water, and the artificial
 * containers that accumulate as litter.
 *
 * Thermal suitability uses the verified establishment envelope of 14–34.3 °C
 * with an optimum near 23.7 °C. Transmission has been demonstrated at 18 °C,
 * which is why temperate Northern European sites are not treated as immune.
 */
function vectorRisk(i: ExposureInputs): RiskComponent {
  const drivers: string[] = [];
  let risk = 0;

  const TMIN = 14;
  const TMAX = 34.3;
  const temp = i.waterTempC;

  if (temp !== null && temp > TMIN && temp < TMAX) {
    // Symmetric quadratic thermal performance curve, zero at both bounds and
    // peaking at the midpoint (24.15 °C, within half a degree of the published
    // 23.7 °C optimum).
    const peak = ((TMAX - TMIN) / 2) ** 2;
    const suitability = ((temp - TMIN) * (TMAX - temp)) / peak;
    risk += 0.4 * clamp01(suitability);
    drivers.push(`temperature ${temp.toFixed(1)} °C within the WNV transmission envelope`);
  }

  if ((i.stagnantFraction ?? 0) > 0.2) {
    risk += 0.35 * clamp01(i.stagnantFraction ?? 0);
    drivers.push('stagnant water providing breeding habitat');
  }

  // Litter is a genuine mechanism here, not an aesthetic complaint: discarded
  // containers, tyres and cans are among the most productive Cx. pipiens
  // breeding sites in urban environments.
  if ((i.litterScore ?? 0) >= 2) {
    risk += 0.2 * clamp01(((i.litterScore ?? 0) - 1) / 2);
    drivers.push('litter providing artificial container breeding habitat');
  }

  // Organic enrichment, indicated by oxygen depletion, favours Cx. pipiens larvae.
  if ((i.dissolvedOxygenMgl ?? 99) < 5) {
    risk += 0.15;
    drivers.push('organic enrichment indicated by low dissolved oxygen');
  }

  return {
    key: 'vector',
    label: 'Mosquito vector risk',
    risk: clamp01(risk),
    drivers,
    provenance: {
      ...SOURCES.ECDC_WNV,
      kind: 'derived',
      note: 'Thermal envelope 14–34.3 °C with optimum 23.7 °C is taken from published Culex thermal competence work. The habitat weighting is modelled. Neer does not survey mosquitoes; OneAquaHealth DipteraCAST addresses that directly.',
    },
  };
}

/**
 * Antimicrobial resistance pressure.
 *
 * ARGs require targeted qPCR or shotgun metagenomics — categorically outside
 * citizen capability, and outside Neer's. What is observable is the *pressure*:
 * proximity and connectivity to wastewater discharge, which is the dominant
 * route by which resistance genes enter urban surface water.
 *
 * This component exists because the recast Urban Wastewater Treatment Directive
 * now requires AMR monitoring in wastewater from agglomerations of 100,000
 * population equivalents and above. That makes discharge connectivity a
 * regulatory reporting concern, not merely an academic one, and a citizen
 * observation of outfall pipes is a legitimate input to it — the OneAquaHealth
 * field protocol already counts them.
 */
function amrPressure(i: ExposureInputs): RiskComponent {
  const drivers: string[] = [];
  let risk = 0;

  if (i.outfallCount > 0) {
    risk += 0.4 * clamp01(i.outfallCount / 4);
    drivers.push(`${i.outfallCount} wastewater/stormwater outfall(s) on the reach`);
  }
  if (i.combinedSewer) {
    risk += 0.25;
    drivers.push('combined sewer catchment with overflow potential');
  }
  if (i.imperviousPct > 50) {
    risk += 0.2 * clamp01((i.imperviousPct - 50) / 50);
    drivers.push(`${i.imperviousPct.toFixed(0)}% impervious catchment concentrating runoff`);
  }
  if ((i.sewageOdourRate ?? 0) > 0) {
    risk += 0.25 * clamp01(i.sewageOdourRate ?? 0);
    drivers.push('sewage odour indicating recent foul input');
  }

  return {
    key: 'amr',
    label: 'Antimicrobial resistance pressure',
    risk: clamp01(risk),
    drivers,
    provenance: {
      ...SOURCES.UWWTD_ART17,
      kind: 'derived',
      note: 'Wastewater-connectivity proxy for AMR pressure. ARGs cannot be measured by culture or citizen kit. OneAquaHealth found clinically relevant pathogens and high ARG loads in urban stream biofilms, and its field protocol records outfall counts, which is the observable used here.',
    },
  };
}

/**
 * How much human contact actually occurs, scaling hazard into exposure.
 *
 * A hazard nobody is exposed to is not a health risk, and conflating the two
 * would have the system shout equally loudly about a fenced culvert and a
 * paddling spot. Floored at 0.15 rather than 0, because "no recorded public
 * access" is a statement about records, not about dogs, children, or wildlife —
 * and because downstream users inherit what happens upstream.
 */
function computeExposurePotential(i: ExposureInputs): number {
  let potential = 0.15;

  if (i.recreationalAccess) potential += 0.45;

  // Contact-point proximity decays over the first kilometre.
  if (i.nearestContactM <= 1000) {
    potential += 0.25 * (1 - i.nearestContactM / 1000);
  }

  // Population density within 1 km, saturating at 10,000.
  potential += 0.15 * clamp01(i.populationWithin1km / 10000);

  return clamp01(potential);
}

/**
 * Compute the exposure sub-index.
 *
 * Components are combined with a *soft maximum* rather than a mean: the worst
 * hazard dominates, but the others still register. Averaging would let three
 * quiet hazards dilute one acute one — a stream with an active sewage spill
 * would score as mildly concerning because its bloom and vector risks happen to
 * be low, which inverts the priority any health officer would assign.
 */
export function computeExposure(inputs: ExposureInputs): ExposureResult {
  const components = [
    pathogenRisk(inputs),
    cyanobacteriaRisk(inputs),
    vectorRisk(inputs),
    amrPressure(inputs),
  ];

  const maxRisk = Math.max(...components.map((c) => c.risk));
  const meanRisk = components.reduce((s, c) => s + c.risk, 0) / components.length;
  // 75% worst-case, 25% overall burden.
  const combinedHazard = clamp01(0.75 * maxRisk + 0.25 * meanRisk);

  const exposurePotential = computeExposurePotential(inputs);
  const realisedRisk = combinedHazard * exposurePotential;

  const limitingComponent =
    components.reduce<RiskComponent | null>(
      (worst, c) => (worst === null || c.risk > worst.risk ? c : worst),
      null,
    ) ?? null;

  return {
    score: Math.max(0, Math.min(100, (1 - realisedRisk) * 100)),
    components,
    exposurePotential,
    limitingComponent: limitingComponent && limitingComponent.risk > 0 ? limitingComponent : null,
  };
}
