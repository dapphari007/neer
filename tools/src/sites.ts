/**
 * Monitoring sites — Coimbra, Portugal.
 *
 * Coimbra is a real OneAquaHealth pilot city and the project's coordinating
 * institution (Universidade de Coimbra). The project's own design is twenty
 * urban stream sites per city spanning an urbanisation gradient, and these
 * twelve follow that pattern: three near-natural headwaters, five peri-urban
 * reaches, four urban-core sites including two culverted ones.
 *
 * **Provenance, stated plainly.** The watercourses are real — Mondego, Ceira,
 * Coselhas, Covões, Eiras. The coordinates are approximate representative points
 * on those watercourses, not surveyed station locations. The `latent` block is
 * entirely invented: it is the simulator's ground truth, the underlying
 * condition that synthetic observations are generated around, and it does not
 * describe the real condition of any real stream. Nothing here should be read as
 * a statement about water quality in Coimbra.
 *
 * Ribeira dos Covões is included deliberately: it is a genuinely well-studied
 * peri-urban catchment near Coimbra, which makes it the most plausible site in
 * the set for a future real-data comparison.
 */

export interface LatentCondition {
  /** Baseline dissolved oxygen, mg/L, before seasonal and event effects. */
  readonly baseDoMgl: number;
  /** Baseline nitrate, mg NO₃/L. */
  readonly baseNitrateMgl: number;
  /** Baseline orthophosphate, mg PO₄/L. */
  readonly basePhosphateMgl: number;
  readonly baseAmmoniumMgl: number;
  readonly baseConductivityUscm: number;
  readonly baseTurbidityNtu: number;
  readonly basePh: number;
  /** 0–1. Probability weight for litter, foam, odour and discharge observations. */
  readonly pressureLevel: number;
  /** Expected ASPT of the invertebrate community, before noise. */
  readonly trueAspt: number;
  /**
   * Sensitivity to storm events, 0–1. High values mean the reach responds
   * sharply to rainfall — flashy urban hydrology, first-flush loading, and in
   * combined-sewer catchments, spill risk.
   */
  readonly stormSensitivity: number;
  /**
   * A scripted degradation event, so the dashboard has something real to detect.
   * Without at least one, an anomaly detector has nothing to find and a trend
   * view has nothing to show.
   */
  readonly event?: {
    readonly kind: 'sewage_spill' | 'algal_bloom' | 'gradual_decline' | 'construction_runoff';
    readonly startDay: string;
    readonly endDay: string;
    readonly intensity: number;
  };
}

export interface SeedSite {
  readonly siteId: string;
  readonly name: string;
  readonly catchment: string;
  readonly waterBodyCode: string;
  readonly city: string;
  readonly country: string;
  readonly lat: number;
  readonly lon: number;
  readonly elevationM: number;
  readonly streamOrder: number;
  readonly upstreamAreaKm2: number;
  readonly urbanClass: 'urban_core' | 'peri_urban' | 'semi_natural';
  readonly imperviousPct: number;
  readonly combinedSewer: boolean;
  readonly recreationalAccess: boolean;
  readonly nearestContactM: number;
  readonly populationWithin1km: number;
  readonly outfallCount: number;
  readonly referenceDoMgl: number;
  readonly referenceCondUscm: number;
  readonly referenceAspt: number;
  /** Expected visits per 14 days — drives how sparse this site's data is. */
  readonly samplingIntensity: number;
  readonly latent: LatentCondition;
}

export const SEED_SITES: readonly SeedSite[] = [
  // ─── Semi-natural headwaters ───────────────────────────────────────────────
  {
    siteId: 'CBR-CEI-01',
    name: 'Rio Ceira — Serra headwater',
    catchment: 'Ceira',
    waterBodyCode: 'PT04MON0123',
    city: 'Coimbra',
    country: 'PT',
    lat: 40.1512,
    lon: -8.2894,
    elevationM: 180,
    streamOrder: 2,
    upstreamAreaKm2: 14.2,
    urbanClass: 'semi_natural',
    imperviousPct: 4,
    combinedSewer: false,
    recreationalAccess: true,
    nearestContactM: 0,
    populationWithin1km: 320,
    outfallCount: 0,
    referenceDoMgl: 10.2,
    referenceCondUscm: 120,
    referenceAspt: 6.8,
    samplingIntensity: 2.5,
    latent: {
      baseDoMgl: 9.8,
      baseNitrateMgl: 2.1,
      basePhosphateMgl: 0.04,
      baseAmmoniumMgl: 0.05,
      baseConductivityUscm: 135,
      baseTurbidityNtu: 3,
      basePh: 7.3,
      pressureLevel: 0.08,
      trueAspt: 6.9,
      stormSensitivity: 0.25,
    },
  },
  {
    siteId: 'CBR-CEI-02',
    name: 'Rio Ceira — Vale de Açor',
    catchment: 'Ceira',
    waterBodyCode: 'PT04MON0123',
    city: 'Coimbra',
    country: 'PT',
    lat: 40.1698,
    lon: -8.3301,
    elevationM: 112,
    streamOrder: 3,
    upstreamAreaKm2: 48.6,
    urbanClass: 'semi_natural',
    imperviousPct: 9,
    combinedSewer: false,
    recreationalAccess: true,
    nearestContactM: 0,
    populationWithin1km: 900,
    outfallCount: 1,
    referenceDoMgl: 10.0,
    referenceCondUscm: 140,
    referenceAspt: 6.6,
    samplingIntensity: 2.0,
    latent: {
      baseDoMgl: 9.4,
      baseNitrateMgl: 4.2,
      basePhosphateMgl: 0.07,
      baseAmmoniumMgl: 0.09,
      baseConductivityUscm: 168,
      baseTurbidityNtu: 5,
      basePh: 7.4,
      pressureLevel: 0.14,
      trueAspt: 6.4,
      stormSensitivity: 0.3,
    },
  },
  {
    siteId: 'CBR-EIR-01',
    name: 'Ribeira de Eiras — upper reach',
    catchment: 'Eiras',
    waterBodyCode: 'PT04MON0141',
    city: 'Coimbra',
    country: 'PT',
    lat: 40.2451,
    lon: -8.4022,
    elevationM: 96,
    streamOrder: 2,
    upstreamAreaKm2: 9.1,
    urbanClass: 'semi_natural',
    imperviousPct: 12,
    combinedSewer: false,
    recreationalAccess: false,
    nearestContactM: 1800,
    populationWithin1km: 1400,
    outfallCount: 0,
    referenceDoMgl: 9.8,
    referenceCondUscm: 160,
    referenceAspt: 6.4,
    samplingIntensity: 1.5,
    latent: {
      baseDoMgl: 9.1,
      baseNitrateMgl: 6.8,
      basePhosphateMgl: 0.11,
      baseAmmoniumMgl: 0.12,
      baseConductivityUscm: 205,
      baseTurbidityNtu: 7,
      basePh: 7.5,
      pressureLevel: 0.2,
      trueAspt: 6.1,
      stormSensitivity: 0.4,
    },
  },

  // ─── Peri-urban ────────────────────────────────────────────────────────────
  {
    siteId: 'CBR-COV-01',
    name: 'Ribeira dos Covões — upper catchment',
    catchment: 'Covões',
    waterBodyCode: 'PT04MON0152',
    city: 'Coimbra',
    country: 'PT',
    lat: 40.2224,
    lon: -8.4742,
    elevationM: 84,
    streamOrder: 2,
    upstreamAreaKm2: 2.8,
    urbanClass: 'peri_urban',
    imperviousPct: 28,
    combinedSewer: false,
    recreationalAccess: false,
    nearestContactM: 1200,
    populationWithin1km: 3100,
    outfallCount: 2,
    referenceDoMgl: 9.6,
    referenceCondUscm: 180,
    referenceAspt: 6.2,
    samplingIntensity: 3.0,
    latent: {
      baseDoMgl: 8.4,
      baseNitrateMgl: 11.4,
      basePhosphateMgl: 0.21,
      baseAmmoniumMgl: 0.22,
      baseConductivityUscm: 288,
      baseTurbidityNtu: 12,
      basePh: 7.6,
      pressureLevel: 0.34,
      trueAspt: 5.4,
      stormSensitivity: 0.6,
    },
  },
  {
    siteId: 'CBR-COV-02',
    name: 'Ribeira dos Covões — Espírito Santo confluence',
    catchment: 'Covões',
    waterBodyCode: 'PT04MON0152',
    city: 'Coimbra',
    country: 'PT',
    lat: 40.2168,
    lon: -8.4611,
    elevationM: 61,
    streamOrder: 3,
    upstreamAreaKm2: 6.2,
    urbanClass: 'peri_urban',
    imperviousPct: 41,
    combinedSewer: true,
    recreationalAccess: false,
    nearestContactM: 700,
    populationWithin1km: 5600,
    outfallCount: 3,
    referenceDoMgl: 9.4,
    referenceCondUscm: 200,
    referenceAspt: 6.0,
    samplingIntensity: 3.5,
    latent: {
      baseDoMgl: 7.6,
      baseNitrateMgl: 16.2,
      basePhosphateMgl: 0.34,
      baseAmmoniumMgl: 0.38,
      baseConductivityUscm: 372,
      baseTurbidityNtu: 18,
      basePh: 7.7,
      pressureLevel: 0.46,
      trueAspt: 4.8,
      stormSensitivity: 0.78,
      // The set-piece for the demo: a first-flush spill after a long dry spell.
      event: {
        kind: 'sewage_spill',
        startDay: '2026-07-18',
        endDay: '2026-07-27',
        intensity: 0.85,
      },
    },
  },
  {
    siteId: 'CBR-COS-01',
    name: 'Ribeira de Coselhas — Loreto',
    catchment: 'Coselhas',
    waterBodyCode: 'PT04MON0138',
    city: 'Coimbra',
    country: 'PT',
    lat: 40.2304,
    lon: -8.4247,
    elevationM: 52,
    streamOrder: 2,
    upstreamAreaKm2: 4.4,
    urbanClass: 'peri_urban',
    imperviousPct: 44,
    combinedSewer: true,
    recreationalAccess: false,
    nearestContactM: 950,
    populationWithin1km: 7200,
    outfallCount: 2,
    referenceDoMgl: 9.4,
    referenceCondUscm: 200,
    referenceAspt: 6.0,
    samplingIntensity: 2.0,
    latent: {
      baseDoMgl: 7.9,
      baseNitrateMgl: 14.1,
      basePhosphateMgl: 0.29,
      baseAmmoniumMgl: 0.31,
      baseConductivityUscm: 348,
      baseTurbidityNtu: 15,
      basePh: 7.7,
      pressureLevel: 0.42,
      trueAspt: 5.0,
      stormSensitivity: 0.7,
    },
  },
  {
    siteId: 'CBR-ANC-01',
    name: 'Vala de Ançã — agricultural reach',
    catchment: 'Ançã',
    waterBodyCode: 'PT04MON0119',
    city: 'Coimbra',
    country: 'PT',
    lat: 40.2712,
    lon: -8.4934,
    elevationM: 38,
    streamOrder: 3,
    upstreamAreaKm2: 22.5,
    urbanClass: 'peri_urban',
    imperviousPct: 22,
    combinedSewer: false,
    recreationalAccess: false,
    nearestContactM: 2400,
    populationWithin1km: 1900,
    outfallCount: 1,
    referenceDoMgl: 9.2,
    referenceCondUscm: 260,
    referenceAspt: 5.8,
    samplingIntensity: 1.5,
    latent: {
      baseDoMgl: 7.4,
      baseNitrateMgl: 28.6,
      basePhosphateMgl: 0.46,
      baseAmmoniumMgl: 0.28,
      baseConductivityUscm: 452,
      baseTurbidityNtu: 22,
      basePh: 7.9,
      pressureLevel: 0.38,
      trueAspt: 4.6,
      stormSensitivity: 0.55,
      // Slow nutrient enrichment — invisible day to day, obvious over a season.
      event: {
        kind: 'gradual_decline',
        startDay: '2026-05-01',
        endDay: '2026-09-15',
        intensity: 0.6,
      },
    },
  },
  {
    siteId: 'CBR-MON-01',
    name: 'Rio Mondego — Portela upstream',
    catchment: 'Mondego',
    waterBodyCode: 'PT04MON0101',
    city: 'Coimbra',
    country: 'PT',
    lat: 40.2178,
    lon: -8.3812,
    elevationM: 28,
    streamOrder: 5,
    upstreamAreaKm2: 3120,
    urbanClass: 'peri_urban',
    imperviousPct: 26,
    combinedSewer: false,
    recreationalAccess: true,
    nearestContactM: 0,
    populationWithin1km: 4800,
    outfallCount: 1,
    referenceDoMgl: 9.0,
    referenceCondUscm: 220,
    referenceAspt: 5.6,
    samplingIntensity: 3.0,
    latent: {
      baseDoMgl: 8.6,
      baseNitrateMgl: 9.8,
      basePhosphateMgl: 0.18,
      baseAmmoniumMgl: 0.15,
      baseConductivityUscm: 246,
      baseTurbidityNtu: 14,
      basePh: 7.8,
      pressureLevel: 0.28,
      trueAspt: 5.5,
      stormSensitivity: 0.35,
    },
  },

  // ─── Urban core ────────────────────────────────────────────────────────────
  {
    siteId: 'CBR-MON-02',
    name: 'Rio Mondego — Ponte de Santa Clara',
    catchment: 'Mondego',
    waterBodyCode: 'PT04MON0101',
    city: 'Coimbra',
    country: 'PT',
    lat: 40.2075,
    lon: -8.4295,
    elevationM: 19,
    streamOrder: 5,
    upstreamAreaKm2: 3180,
    urbanClass: 'urban_core',
    imperviousPct: 68,
    combinedSewer: true,
    recreationalAccess: true,
    nearestContactM: 0,
    populationWithin1km: 18400,
    outfallCount: 3,
    referenceDoMgl: 9.0,
    referenceCondUscm: 220,
    referenceAspt: 5.4,
    samplingIntensity: 4.5,
    latent: {
      baseDoMgl: 8.1,
      baseNitrateMgl: 12.6,
      basePhosphateMgl: 0.26,
      baseAmmoniumMgl: 0.24,
      baseConductivityUscm: 302,
      baseTurbidityNtu: 19,
      basePh: 7.9,
      pressureLevel: 0.44,
      trueAspt: 5.0,
      stormSensitivity: 0.5,
    },
  },
  {
    siteId: 'CBR-COS-02',
    name: 'Ribeira de Coselhas — culverted reach',
    catchment: 'Coselhas',
    waterBodyCode: 'PT04MON0138',
    city: 'Coimbra',
    country: 'PT',
    lat: 40.2201,
    lon: -8.4198,
    elevationM: 31,
    streamOrder: 3,
    upstreamAreaKm2: 7.8,
    urbanClass: 'urban_core',
    imperviousPct: 79,
    combinedSewer: true,
    recreationalAccess: false,
    nearestContactM: 420,
    populationWithin1km: 15200,
    outfallCount: 5,
    referenceDoMgl: 9.0,
    referenceCondUscm: 240,
    referenceAspt: 5.2,
    samplingIntensity: 1.2,
    latent: {
      baseDoMgl: 5.4,
      baseNitrateMgl: 24.8,
      basePhosphateMgl: 0.82,
      baseAmmoniumMgl: 0.96,
      baseConductivityUscm: 618,
      baseTurbidityNtu: 38,
      basePh: 7.6,
      pressureLevel: 0.78,
      trueAspt: 3.2,
      stormSensitivity: 0.9,
    },
  },
  {
    siteId: 'CBR-URB-01',
    name: 'Vala de Arzila — Pedrulha industrial',
    catchment: 'Mondego',
    waterBodyCode: 'PT04MON0107',
    city: 'Coimbra',
    country: 'PT',
    lat: 40.2389,
    lon: -8.4401,
    elevationM: 24,
    streamOrder: 2,
    upstreamAreaKm2: 3.1,
    urbanClass: 'urban_core',
    imperviousPct: 84,
    combinedSewer: true,
    recreationalAccess: false,
    nearestContactM: 300,
    populationWithin1km: 9800,
    outfallCount: 6,
    referenceDoMgl: 9.0,
    referenceCondUscm: 250,
    referenceAspt: 5.0,
    samplingIntensity: 1.0,
    latent: {
      baseDoMgl: 4.6,
      baseNitrateMgl: 31.2,
      basePhosphateMgl: 1.14,
      baseAmmoniumMgl: 1.42,
      baseConductivityUscm: 742,
      baseTurbidityNtu: 46,
      basePh: 7.5,
      pressureLevel: 0.86,
      trueAspt: 2.8,
      stormSensitivity: 0.92,
      event: {
        kind: 'construction_runoff',
        startDay: '2026-06-05',
        endDay: '2026-06-24',
        intensity: 0.7,
      },
    },
  },
  {
    siteId: 'CBR-MON-03',
    name: 'Rio Mondego — Parque Verde',
    catchment: 'Mondego',
    waterBodyCode: 'PT04MON0101',
    city: 'Coimbra',
    country: 'PT',
    lat: 40.2016,
    lon: -8.4338,
    elevationM: 17,
    streamOrder: 5,
    upstreamAreaKm2: 3195,
    urbanClass: 'urban_core',
    imperviousPct: 61,
    combinedSewer: true,
    recreationalAccess: true,
    nearestContactM: 0,
    populationWithin1km: 16900,
    outfallCount: 2,
    referenceDoMgl: 9.0,
    referenceCondUscm: 220,
    referenceAspt: 5.4,
    samplingIntensity: 5.0,
    latent: {
      baseDoMgl: 8.0,
      baseNitrateMgl: 13.4,
      basePhosphateMgl: 0.31,
      baseAmmoniumMgl: 0.27,
      baseConductivityUscm: 318,
      baseTurbidityNtu: 21,
      basePh: 8.0,
      pressureLevel: 0.48,
      trueAspt: 4.9,
      stormSensitivity: 0.52,
      // Warm, slow, nutrient-rich, and the most-used public frontage in the
      // city — the combination that makes a bloom a health question rather
      // than an ecological one.
      event: {
        kind: 'algal_bloom',
        startDay: '2026-08-06',
        endDay: '2026-08-28',
        intensity: 0.95,
      },
    },
  },
];
