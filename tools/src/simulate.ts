import { randomUUID } from 'node:crypto';
import { TAXON_GROUPS } from '@neer/shared';
import { TAXON_BMWP_SCORES } from '@neer/scoring';
import type { EnvReadingRow } from './weather';
import type { SeedSite } from './sites';

/**
 * Citizen observation simulator.
 *
 * **These observations are synthetic. No real person recorded them and they
 * describe no real stream.** That is stated in the README, in the API response
 * envelope, and on the dashboard itself, because undisclosed fabricated data in
 * an environmental tool is indefensible regardless of intent.
 *
 * What the simulator is for: exercising the analytics honestly. A scoring model,
 * an anomaly detector and an insight engine cannot be demonstrated against an
 * empty database, and hand-written fixtures produce exactly the patterns the
 * author already expects to find — which proves nothing. This generator instead
 * produces data from a documented physical model driven by *real* weather, so
 * the pipeline has to find signal it was not handed directly.
 *
 * The generative model, in order of application:
 *
 *  1. **Oxygen saturation from temperature**, via the standard Benson–Krause
 *     polynomial. Warm water physically holds less oxygen, so summer dissolved
 *     oxygen falls without any pollution at all — the confounder a naive
 *     detector mistakes for degradation every August.
 *  2. **Organic loading** depresses saturation below the physical ceiling,
 *     scaled by the site's latent condition.
 *  3. **Storm response**, driven by the real precipitation series: turbidity
 *     spikes, nutrients arrive in a first flush scaled by antecedent dry days,
 *     and in combined-sewer catchments oxygen crashes.
 *  4. **Scripted events** — a sewage spill, an algal bloom, construction runoff,
 *     a slow seasonal decline — so the detectors have ground truth to be
 *     measured against.
 *  5. **Observer error**, widening with inexperience, plus realistic parameter
 *     drop-out: a novice with a turbidity tube and no oxygen meter is the
 *     common case.
 *  6. **Irregular sampling**, weekend-biased and clustered, because volunteers
 *     are people rather than a schedule.
 */

// ─── Deterministic PRNG ───────────────────────────────────────────────────────

/**
 * Seeded generator (mulberry32).
 *
 * Seeding matters more than it looks: without it every `pnpm seed` produces a
 * different dataset, so a score a reviewer questions cannot be reproduced, and a
 * regression in the scoring model is indistinguishable from new random data.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  constructor(private readonly next: () => number) {}
  static seeded(seed: number): Rng {
    return new Rng(mulberry32(seed));
  }
  float(min = 0, max = 1): number {
    return min + this.next() * (max - min);
  }
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }
  bool(probability: number): boolean {
    return this.next() < probability;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))]!;
  }
  /** Box–Muller normal deviate. */
  normal(mean = 0, sd = 1): number {
    const u1 = Math.max(this.next(), Number.EPSILON);
    const u2 = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

// ─── Physical relationships ───────────────────────────────────────────────────

/**
 * Dissolved oxygen at saturation, mg/L, for fresh water at 1 atm.
 *
 * Benson–Krause polynomial approximation. This is real physics and it is the
 * single most important confounder in the dataset: oxygen falls in summer
 * because water is warm, not because a stream is dying. A model that cannot
 * separate the two will raise an alarm on every heatwave.
 */
export function oxygenSaturationMgl(tempC: number): number {
  const t = Math.max(0, Math.min(40, tempC));
  return 14.652 - 0.41022 * t + 0.007991 * t ** 2 - 0.000077774 * t ** 3;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// ─── Observer behaviour ───────────────────────────────────────────────────────

type Experience = 'novice' | 'trained' | 'expert' | 'instrument';

interface ObserverProfile {
  readonly experience: Experience;
  /** Multiplicative measurement noise, as a coefficient of variation. */
  readonly noiseCv: number;
  /** Probability of recording each optional parameter at all. */
  readonly coverage: number;
  /** Probability of attempting an invertebrate survey. */
  readonly surveysBiology: number;
}

const OBSERVER_PROFILES: Record<Experience, ObserverProfile> = {
  novice: { experience: 'novice', noiseCv: 0.18, coverage: 0.45, surveysBiology: 0.05 },
  trained: { experience: 'trained', noiseCv: 0.09, coverage: 0.8, surveysBiology: 0.35 },
  expert: { experience: 'expert', noiseCv: 0.04, coverage: 0.95, surveysBiology: 0.7 },
  instrument: { experience: 'instrument', noiseCv: 0.02, coverage: 1, surveysBiology: 0 },
};

/** Volunteer mix: mostly novices, as every real programme reports. */
const EXPERIENCE_MIX: readonly Experience[] = [
  'novice',
  'novice',
  'novice',
  'novice',
  'trained',
  'trained',
  'trained',
  'expert',
];

export interface ObservationRow {
  observation_id: string;
  site_id: string;
  observed_at: string;
  observer_id: string;
  observer_experience: Experience;
  method: 'citizen_kit' | 'handheld_probe' | 'sensor' | 'lab';
  source: string;
  photo_count: number;
  water_temp_c: number | null;
  ph: number | null;
  dissolved_oxygen_mgl: number | null;
  conductivity_uscm: number | null;
  turbidity_ntu: number | null;
  nitrate_mgl: number | null;
  phosphate_mgl: number | null;
  ammonium_mgl: number | null;
  water_colour: 'clear' | 'slightly_turbid' | 'murky' | 'discoloured';
  odour: 'none' | 'earthy' | 'sewage' | 'chemical';
  foam_present: number;
  surface_film: number;
  litter_score: number;
  algae_cover_pct: number | null;
  flow_state: 'dry' | 'stagnant' | 'low' | 'normal' | 'high';
  riparian_score: number;
  visible_discharge: number;
  taxa_groups: string[];
  taxa_abundance: number[];
  notes: string;
}

interface DayContext {
  readonly day: string;
  readonly tempMeanC: number;
  readonly tempMaxC: number;
  readonly precipMm: number;
  readonly precip48hMm: number;
  readonly dryDaysBefore: number;
  readonly dischargeM3s: number | null;
}

/** Collapse hourly environmental readings into the daily context the model uses. */
export function buildDayContexts(readings: readonly EnvReadingRow[]): Map<string, DayContext[]> {
  const bySite = new Map<string, Map<string, EnvReadingRow[]>>();

  for (const reading of readings) {
    const day = reading.recorded_at.slice(0, 10);
    const siteDays = bySite.get(reading.site_id) ?? new Map<string, EnvReadingRow[]>();
    const dayRows = siteDays.get(day) ?? [];
    dayRows.push(reading);
    siteDays.set(day, dayRows);
    bySite.set(reading.site_id, siteDays);
  }

  const result = new Map<string, DayContext[]>();
  for (const [siteId, siteDays] of bySite) {
    const contexts: DayContext[] = [];
    for (const [day, rows] of [...siteDays.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const temps = rows.map((r) => r.air_temp_c).filter((v): v is number => v !== null);
      const precip = rows.map((r) => r.precipitation_mm ?? 0);
      const discharge = rows.map((r) => r.discharge_m3s).filter((v): v is number => v !== null);

      contexts.push({
        day,
        tempMeanC: temps.length ? temps.reduce((s, v) => s + v, 0) / temps.length : 15,
        tempMaxC: temps.length ? Math.max(...temps) : 18,
        precipMm: precip.reduce((s, v) => s + v, 0),
        precip48hMm: Math.max(...rows.map((r) => r.precip_48h_mm ?? 0)),
        dryDaysBefore: Math.max(...rows.map((r) => r.dry_days_before ?? 0)),
        dischargeM3s: discharge.length
          ? discharge.reduce((s, v) => s + v, 0) / discharge.length
          : null,
      });
    }
    result.set(siteId, contexts);
  }

  return result;
}

/** Intensity of a scripted event on a given day, 0 when inactive. */
function eventIntensity(site: SeedSite, day: string): number {
  const event = site.latent.event;
  if (!event || day < event.startDay || day > event.endDay) return 0;

  const start = Date.parse(event.startDay);
  const end = Date.parse(event.endDay);
  const now = Date.parse(day);
  const progress = (now - start) / Math.max(1, end - start);

  switch (event.kind) {
    case 'gradual_decline':
      // Ramps linearly and does not recover — the pattern a single-point
      // threshold alarm never fires on and a trend comparison always catches.
      return event.intensity * progress;
    case 'sewage_spill':
      // Sharp onset, exponential recovery.
      return event.intensity * Math.exp(-3 * progress);
    case 'algal_bloom':
    case 'construction_runoff':
      // Rise and fall — a smooth hump peaking mid-window.
      return event.intensity * Math.sin(Math.PI * clamp(progress, 0, 1));
  }
}

/** Generate the true (unobserved) water condition for a site on a day. */
function trueCondition(site: SeedSite, ctx: DayContext, rng: Rng) {
  const l = site.latent;
  const event = eventIntensity(site, ctx.day);
  const eventKind = l.event?.kind;

  // Water temperature tracks air temperature, damped and lagged. Streams have
  // thermal inertia; using air temperature directly would overstate the diel
  // and synoptic swing badly.
  const waterTempC = clamp(3.2 + 0.72 * ctx.tempMeanC + rng.normal(0, 0.6), 2, 32);

  // Storm response, scaled by the site's flashiness and by how long it had been
  // dry — the first flush after a drought carries far more load than the same
  // rainfall on saturated ground.
  const stormMagnitude =
    clamp(ctx.precip48hMm / 30, 0, 1.6) *
    l.stormSensitivity *
    (0.55 + 0.45 * clamp(ctx.dryDaysBefore / 10, 0, 1));

  // Oxygen: start at the physical ceiling, then subtract.
  const saturation = oxygenSaturationMgl(waterTempC);
  let doDeficitFraction = 1 - l.baseDoMgl / oxygenSaturationMgl(14);
  doDeficitFraction += 0.22 * stormMagnitude;
  if (eventKind === 'sewage_spill') doDeficitFraction += 0.42 * event;
  if (eventKind === 'gradual_decline') doDeficitFraction += 0.2 * event;
  if (eventKind === 'algal_bloom') {
    // Blooms supersaturate by day and crash the water at night. Daytime
    // volunteer sampling therefore sees *high* oxygen during a bloom — the
    // counter-intuitive signature that makes algal events easy to misread as
    // healthy.
    doDeficitFraction -= 0.18 * event;
  }
  const dissolvedOxygenMgl = clamp(
    saturation * clamp(1 - doDeficitFraction, 0.08, 1.25) + rng.normal(0, 0.25),
    0.2,
    18,
  );

  const turbidityNtu = clamp(
    l.baseTurbidityNtu * (1 + 3.4 * stormMagnitude) +
      (eventKind === 'construction_runoff' ? 95 * event : 0) +
      rng.normal(0, l.baseTurbidityNtu * 0.2),
    0.5,
    900,
  );

  const nutrientBoost =
    1 +
    1.6 * stormMagnitude +
    (eventKind === 'sewage_spill' ? 2.4 * event : 0) +
    (eventKind === 'gradual_decline' ? 1.1 * event : 0);

  const nitrateMgl = clamp(l.baseNitrateMgl * nutrientBoost + rng.normal(0, 1.2), 0.1, 180);
  const phosphateMgl = clamp(l.basePhosphateMgl * nutrientBoost + rng.normal(0, 0.03), 0.005, 40);
  const ammoniumMgl = clamp(
    l.baseAmmoniumMgl * (1 + (eventKind === 'sewage_spill' ? 5.5 * event : 0.6 * stormMagnitude)) +
      rng.normal(0, 0.04),
    0.005,
    60,
  );

  // Conductivity dilutes under high flow — the one parameter that improves
  // during a storm, which is exactly why it must not be scored on the same
  // "more rain is worse" assumption as the others.
  const conductivityUscm = clamp(
    l.baseConductivityUscm * (1 - 0.3 * clamp(stormMagnitude, 0, 0.8)) + rng.normal(0, 18),
    40,
    4000,
  );

  const ph = clamp(
    l.basePh + (eventKind === 'algal_bloom' ? 0.6 * event : 0) + rng.normal(0, 0.12),
    5,
    10,
  );

  const algaeCoverPct = clamp(
    Math.round(
      (eventKind === 'algal_bloom' ? 75 * event : 0) +
        (waterTempC > 20 ? (waterTempC - 20) * 1.8 : 0) +
        rng.normal(0, 4),
    ),
    0,
    100,
  );

  const flowState: ObservationRow['flow_state'] =
    ctx.precip48hMm > 25
      ? 'high'
      : ctx.dryDaysBefore > 20
        ? rng.bool(0.35)
          ? 'stagnant'
          : 'low'
        : ctx.dryDaysBefore > 10
          ? 'low'
          : 'normal';

  return {
    waterTempC,
    dissolvedOxygenMgl,
    ph,
    conductivityUscm,
    turbidityNtu,
    nitrateMgl,
    phosphateMgl,
    ammoniumMgl,
    algaeCoverPct,
    flowState,
    stormMagnitude,
    event,
    eventKind,
  };
}

/**
 * Sample an invertebrate assemblage consistent with the site's true ASPT.
 *
 * Presence probability for each group is a logistic function of the gap between
 * the site's true quality and the group's pollution tolerance, so sensitive taxa
 * thin out as conditions degrade while tolerant taxa persist everywhere — which
 * is the actual ecological pattern BMWP was built to capture, rather than a
 * uniform random draw that would produce nonsense assemblages.
 */
function sampleTaxa(trueAspt: number, rng: Rng): { groups: string[]; abundance: number[] } {
  const groups: string[] = [];
  const abundance: number[] = [];

  for (const group of TAXON_GROUPS) {
    const score = TAXON_BMWP_SCORES[group].score;
    const logit = (trueAspt - score * 0.7) / 0.8;
    const probability = 1 / (1 + Math.exp(-logit));
    if (!rng.bool(probability)) continue;

    // Tolerant taxa dominate numerically where conditions are poor.
    const tolerant = score <= 3;
    const band = tolerant
      ? rng.int(trueAspt < 4 ? 3 : 1, trueAspt < 4 ? 4 : 3)
      : rng.int(1, trueAspt > 6 ? 3 : 2);

    groups.push(group);
    abundance.push(band);
  }

  // A survey that finds nothing is a real outcome in a badly degraded reach, but
  // finding literally zero taxa is rare — chironomids persist almost anywhere.
  if (groups.length === 0) {
    groups.push('bloodworm_chironomid');
    abundance.push(rng.int(2, 4));
  }

  return { groups, abundance };
}

export interface SimulateOptions {
  readonly sites: readonly SeedSite[];
  readonly envReadings: readonly EnvReadingRow[];
  readonly seed: number;
}

export function simulateObservations(options: SimulateOptions): ObservationRow[] {
  const rng = Rng.seeded(options.seed);
  const contextsBySite = buildDayContexts(options.envReadings);
  const rows: ObservationRow[] = [];

  for (const site of options.sites) {
    const contexts = contextsBySite.get(site.siteId) ?? [];
    // A stable volunteer pool per site, so observer history is meaningful and
    // reliability weighting has something to weight.
    const observers = Array.from({ length: 6 }, (_, i) => ({
      id: `${site.siteId}-OBS-${String(i + 1).padStart(2, '0')}`,
      experience: rng.pick(EXPERIENCE_MIX),
    }));

    for (const ctx of contexts) {
      const date = new Date(`${ctx.day}T00:00:00Z`);
      const isWeekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;

      // Visit probability, weekend-weighted, and suppressed in heavy rain
      // because nobody wades a spate to read a turbidity tube.
      let visitProbability = (site.samplingIntensity / 4) * (isWeekend ? 1.6 : 0.7);
      if (ctx.precipMm > 12) visitProbability *= 0.35;
      // Interest spikes when something is visibly wrong — a real and useful
      // reporting bias that makes event windows better observed than quiet ones.
      if (eventIntensity(site, ctx.day) > 0.3) visitProbability *= 1.8;
      // Cap below certainty. Even a flagship site with a keen volunteer group
      // has days nobody goes, and a site sampled literally every day would make
      // the confidence model look like decoration rather than something the
      // data actually drives.
      visitProbability = Math.min(visitProbability, 0.8);

      const visits = rng.bool(visitProbability) ? (rng.bool(0.25) ? 2 : 1) : 0;
      if (visits === 0) continue;

      const truth = trueCondition(site, ctx, rng);

      for (let v = 0; v < visits; v++) {
        const observer = rng.pick(observers);
        const profile = OBSERVER_PROFILES[observer.experience];

        /** Apply observer error, then drop the reading if they did not take it. */
        const measure = (value: number, decimals = 2): number | null => {
          if (!rng.bool(profile.coverage)) return null;
          const observed = value * (1 + rng.normal(0, profile.noiseCv));
          return Number(Math.max(0, observed).toFixed(decimals));
        };

        /**
         * pH needs additive error, not multiplicative.
         *
         * pH is already a logarithm, and a colour-strip kit is good to roughly
         * half a unit wherever on the scale the reading falls. Applying the
         * proportional error used for concentrations made a novice's reading of
         * a neutral stream wander down to 5.8 — a biologically significant
         * acidification that existed only in the noise model, and one that then
         * failed the pH guideline and dragged down a pristine headwater's score.
         */
        const measurePh = (value: number): number | null => {
          if (!rng.bool(profile.coverage)) return null;
          const observed = value + rng.normal(0, profile.noiseCv * 2.5);
          return Number(Math.min(14, Math.max(0, observed)).toFixed(1));
        };

        const hour = rng.int(9, 17);
        const minute = rng.int(0, 59);

        const pressure = site.latent.pressureLevel + 0.25 * truth.event;
        const litterScore = clamp(Math.round(rng.float(0, 1) < pressure ? rng.int(1, 3) : 0), 0, 3);

        const surveysBiology = rng.bool(profile.surveysBiology);
        const taxa = surveysBiology
          ? sampleTaxa(site.latent.trueAspt, rng)
          : { groups: [], abundance: [] };

        const sewageSuspected =
          truth.eventKind === 'sewage_spill' && truth.event > 0.25
            ? rng.bool(0.75)
            : rng.bool(pressure * 0.25);

        rows.push({
          observation_id: randomUUID(),
          site_id: site.siteId,
          observed_at: `${ctx.day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000`,
          observer_id: observer.id,
          observer_experience: observer.experience,
          method: observer.experience === 'expert' ? 'handheld_probe' : 'citizen_kit',
          source: 'neer-simulator',
          photo_count: rng.int(0, 3),

          water_temp_c: measure(truth.waterTempC, 1),
          ph: measurePh(truth.ph),
          dissolved_oxygen_mgl: measure(truth.dissolvedOxygenMgl, 2),
          conductivity_uscm: measure(truth.conductivityUscm, 0),
          turbidity_ntu: measure(truth.turbidityNtu, 1),
          nitrate_mgl: measure(truth.nitrateMgl, 2),
          phosphate_mgl: measure(truth.phosphateMgl, 3),
          ammonium_mgl: measure(truth.ammoniumMgl, 3),

          water_colour:
            truth.turbidityNtu > 80
              ? 'discoloured'
              : truth.turbidityNtu > 35
                ? 'murky'
                : truth.turbidityNtu > 12
                  ? 'slightly_turbid'
                  : 'clear',
          odour: sewageSuspected ? 'sewage' : rng.bool(pressure * 0.2) ? 'earthy' : 'none',
          foam_present: rng.bool(pressure * 0.35 + 0.3 * truth.event) ? 1 : 0,
          surface_film: rng.bool(pressure * 0.2) ? 1 : 0,
          litter_score: litterScore,
          algae_cover_pct: rng.bool(profile.coverage) ? truth.algaeCoverPct : null,
          flow_state: truth.flowState,
          riparian_score:
            site.urbanClass === 'semi_natural'
              ? rng.int(2, 3)
              : site.urbanClass === 'peri_urban'
                ? rng.int(1, 2)
                : rng.int(0, 1),
          visible_discharge: rng.bool(pressure * 0.25 + 0.35 * truth.event) ? 1 : 0,

          taxa_groups: taxa.groups,
          taxa_abundance: taxa.abundance,
          notes: '',
        });
      }
    }
  }

  return rows.sort((a, b) => a.observed_at.localeCompare(b.observed_at));
}
