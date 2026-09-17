import {
  approximateQbrFromOrdinal,
  computeQbr,
  QBR_PROVENANCE,
  type QbrInputs,
  type QbrResult,
} from './qbr';
import { modelled, type Provenance } from './provenance';

/**
 * P — the anthropogenic pressure sub-index.
 *
 * Inverted throughout: a high score means *low* pressure, so all three
 * sub-indices point the same direction and can be composed without sign
 * bookkeeping.
 *
 * This sub-index leans hardest on what citizens observe best. Litter, foam,
 * surface films, discharges and riparian condition need no instrument, no
 * reagent and no calibration — they are the observations where volunteer data is
 * not a degraded substitute for professional monitoring but genuinely better
 * than it, because volunteers are present far more often than a sampling
 * programme is. A quarterly official survey cannot see a Tuesday foam event; a
 * resident walking a dog can.
 */

export interface PressureInputs {
  /** Mean litter score across the window, 0–3. */
  readonly litterScore: number | null;
  /** Share of observations reporting foam. */
  readonly foamRate: number | null;
  readonly surfaceFilmRate: number | null;
  readonly visibleDischargeRate: number | null;
  /** Full QBR field data where collected. */
  readonly qbr: QbrInputs | null;
  /** Coarse 0–3 riparian ordinal, used only when full QBR data is absent. */
  readonly riparianScore: number | null;
  /** Catchment imperviousness, percent. */
  readonly imperviousPct: number;
  readonly outfallCount: number;
  /** Invasive alien riparian plants — OneAquaHealth key indicator XI. */
  readonly invasivePlantsPresent: boolean | null;
}

export interface PressureComponent {
  readonly key: string;
  readonly label: string;
  /** 0–100, inverted so high is good. */
  readonly score: number;
  readonly weight: number;
  readonly value: number | null;
  readonly unit: string;
  readonly provenance: Provenance;
}

export interface PressureResult {
  readonly score: number;
  readonly components: readonly PressureComponent[];
  readonly qbrResult: QbrResult | null;
  /** True when riparian condition fell back to the coarse ordinal. */
  readonly riparianApproximated: boolean;
  readonly limitingComponent: PressureComponent | null;
}

const clamp100 = (v: number): number => Math.max(0, Math.min(100, v));

export function computePressure(i: PressureInputs): PressureResult {
  const components: PressureComponent[] = [];

  // ─── Riparian condition — the heaviest weight, on the evidence ─────────────
  // QBR is the strongest single predictor of invertebrate community quality in
  // the Iberian reference data, outweighing every chemical variable tested. It
  // is weighted accordingly rather than treated as one visual observation among
  // many.
  let qbrResult: QbrResult | null = null;
  let riparianApproximated = false;
  let riparianScore100: number;

  if (i.qbr) {
    qbrResult = computeQbr(i.qbr);
    riparianScore100 = qbrResult.total;
  } else if (i.riparianScore !== null) {
    riparianApproximated = true;
    riparianScore100 = approximateQbrFromOrdinal(i.riparianScore).total;
  } else {
    riparianApproximated = true;
    riparianScore100 = 50;
  }

  components.push({
    key: 'riparian',
    label: riparianApproximated ? 'Riparian condition (approximated)' : 'Riparian quality (QBR)',
    score: clamp100(riparianScore100),
    weight: 0.3,
    value: riparianScore100,
    unit: 'QBR',
    provenance: riparianApproximated
      ? approximateQbrFromOrdinal(i.riparianScore ?? 0).provenance
      : QBR_PROVENANCE,
  });

  // ─── Litter ────────────────────────────────────────────────────────────────
  if (i.litterScore !== null) {
    components.push({
      key: 'litter',
      label: 'Litter',
      score: clamp100(100 - (i.litterScore / 3) * 100),
      weight: 0.2,
      value: i.litterScore,
      unit: '0–3',
      provenance: modelled('Linear inversion of the 0–3 field litter ordinal.'),
    });
  }

  // ─── Acute pollution signals ───────────────────────────────────────────────
  // Foam, surface film and visible discharge are combined into one component
  // because they are alternative symptoms of the same underlying event, and
  // scoring them separately would triple-count a single incident.
  const acuteSignals = [i.foamRate, i.surfaceFilmRate, i.visibleDischargeRate].filter(
    (v): v is number => v !== null,
  );
  if (acuteSignals.length > 0) {
    const worst = Math.max(...acuteSignals);
    components.push({
      key: 'acute_pollution',
      label: 'Foam, films and discharges',
      score: clamp100(100 - worst * 100),
      weight: 0.25,
      value: worst,
      unit: 'share of visits',
      provenance: modelled(
        'Worst of foam, surface film and visible discharge rates. Combined rather than summed because they are alternative symptoms of one event.',
      ),
    });
  }

  // ─── Catchment imperviousness ──────────────────────────────────────────────
  components.push({
    key: 'imperviousness',
    label: 'Catchment sealing',
    score: clamp100(100 - i.imperviousPct),
    weight: 0.15,
    value: i.imperviousPct,
    unit: '%',
    provenance: modelled(
      'Linear inversion of impervious catchment share. Imperviousness drives flashy hydrology, thermal loading and first-flush pollutant transport.',
    ),
  });

  // ─── Outfall density ───────────────────────────────────────────────────────
  components.push({
    key: 'outfalls',
    label: 'Discharge points',
    score: clamp100(100 - Math.min(i.outfallCount, 5) * 20),
    weight: 0.1,
    value: i.outfallCount,
    unit: 'pipes',
    provenance: modelled(
      'Outfall count per reach, saturating at five. Recorded directly by the OneAquaHealth field protocol.',
    ),
  });

  // ─── Invasive alien riparian plants ────────────────────────────────────────
  if (i.invasivePlantsPresent !== null) {
    components.push({
      key: 'invasive_plants',
      label: 'Invasive alien plants',
      score: i.invasivePlantsPresent ? 40 : 100,
      weight: 0.1,
      value: i.invasivePlantsPresent ? 1 : 0,
      unit: 'present',
      provenance: modelled(
        'OneAquaHealth key indicator XI. Binary presence is what a volunteer can reliably report; cover-abundance would need botanical training.',
      ),
    });
  }

  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  const score =
    totalWeight > 0 ? components.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight : 50;

  const limitingComponent = components.reduce<PressureComponent | null>(
    (worst, c) => (worst === null || c.score < worst.score ? c : worst),
    null,
  );

  return {
    score: clamp100(score),
    components,
    qbrResult,
    riparianApproximated,
    limitingComponent,
  };
}
