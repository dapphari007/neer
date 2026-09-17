import type { Rule } from './engine';
import { metric } from './engine';

/**
 * The rule catalogue.
 *
 * Each rule states a mechanism, not just a correlation. "Dissolved oxygen is
 * low" is a reading; "dissolved oxygen collapsed 48 hours after 38 mm of rain
 * fell on a combined-sewer catchment following eleven dry days, which is the
 * signature of a first-flush spill" is a hypothesis someone can go and check.
 * The second is the only kind that changes what anybody does.
 */

const BWD = 'EU Bathing Water Directive 2006/7/EC, Annex I (CELEX:32006L0007)';
const WHO_REC = 'WHO (2021), Guidelines on Recreational Water Quality, Vol. 1';
const ECDC_WNV = 'ECDC West Nile virus factsheet; Culex thermal competence 14–34.3 °C';
const UWWTD = 'Recast Urban Wastewater Treatment Directive, Article 17 (AMR surveillance)';
const OAH = 'OneAquaHealth Key Indicators factsheets (DOI 10.5281/zenodo.20345207)';
const UKTAG = 'UKTAG (2009), Recommendations on Surface Water Status Classification';

export const RULES: readonly Rule[] = [
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'cso-first-flush',
    version: '1.0.0',
    domain: 'human_health',
    title: 'Combined sewer overflow — first flush',
    rationale:
      'Detects the specific weather-and-catchment combination that precedes untreated sewage reaching a watercourse.',
    citations: [BWD, OAH],
    evaluate(ctx) {
      if (!ctx.site.combinedSewer) return null;

      const rain48 = ctx.env.precip48hMm ?? 0;
      const dryBefore = ctx.env.dryDaysBefore ?? 0;
      if (rain48 < 15) return null;

      const odour = metric(ctx.current, 'sewageOdourRate') ?? 0;
      const discharge = metric(ctx.current, 'visibleDischargeRate') ?? 0;
      const doMgl = metric(ctx.current, 'dissolvedOxygenMgl');
      const ammonium = metric(ctx.current, 'ammoniumMgl');

      // Corroboration count: rainfall alone is a forecast, not a finding.
      // Requiring at least one observed symptom keeps this from firing on every
      // summer storm and training people to ignore it.
      const corroborating = [
        odour > 0,
        discharge > 0,
        doMgl !== null && doMgl < 5,
        ammonium !== null && ammonium > 0.5,
      ].filter(Boolean).length;
      if (corroborating === 0) return null;

      const severity = corroborating >= 3 ? 'high' : corroborating === 2 ? 'elevated' : 'watch';
      const firstFlush = dryBefore >= 7;

      const evidence = [
        `${rain48.toFixed(0)} mm of rain in the preceding 48 hours`,
        `${dryBefore} dry day(s) immediately before the storm`,
        'catchment is served by a combined sewer',
      ];
      if (odour > 0)
        evidence.push(`sewage odour reported in ${(odour * 100).toFixed(0)}% of visits`);
      if (discharge > 0)
        evidence.push(`visible discharge reported in ${(discharge * 100).toFixed(0)}% of visits`);
      if (doMgl !== null && doMgl < 5) evidence.push(`dissolved oxygen ${doMgl.toFixed(1)} mg/L`);
      if (ammonium !== null && ammonium > 0.5)
        evidence.push(`ammonium ${ammonium.toFixed(2)} mg NH₄/L`);

      return {
        severity,
        confidence: corroborating >= 2 ? 'high' : 'medium',
        headline: `Conditions consistent with a combined sewer overflow at ${ctx.site.name}`,
        mechanism: firstFlush
          ? `Heavy rain after a dry spell exceeded combined sewer capacity. The dry period accumulated the pollutant load that the first flush then mobilised, so contamination is concentrated in the early hours of this storm.`
          : `Rainfall exceeded combined sewer capacity, allowing untreated wastewater to reach the watercourse alongside stormwater.`,
        evidence,
        metrics: {
          precip48hMm: rain48,
          dryDaysBefore: dryBefore,
          sewageOdourRate: odour,
          visibleDischargeRate: discharge,
          dissolvedOxygenMgl: doMgl,
          ammoniumMgl: ammonium,
          corroboratingSignals: corroborating,
        },
        actions: {
          citizen: ctx.site.recreationalAccess
            ? 'Avoid contact with the water, and keep children and dogs out of it, for at least 48 hours after heavy rain. Wash hands after any accidental contact.'
            : 'Avoid contact with the water for at least 48 hours after heavy rain. Report any strong sewage smell or visible discharge with a photograph.',
          municipal: `Inspect sewer overflow structures and outfalls in the ${ctx.site.catchment} catchment within 48 hours. Check for blockages, misconnections and consent breaches, and confirm whether a spill was logged.`,
          health: `Treat as elevated faecal exposure risk${ctx.site.recreationalAccess ? ' at an access point with recorded public contact' : ''}. Bathing Water Directive inland limits are 500 cfu/100 ml E. coli and 200 cfu/100 ml intestinal enterococci at the 95th percentile — Neer cannot measure these, so confirmatory sampling is required before any classification.`,
        },
        validForHours: 72,
      };
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'hypoxia',
    version: '1.0.0',
    domain: 'ecological',
    title: 'Oxygen depletion',
    rationale:
      'Distinguishes oxygen loss caused by pollution from the seasonal loss caused by warm water, which is physical and not a sign of degradation.',
    citations: [UKTAG],
    evaluate(ctx) {
      const doMgl = metric(ctx.current, 'dissolvedOxygenMgl');
      if (doMgl === null || doMgl >= 6) return null;

      const tempC = metric(ctx.current, 'waterTempC');
      // Benson–Krause saturation, so the finding can say how much of the deficit
      // is physics and how much is loading.
      const saturationMgl =
        tempC !== null
          ? 14.652 - 0.41022 * tempC + 0.007991 * tempC ** 2 - 0.000077774 * tempC ** 3
          : null;
      const saturationPct = saturationMgl ? (doMgl / saturationMgl) * 100 : null;

      // A stream at 28 °C physically cannot hold 9 mg/L. Reporting an absolute
      // threshold breach without this context produces a summer alarm at every
      // site every year, and an alarm that always fires is one nobody reads.
      if (saturationPct !== null && saturationPct > 75) return null;

      const severity = doMgl < 3 ? 'high' : doMgl < 4.5 ? 'elevated' : 'watch';
      const evidence = [`dissolved oxygen ${doMgl.toFixed(1)} mg/L`];
      if (saturationPct !== null) {
        evidence.push(`${saturationPct.toFixed(0)}% of saturation at ${tempC!.toFixed(1)} °C`);
      }
      const ammonium = metric(ctx.current, 'ammoniumMgl');
      if (ammonium !== null && ammonium > 0.4) {
        evidence.push(`ammonium ${ammonium.toFixed(2)} mg NH₄/L indicating organic loading`);
      }

      return {
        severity,
        confidence: saturationPct !== null ? 'high' : 'medium',
        headline: `Oxygen depletion at ${ctx.site.name} beyond what temperature explains`,
        mechanism:
          'Oxygen is being consumed faster than it is replenished. Organic loading drives microbial respiration that strips oxygen from the water column; below roughly 4 mg/L, sensitive invertebrates and fish cannot persist.',
        evidence,
        metrics: {
          dissolvedOxygenMgl: doMgl,
          waterTempC: tempC,
          saturationPct: saturationPct,
          ammoniumMgl: ammonium,
        },
        actions: {
          citizen:
            'Photograph and report any dead or distressed fish, sewage smell, or greyish water. These observations time-stamp an event that intermittent official sampling will otherwise miss.',
          municipal: `Trace organic inputs upstream in the ${ctx.site.catchment} catchment: sewer misconnections, farm or industrial discharges, and blocked outfalls. Prioritise if the depletion persists across consecutive visits.`,
          health:
            'Low oxygen is not itself a direct human health hazard, but it reliably co-occurs with organic and faecal contamination. Treat as an indicator that warrants microbiological sampling rather than as an exposure risk on its own.',
        },
      };
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'cyanobacteria-alert-2',
    version: '1.0.0',
    domain: 'human_health',
    title: 'Cyanobacterial bloom — WHO Alert Level 2',
    rationale:
      'Visible scum is the one health hazard in this set that maps directly onto an international guideline a volunteer can assess without equipment.',
    citations: [WHO_REC, OAH],
    evaluate(ctx) {
      const algae = metric(ctx.current, 'algaeCoverPct') ?? 0;
      const tempC = metric(ctx.current, 'waterTempC') ?? 0;
      const phosphate = metric(ctx.current, 'phosphateMgl') ?? 0;
      const scum = algae >= 60;

      if (!scum && !(algae >= 30 && tempC >= 20 && phosphate > 0.4)) return null;

      const evidence = [`algal cover ${algae.toFixed(0)}%`];
      // Name the guideline in the evidence, not only in the headline. The
      // headline is a claim; the evidence is what makes it auditable, and a
      // reader checking why this fired should find the trigger here.
      if (scum) {
        evidence.push('visible surface accumulation — WHO Alert Level 2 trigger');
      }
      if (tempC > 0) evidence.push(`water temperature ${tempC.toFixed(1)} °C`);
      if (phosphate > 0) evidence.push(`orthophosphate ${phosphate.toFixed(2)} mg PO₄/L`);
      if (ctx.env.consecutiveHotDays >= 3) {
        evidence.push(`${ctx.env.consecutiveHotDays} consecutive warm days`);
      }

      return {
        severity: scum ? (ctx.site.recreationalAccess ? 'high' : 'elevated') : 'watch',
        confidence: scum ? 'high' : 'medium',
        headline: scum
          ? `Probable cyanobacterial bloom at ${ctx.site.name} — WHO Alert Level 2 conditions`
          : `Bloom-forming conditions developing at ${ctx.site.name}`,
        mechanism:
          'Warmth, phosphorus enrichment and long residence time let cyanobacteria outcompete other algae and accumulate at the surface. Some species produce microcystins and other toxins that are hazardous on ingestion or skin contact, and dogs are at markedly higher risk because they drink from and swim in affected water.',
        evidence,
        metrics: {
          algaeCoverPct: algae,
          waterTempC: tempC,
          phosphateMgl: phosphate,
          consecutiveHotDays: ctx.env.consecutiveHotDays,
        },
        actions: {
          citizen:
            'Do not enter the water and do not let dogs drink from or swim in it — dogs are far more likely than people to ingest a lethal dose. Report scum with a photograph and note where it has accumulated.',
          municipal:
            'Post advisory signage at access points and sample for cyanobacteria and chlorophyll-a. WHO recreational guideline values are 24 µg/L microcystin and 6 µg/L cylindrospermopsin. Review upstream nutrient sources.',
          health:
            'Assess exposure risk for recreational users and pets. Note that clear water does not mean safe water: WHO warns that toxic benthic cyanobacterial mats persist on sediments and submerged plants without any visible surface bloom.',
        },
        validForHours: 7 * 24,
      };
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'biotic-community-collapse',
    version: '1.0.0',
    domain: 'ecological',
    title: 'Invertebrate community dominated by pollution-tolerant taxa',
    rationale:
      'The invertebrate community integrates months of conditions, so it detects chronic degradation that spot chemistry samples miss entirely.',
    citations: [UKTAG, OAH],
    evaluate(ctx) {
      const aspt = metric(ctx.current, 'aspt');
      if (aspt === null || aspt >= 4.5) return null;

      const tolerantDominance = metric(ctx.current, 'tolerantDominance');
      const evidence = [
        `ASPT ${aspt.toFixed(2)}, against a site reference of ${ctx.site.referenceDoMgl > 0 ? '6.0' : '6.0'}`,
      ];
      if (tolerantDominance !== null) {
        evidence.push(
          `pollution-tolerant taxa make up ${(tolerantDominance * 100).toFixed(0)}% of recorded abundance`,
        );
      }

      return {
        severity: aspt < 3.5 ? 'high' : 'elevated',
        confidence: 'medium',
        headline: `Invertebrate community at ${ctx.site.name} is dominated by pollution-tolerant taxa`,
        mechanism:
          'Sensitive groups — stonefly, mayfly, cased caddisfly — disappear first under organic pollution and low oxygen, leaving worms, bloodworm and hoglouse. Because the community reflects conditions over months rather than the moment of sampling, this indicates sustained pressure, not a single event.',
        evidence,
        metrics: { aspt, tolerantDominance: tolerantDominance },
        actions: {
          citizen:
            'Repeat the kick-sample survey next season. Community change is slow, so a consistent series from the same reach is worth far more than any individual survey.',
          municipal: `Chronic pressure rather than an acute incident. Investigate persistent inputs and physical habitat in the ${ctx.site.catchment} catchment; restoring riparian cover is usually the highest-return intervention available.`,
          health:
            'Not a direct human exposure signal, but a degraded community is a reliable marker of sustained wastewater influence, which is the same pathway that carries resistance genes and enteric pathogens.',
        },
        validForHours: 60 * 24,
      };
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'vector-breeding-habitat',
    version: '1.0.0',
    domain: 'animal_health',
    title: 'Mosquito vector breeding conditions',
    rationale:
      'Stagnant, organically enriched, litter-strewn urban water within the Culex thermal envelope is the specific combination that produces West Nile virus vectors.',
    citations: [ECDC_WNV, OAH],
    evaluate(ctx) {
      const tempC = metric(ctx.current, 'waterTempC');
      if (tempC === null || tempC < 18 || tempC > 34.3) return null;

      const stagnant = (metric(ctx.current, 'stagnantFraction') ?? 0) > 0.3;
      const litter = (metric(ctx.current, 'litterScore') ?? 0) >= 2;
      const lowOxygen = (metric(ctx.current, 'dissolvedOxygenMgl') ?? 99) < 5;

      const factors = [stagnant, litter, lowOxygen].filter(Boolean).length;
      if (factors < 2) return null;

      const evidence = [
        `water temperature ${tempC.toFixed(1)} °C, within the transmission envelope`,
      ];
      if (stagnant) evidence.push('stagnant or barely flowing water');
      if (litter) evidence.push('litter providing artificial container habitat');
      if (lowOxygen) evidence.push('organic enrichment indicated by low dissolved oxygen');

      return {
        severity: factors === 3 ? 'elevated' : 'watch',
        confidence: 'medium',
        headline: `Mosquito breeding conditions present at ${ctx.site.name}`,
        mechanism:
          'Culex pipiens — the principal West Nile virus vector in Europe — breeds in stagnant, organically rich water and in the artificial containers that accumulate as litter. Transmission has been demonstrated from 18 °C upward, so temperate sites are not exempt.',
        evidence,
        metrics: {
          waterTempC: tempC,
          stagnantFraction: metric(ctx.current, 'stagnantFraction'),
          litterScore: metric(ctx.current, 'litterScore'),
          contributingFactors: factors,
        },
        actions: {
          citizen:
            'Remove containers that hold standing water — tyres, buckets, cans. Report pooling and blocked channels, which is where breeding concentrates.',
          municipal:
            'Clear litter and debris, and restore flow through pooled or blocked sections. Notify the vector surveillance programme if one operates in this municipality.',
          health:
            'Consider for vector surveillance siting. Neer does not survey mosquitoes — OneAquaHealth DipteraCAST addresses that directly, and this finding is a habitat indicator rather than a vector count.',
        },
        validForHours: 14 * 24,
      };
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'amr-pressure-hotspot',
    version: '1.0.0',
    domain: 'human_health',
    title: 'Antimicrobial resistance pressure hotspot',
    rationale:
      'Article 17 of the recast UWWTD makes wastewater AMR surveillance a legal requirement, and outfall connectivity is the observable that identifies where it matters.',
    citations: [UWWTD, OAH],
    evaluate(ctx) {
      const outfalls = metric(ctx.current, 'outfallCount') ?? 0;
      const recentSpill = (metric(ctx.current, 'sewageOdourRate') ?? 0) > 0;

      if (outfalls < 3 && !(outfalls >= 1 && recentSpill)) return null;

      const evidence = [`${outfalls} outfall(s) discharging to this reach`];
      if (ctx.site.combinedSewer) evidence.push('combined sewer catchment with overflow potential');
      if (recentSpill) evidence.push('sewage odour reported, indicating recent foul input');
      if (ctx.site.populationWithin1km > 5000) {
        evidence.push(`${ctx.site.populationWithin1km.toLocaleString()} residents within 1 km`);
      }

      return {
        severity: recentSpill ? 'elevated' : 'watch',
        confidence: 'low',
        headline: `Wastewater connectivity at ${ctx.site.name} marks it as an AMR surveillance candidate`,
        mechanism:
          'Treated and untreated wastewater is the dominant route by which antibiotic resistance genes enter urban surface water. OneAquaHealth found clinically relevant pathogens and high resistance gene loads in urban stream biofilms across its pilot cities.',
        evidence,
        metrics: {
          outfallCount: outfalls,
          populationWithin1km: ctx.site.populationWithin1km,
          combinedSewer: ctx.site.combinedSewer ? 1 : 0,
        },
        actions: {
          citizen:
            'No individual action is warranted on this finding. Reporting the location of outfall pipes and any discharge from them helps build the map this assessment depends on.',
          municipal:
            'Article 17 of the recast Urban Wastewater Treatment Directive requires AMR monitoring for agglomerations of 100,000 population equivalents and above. Sites like this one are where that sampling belongs.',
          health:
            'Candidate site for environmental AMR surveillance. Resistance genes require qPCR or metagenomics — this is a pressure proxy derived from discharge connectivity, never a measurement.',
        },
        validForHours: 30 * 24,
      };
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'sustained-decline',
    version: '1.0.0',
    domain: 'ecological',
    title: 'Sustained decline in stream health',
    rationale:
      'Slow degradation never crosses a single-point threshold, so a threshold alarm never fires on it — comparing a short window against a longer baseline is the only way to see it.',
    citations: [UKTAG],
    evaluate(ctx) {
      const delta30 = ctx.health.sohiDelta30d;
      if (delta30 === null || delta30 > -8) return null;

      const delta7 = ctx.health.sohiDelta7d;
      const accelerating = delta7 !== null && delta7 < -4;

      return {
        severity: delta30 < -18 ? 'elevated' : 'watch',
        confidence: ctx.health.confidence >= 0.5 ? 'medium' : 'low',
        headline: `Stream health at ${ctx.site.name} has declined ${Math.abs(delta30).toFixed(0)} points over 30 days`,
        mechanism: accelerating
          ? 'A sustained downward trend that is steepening over the last week. Progressive deterioration of this shape usually reflects an accumulating input rather than a discrete incident.'
          : 'A gradual downward trend with no single triggering event. Slow declines are the failure mode threshold-based monitoring is structurally blind to.',
        evidence: [
          `SOHI change over 30 days: ${delta30.toFixed(1)} points`,
          ...(delta7 !== null ? [`SOHI change over 7 days: ${delta7.toFixed(1)} points`] : []),
          `current index ${ctx.health.sohi.toFixed(0)} (${ctx.health.ecologicalScore.toFixed(0)} ecological, ${ctx.health.pressureScore.toFixed(0)} pressure, ${ctx.health.exposureScore.toFixed(0)} exposure)`,
        ],
        metrics: {
          sohiDelta30d: delta30,
          sohiDelta7d: delta7 ?? 0,
          sohi: ctx.health.sohi,
        },
        actions: {
          citizen:
            'Keep sampling on the same schedule. A consistent series is what makes a trend visible at all — gaps are what hide it.',
          municipal: `Review what has changed in the ${ctx.site.catchment} catchment over the last month: construction, land use change, new connections, or altered discharge patterns.`,
          health:
            'No immediate exposure concern. Worth tracking, because sustained ecological decline in an urban stream generally accompanies rising wastewater influence.',
        },
        validForHours: 14 * 24,
      };
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'monitoring-gap',
    version: '1.0.0',
    domain: 'data_quality',
    title: 'Monitoring gap',
    rationale:
      'Turns the absence of data into an actionable task instead of a silently low confidence score nobody notices.',
    citations: [],
    evaluate(ctx) {
      if (ctx.daysSinceLastObs < 21) return null;

      // A gap matters more where the consequences of missing something are
      // higher. An unwatched reach with public access outranks an unwatched
      // fenced culvert.
      const elevated = ctx.site.recreationalAccess || ctx.site.combinedSewer;

      return {
        severity: ctx.daysSinceLastObs > 60 && elevated ? 'elevated' : 'watch',
        confidence: 'high',
        headline: `No observations at ${ctx.site.name} for ${ctx.daysSinceLastObs} days`,
        mechanism:
          'The index shown for this site rests on stale evidence. Its credible interval has widened accordingly, and a change occurring now would not be detected.',
        evidence: [
          `${ctx.daysSinceLastObs} days since the last recorded visit`,
          `index confidence ${(ctx.health.confidence * 100).toFixed(0)}%`,
          ...(elevated ? ['site has public access or a combined sewer catchment'] : []),
        ],
        metrics: {
          daysSinceLastObs: ctx.daysSinceLastObs,
          confidence: ctx.health.confidence,
        },
        actions: {
          citizen: `This site needs a visit. Even a partial set of readings restores useful confidence — a temperature and a turbidity measurement is worth far more than nothing.`,
          municipal:
            'Prioritise volunteer recruitment or a staff visit here. Coverage gaps concentrate at exactly the sites that are hardest to reach and often most degraded.',
          health:
            'Absence of findings at this site reflects absence of observation, not absence of risk. Do not read a quiet site as a safe one.',
        },
        validForHours: 7 * 24,
      };
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'nutrient-enrichment',
    version: '1.0.0',
    domain: 'ecological',
    title: 'Nutrient enrichment',
    rationale:
      'Phosphorus is usually the limiting nutrient in fresh water, so enrichment is the precursor to the bloom rather than a separate problem.',
    citations: [UKTAG, OAH],
    evaluate(ctx) {
      const phosphate = metric(ctx.current, 'phosphateMgl');
      const nitrate = metric(ctx.current, 'nitrateMgl');
      if (phosphate === null && nitrate === null) return null;

      const phosphateHigh = phosphate !== null && phosphate > 0.8;
      const nitrateHigh = nitrate !== null && nitrate > 40;
      if (!phosphateHigh && !nitrateHigh) return null;

      const evidence: string[] = [];
      if (phosphate !== null) evidence.push(`orthophosphate ${phosphate.toFixed(2)} mg PO₄/L`);
      if (nitrate !== null) evidence.push(`nitrate ${nitrate.toFixed(1)} mg NO₃/L`);
      const ma30Phosphate = metric(ctx.ma30, 'phosphateMgl');
      if (ma30Phosphate !== null) {
        evidence.push(`30-day mean orthophosphate ${ma30Phosphate.toFixed(2)} mg PO₄/L`);
      }

      return {
        severity: phosphateHigh && nitrateHigh ? 'elevated' : 'watch',
        confidence: 'medium',
        headline: `Nutrient enrichment at ${ctx.site.name}`,
        mechanism:
          'Elevated nitrogen and phosphorus drive excessive algal and plant growth. The subsequent decay consumes oxygen, and in warm, slow water the same enrichment is the precondition for cyanobacterial blooms.',
        evidence,
        metrics: {
          phosphateMgl: phosphate,
          nitrateMgl: nitrate,
          phosphateMa30: ma30Phosphate,
        },
        actions: {
          citizen:
            'Keep recording nutrient test-kit readings. Nutrient concentrations swing widely between visits, so the value is in the series rather than in any single result.',
          municipal: `Identify nutrient sources in the ${ctx.site.catchment} catchment — wastewater discharge, agricultural runoff, misconnected drainage. Riparian buffer restoration reduces diffuse input and improves habitat at the same time.`,
          health:
            'Indirect concern. Enrichment raises the probability of a cyanobacterial bloom, which is a direct hazard where the water has public or animal contact.',
        },
        validForHours: 21 * 24,
      };
    },
  },
];

/** Look up a rule by id — used by the API to serve the rule catalogue. */
export const RULES_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));
