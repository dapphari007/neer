# Data sources and provenance

Every layer in Neer is labelled real or simulated, here and in the running system. The disclosure
travels in the `meta.dataDisclosure` block of every API response and in the static export manifest,
so a consumer cannot obtain the data without also obtaining the statement of what it is.

---

## Summary

| Layer                | Source                                      | Status                             | Licence                        |
| -------------------- | ------------------------------------------- | ---------------------------------- | ------------------------------ |
| Site geography       | Real watercourses near Coimbra, Portugal    | **Real** (approximate coordinates) | —                              |
| Weather              | Open-Meteo historical archive (ERA5-backed) | **Real measurements**              | CC-BY 4.0, non-commercial tier |
| River discharge      | Open-Meteo flood API (GloFAS v4)            | **Real**, catchment-scale only     | CC-BY 4.0, non-commercial tier |
| Citizen observations | `tools/src/simulate.ts`                     | **Simulated**                      | —                              |
| Sensor water quality | Environment Agency Hydrology API            | **Real** (see `LIVE_DATA.md`)      | OGL v3                         |
| Index thresholds     | Published standards, tagged individually    | Mixed — see `INDEX_METHODOLOGY.md` | Per source                     |

---

## Real: weather and hydrology

**Open-Meteo**, no API key, no registration. 57,312 hourly readings across twelve sites for
1 March – 15 September 2026.

Retrieved per site: temperature, relative humidity, precipitation, wind speed, shortwave radiation,
soil moisture. Derived at ingest: 24-hour, 48-hour and 7-day antecedent rainfall, and consecutive
dry days preceding.

Those antecedent windows are what let the insight engine reason about _mechanism_ rather than
correlation. A dissolved-oxygen crash is ambiguous alone; the same crash 48 hours after 40 mm of
rain that followed eleven dry days is a specific, checkable hypothesis about a first-flush sewer
spill.

Responses are cached on disk (`data/cache/`, gitignored). Historical data for a past date does not
change, and re-seeding during development would otherwise burn quota against a free service for no
benefit.

### Two constraints, stated rather than discovered

**Licence.** Open-Meteo's free tier is explicitly non-commercial; data is CC-BY 4.0. Limits are
10,000 calls/day, 5,000/hour, 600/minute. A hackathon entry, academic work or a non-profit
deployment qualifies. **A commercial product does not** and would need the paid tier.

**Discharge resolution.** The flood API is GloFAS v4 at roughly 5 km. A 3 km² catchment like Ribeira
dos Covões is a fraction of one grid cell, so discharge is used as a _catchment-scale hydrological
covariate_ and never as a reach discharge value. Nothing in the product presents it as the latter.

---

## Real: site geography

Twelve sites on real watercourses in the Coimbra area — Mondego, Ceira, Coselhas, Covões, Eiras,
Ançã — spanning an urbanisation gradient: three semi-natural headwaters, five peri-urban reaches,
four urban-core sites including two culverted ones. This mirrors OneAquaHealth's own design of
twenty sites per pilot city across an urbanisation gradient.

Coimbra is a real OneAquaHealth pilot city and the project's coordinating institution.

**Coordinates are approximate representative points on those watercourses, not surveyed station
locations.** Ribeira dos Covões is included deliberately: it is a genuinely well-studied peri-urban
catchment near Coimbra, making it the most plausible site in the set for a future comparison against
real data.

---

## Simulated: citizen observations

1,515 observations across 1,212 site-days. **No real person recorded any of them.**

### Why simulate at all

A scoring model, an anomaly detector and an insight engine cannot be demonstrated against an empty
database. Hand-written fixtures are worse than useless for this: they produce exactly the patterns
the author already expects to find, so the pipeline proves nothing by finding them.

Driving a documented physical model with _real_ weather forces the analytics to recover signal that
was never handed to them directly — the rules see measurements, not the events that generated them.

### The generative model

Applied in order (`tools/src/simulate.ts`):

1. **Oxygen saturation from temperature**, via the Benson–Krause polynomial. Warm water physically
   holds less oxygen, so summer dissolved oxygen falls with no pollution at all. This is the
   confounder a naive detector mistakes for degradation every August, and it is in the data on
   purpose — the hypoxia rule has to check percentage saturation before firing.
2. **Organic loading** depresses saturation below the physical ceiling, scaled by each site's latent
   condition.
3. **Storm response**, driven by the real precipitation series: turbidity spikes, nutrients arrive
   in a first flush scaled by antecedent dry days, and in combined-sewer catchments oxygen crashes.
   Conductivity _dilutes_ under high flow — the one parameter that improves during a storm, which is
   why it must not be scored on a "more rain is worse" assumption.
4. **Scripted events** so the detectors have ground truth: a first-flush sewage spill at Covões
   (18–27 July), an algal bloom at Parque Verde (6–28 August), construction runoff at Pedrulha
   (5–24 June), and a slow nutrient decline at Ançã across the season. The bloom deliberately
   _supersaturates_ oxygen by day — the counter-intuitive signature that makes algal events easy to
   misread as healthy when volunteers sample in daylight.
5. **Observer error**, widening with inexperience (novice CV 18%, expert 4%), plus realistic
   parameter drop-out: a novice records about 45% of the optional parameters, an expert 95%. A
   volunteer with a turbidity tube and no oxygen meter is the common case.
6. **Irregular sampling** — weekend-biased, suppressed in heavy rain because nobody wades a spate to
   read a turbidity tube, and elevated during visible events because people report what they notice.

The run is seeded (`SEED_RANDOM_SEED`, default `20260918`), so the dataset is reproducible. Without
that, a score someone questions could not be reproduced, and a regression in the scoring model would
be indistinguishable from new random data.

### What the simulation produces

A genuine coverage gradient — 152 sampled days at the flagship Mondego site against 55 at the
neglected industrial reach — which is what makes the confidence model visibly do work rather than
report a constant.

---

## Field protocol alignment

The observation schema follows OneAquaHealth's published field sampling protocols
([DOI 10.5281/zenodo.20344421](https://doi.org/10.5281/zenodo.20344421)) and European volunteer
programmes:

| Category         | Fields                                                                                                | Basis                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Physico-chemical | temperature, pH, dissolved oxygen, conductivity, turbidity, nitrate, phosphate, ammonium              | OneAquaHealth Annex I; FreshWater Watch kit parameters           |
| Visual / habitat | colour, odour, foam, surface film, litter, algal cover, flow state, riparian score, visible discharge | OneAquaHealth hydromorphology and macrophyte sheets              |
| Biological       | 16 macroinvertebrate groups with log-abundance bands                                                  | Riverfly Partnership ARMI, extended into pollution-tolerant taxa |
| Catchment        | imperviousness, combined sewer, outfall count, contact proximity, population                          | OneAquaHealth catchment and 500 m buffer attributes              |

The 16 taxon groups span the full tolerance gradient deliberately. A biotic score needs both ends:
finding only worms and bloodworm is as informative as finding stonefly, in the opposite direction.

**One deliberate divergence.** Real volunteer kits report nutrients in _ordinal bands_ (FreshWater
Watch nitrate: 0.2 / 0.5 / 1 / 2 / 5 / 10 mg/L), not continuous values. Neer's schema accepts
continuous values, which is a simplification. Ingesting ordinal bands natively is the correct
long-term design and is noted as future work rather than quietly glossed.

---

## Sources evaluated and not used

| Source                       | Why not                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sentinel-2 / Copernicus**  | 10–20 m resolution cannot resolve a 1–5 m urban stream. Satellite water-quality products are validated for lakes and wide rivers. Useful for _catchment context_ — imperviousness, riparian greenness, urban heat — never for in-stream quality, and the distinction is worth stating rather than letting a reviewer assume otherwise. |
| **EEA Waterbase / WISE WFD** | Genuinely open and the right source for real observations. Not used here because the observation layer is simulated; this is the first integration a production deployment should make.                                                                                                                                                |
| **GBIF**                     | No key needed for search, but occurrence records are opportunistic presence data without sampling effort — unusable for an index that depends on effort-normalised abundance.                                                                                                                                                          |
| **EU-Hydro river network**   | Open but requires CLMS registration. Site geometry is handled with coordinates instead.                                                                                                                                                                                                                                                |
| **BigQuery public datasets** | NOAA GSOD and GHCN-D are real and useful, but they are _not_ keyless — they need a GCP project with billing. Open-Meteo's ERA5-backed archive is genuinely keyless and better resolved for Europe.                                                                                                                                     |

---

## Reproducing the dataset

```bash
docker compose up -d clickhouse
pnpm db:migrate                       # schema and materialized views
pnpm db:seed                          # fetch real weather, generate observations
pnpm --filter @neer/tools compute     # score every site-day, evaluate rules
pnpm export:demo                      # static JSON for the backend-free demo
```

Every step is idempotent. Re-running `seed` replaces rather than duplicates — which matters, because
the most common thing anyone does with a seed script is run it twice.
