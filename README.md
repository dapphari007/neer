# Neer

**Turning citizen stream observations into One Health intelligence.**

IEEE OneAquaHealth Global Hackathon 2026 · **Track 2 — Data-to-Insight**

_Neer_ is the Sanskrit word for water.

---

## The problem, as Track 2 states it

> _Stream data is hard to interpret and does not clearly show patterns, risks, or health impact._

Citizen science has solved collection. Volunteers across Europe submit thousands of stream
observations. What nobody has solved is **interpretation** — and three specific failures follow.

**No synthesis.** A row reading `DO 6.2 mg/L, turbidity 14 NTU, foam: yes` means nothing to the
volunteer who recorded it, little to the municipal officer who receives it, and nothing at all to
the public health team who never sees it. Parameters arrive in isolation and nobody computes
"is this stream healthy?" from them.

**No uncertainty handling.** Citizen data is sparse and uneven. Systems either treat every
observation as equally authoritative — which is misleading — or discard citizen data entirely,
which wastes the only observations that exist at useful frequency.

**No One Health translation.** OneAquaHealth's entire premise is that ecosystem condition and human
well-being are linked. But no operational tool converts a stream measurement into a statement about
human or animal health risk, which is the only form in which the data becomes actionable for a
health authority.

## What Neer does

A working analytics platform that ingests citizen and environmental data and produces three things
nobody currently gets:

|                                           |                                                                                                                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A defensible composite index**          | The Stream One Health Index (SOHI), 0–100, built from published methods — CCME WQI, ASPT against WHPT EQR boundaries, QBR — with every threshold tagged by where it came from.                                                           |
| **Honest uncertainty**                    | Every score carries a credible interval driven by data completeness, density, recency, observer reliability and inter-observer agreement. Reported component by component, so uncertainty reads as a task list rather than a disclaimer. |
| **Audience-specific One Health insights** | Deterministic rules turn measurements into evidence-bearing findings, each rendered for a citizen, a municipality, and a public health officer — because the same fact demands different responses from each.                            |

---

## Two ways in, one dataset

|                  | For                                            | What it shows                                                                                                                                                                                                                                                    |
| ---------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🐟 **Explorer**  | Children, families, classrooms                 | Drip the droplet, whose face shows how each stream feels · stars and a score · real-life comparisons (“about as cloudy as tea with milk”) · a game-style map to mark litter, foam, fish and birds, with XP, levels and quests · one-click shareable stream cards |
| 🔬 **Scientist** | Catchment officers, researchers, public health | Credible intervals · score decomposition · trend with rainfall · evidence-bearing findings with citations and audience-specific actions                                                                                                                          |

Switching modes keeps you on the same stream, because it is the same stream — told differently,
never scored differently. Three rules keep the Explorer side honest rather than merely cute:

- **Comparisons come from the measured value, never the composite score**, and the real number is
  printed under every analogy. If a parameter was not measured, the card says so instead of guessing.
- **Safety advice is never simplified.** Findings are retold in plain language, but “what you can
  do” is the rule engine's own citizen action, unedited.
- **The demo-data label is drawn into every share card's pixels.** The cards name real rivers and
  the observations here are simulated; a caption can be deleted when an image is reposted, so the
  caveat has to live in the image. Nothing is ever posted _for_ anyone — the app holds no social
  accounts or tokens, and the person always lands in their own app with the final say.

Map marks are personal field notes stored on the device only. They never feed the index, and
collecting children's map marks on a server is not something to do without consent flows a
prototype does not have.

Status uses the **Water Framework Directive's statutory colour code** (blue / green / yellow /
orange / red), tuned until it cleared colour-blind separation, a normal-vision difference floor and
contrast on the chart surface. Yellow alone sits outside the lightness band — inherent to yellow —
so status is never colour-only: every marker also carries its number, a face and a label.

---

## Live data — real, and updating in seconds

| Layer                           | Source                                           | Real?                         | Cadence             |
| ------------------------------- | ------------------------------------------------ | ----------------------------- | ------------------- |
| Weather & hydrology, every site | Open-Meteo live service                          | **Real**                      | every 15 min        |
| Sensor water quality            | Environment Agency sondes, discovered at runtime | **Real, official, unchecked** | polled every 10 min |
| Coimbra citizen observations    | Simulated field crew over real weather           | **Simulated**                 | one every ~25 s     |
| Batch upload                    | OneAquaHealth-format CSV                         | as uploaded                   | on demand           |

A new observation is validated, stored, re-scored and pushed to every open dashboard over
server-sent events — measured at **3.2 seconds** from `POST /api/observations` to the score
changing on screen. Incremental and batch scoring are the same function, so a live number can
never disagree with a batch one.

There is no public real-time feed for the Coimbra streams themselves, so the real sensor layer
comes from an official network that publishes one — six English rivers, including the River Lee
in London — and every site carries a provenance chip saying which kind it is. Details, limits and
the API call budget: [`docs/LIVE_DATA.md`](docs/LIVE_DATA.md).

---

## Run it

Requires Docker. **No accounts, no API keys, no cloud credentials.**

```bash
docker compose up
```

Then, in a second terminal, load the data:

```bash
pnpm install && pnpm db:migrate && pnpm db:seed && pnpm --filter @neer/tools compute
```

|                   |                                       |
| ----------------- | ------------------------------------- |
| Dashboard         | http://localhost:5173                 |
| API               | http://localhost:3000/api/sites       |
| OpenAPI docs      | http://localhost:3000/api/docs        |
| Live events (SSE) | http://localhost:3000/api/events      |
| Live status       | http://localhost:3000/api/live/status |

`docker compose up` also starts the simulated field crew, so scores start moving within a minute.
Set `LIVE_WEATHER=off LIVE_SENSORS=off` to run without internet access.

For development against a hot-reloading frontend, run the database alone and the apps on the host:

```bash
docker compose up -d clickhouse && pnpm dev
```

---

## Data provenance — read this before reading any score

| Layer                | Source                                                                | Real?                                            |
| -------------------- | --------------------------------------------------------------------- | ------------------------------------------------ |
| Site geography       | Real watercourses near Coimbra, Portugal (a OneAquaHealth pilot city) | **Real**, approximate representative coordinates |
| Weather & hydrology  | Open-Meteo ERA5 archive for the seed, live service thereafter         | **Real measurements**                            |
| Sensor water quality | Environment Agency Hydrology API, sub-daily sondes                    | **Real** — `source = sensor`                     |
| Citizen observations | Documented physical simulator (`tools/src/simulate.ts`)               | **Simulated — clearly labelled**                 |

**No real person recorded these observations, and nothing here describes the measured condition of
any real stream.** The disclosure travels in every API response and on every page of the dashboard,
rather than depending on anyone remembering to add a footnote.

The simulator exists so the analytics can be exercised honestly. A scoring model and an insight
engine cannot be demonstrated against an empty database, and hand-written fixtures produce exactly
the patterns the author expected to find — which proves nothing. Driving a documented physical model
with _real_ weather forces the pipeline to find signal it was not handed directly.

See [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md).
| [`docs/LIVE_DATA.md`](docs/LIVE_DATA.md) | The live loop, sensor discovery, weather refresh, CSV import |

---

## How the index works

SOHI combines three sub-indices:

|       | Sub-index              | Weight | Built from                                                                                                                                                  |
| ----- | ---------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E** | Ecological integrity   | 45%    | CCME WQI 1.0 over physico-chemistry, plus ASPT from citizen-identifiable invertebrate groups, expressed as an Ecological Quality Ratio                      |
| **H** | Health exposure        | 30%    | Field-observable risk proxies for faecal contamination, cyanobacterial blooms, mosquito vectors and AMR pressure, scaled by actual human and animal contact |
| **P** | Anthropogenic pressure | 25%    | QBR riparian index, litter, foam, discharges, catchment sealing, outfall count, invasive plants                                                             |

### Three decisions worth defending

**Weighted geometric mean, not arithmetic.** A reach with intact ecology (85) and low litter (80)
but an active sewage discharge driving exposure to 10 scores **62 — "Good"** under an arithmetic
mean. That is not a defensible thing to publish about water people let their children paddle in.
Geometric aggregation scores it **41 — Moderate, limited by exposure**, with the reason named. This
is the behaviour the Water Framework Directive's _one out, all out_ rule encodes, without that
rule's brittleness — UKTAG warns OOAO amplifies measurement error as element count grows, which
would be severe with ordinal citizen data. There is a test asserting exactly this.

**Biology leads, chemistry caps.** Under the WFD these elements are not interchangeable, and Neer
encodes the asymmetry rather than averaging it away: biology alone can drive a site below Good;
chemistry can prevent High and cap at Moderate but cannot assert Poor or Bad; no site reaches High
without a biological survey. A naive weighted average reports the opposite in both directions.

**No language model decides what is true.** Every finding comes from a deterministic rule that is a
pure function of its inputs — no database, no network, no clock. Each carries the rule that fired
it, the exact metric values behind every claim, and a citation for every threshold. This is a safety
property, not an architectural preference: a fabricated pathogen warning on a public waterway either
triggers an unwarranted closure or manufactures false reassurance about a hazard nobody tested for.

Full methodology, with citations: [`docs/INDEX_METHODOLOGY.md`](docs/INDEX_METHODOLOGY.md).

---

## Architecture

```
Open-Meteo (real weather) ─┐
                           ├─→  ClickHouse  ──→  NestJS API  ──→  React dashboard
Citizen observations ──────┘     hot path        read-only         maps · trends · insights
                                     │
                                     ├─ materialized views maintain daily aggregate state
                                     ├─ ASOF JOIN binds each visit to prevailing weather
                                     └─ @neer/scoring + @neer/insights (pure, no I/O)
                                     │
                                     └─→  BigQuery ML  (cold path — dormant, credential-gated)
                                          ARIMA_PLUS · K-means · anomaly detection
```

**ClickHouse and BigQuery have a clean split of responsibility.** ClickHouse is the hot path: every
dashboard query, sub-second, over pre-aggregated state. BigQuery is the cold path — model training
and cross-site analysis measured in minutes, which has no business in a request. Without that
division of labour two columnar engines would be redundant; with it, each does what the other is
bad at.

The BigQuery tier is **real, complete, credential-gated code** ([`infra/bigquery/`](infra/bigquery/)),
not a stub. It ships dormant so the repository runs for anyone with zero cloud accounts, with a local
TypeScript forecaster as the default provider. One environment variable switches it on.

### Layout

```
packages/scoring    ★ pure index computation — no I/O, no clock, 60 tests
packages/insights   ★ deterministic One Health rule engine — no language model
packages/shared       Zod schemas shared by API and dashboard
apps/api              NestJS read API over ClickHouse
apps/web              React dashboard, hand-rolled SVG charts
tools                 migrate · seed · compute · export-demo
infra/clickhouse      schema, materialized views, analytical views
infra/bigquery        BQML model definitions (dormant tier)
```

`packages/scoring` and `packages/insights` are **deliberately pure** — no database, no HTTP, no
clock. The science is isolated from the infrastructure, so it is unit-testable at its boundaries and
reviewable by a domain expert who will never read a query builder.

---

## The zero-cost public demo

Hosting ClickHouse and an always-on API publicly costs real money, and the free tiers that do not
cost money sleep after fifteen minutes and take the better part of a minute to wake — exactly the
experience someone following a submission link would get.

So the dashboard has **two adapters behind one interface**. The live one talks to the API; the static
one reads pre-exported JSON with no backend at all. The rollups are **377 KB**, so they serve from
any CDN instantly, forever, for nothing:

```bash
pnpm export:demo && pnpm --filter @neer/web build   # deploy dist/ anywhere static
```

Nothing is faked to make this work — the static files are the same computed output the API returns.
Real deployment costs are in [`COSTS.md`](COSTS.md).

---

## Verify it

```bash
pnpm test        # 60 tests — index boundaries, missing-data paths, confidence degradation
pnpm typecheck
pnpm lint
```

The tests worth reading are the ones asserting the design claims rather than the arithmetic:
that healthy sub-indices cannot mask a catastrophic one; that chemistry alone cannot award High
status or assert Bad; that a lone observer is treated as uncorroborated rather than in perfect
agreement; that an empty window scores 0 rather than a spurious 100.

**End-to-end check that uncertainty is live, not decorative:** open any site, then compare the
credible interval at _Vala de Arzila — Pedrulha industrial_ (55 sampled days, confidence 0.46,
band ±17) against _Ribeira dos Covões — upper catchment_ (111 sampled days, confidence 0.71,
band ±9). The band visibly breathes with the evidence.

---

## What this system cannot do

- **It does not measure pathogens, cyanotoxins or resistance genes.** All three require laboratory
  work. What it scores are field-observable conditions _associated with_ elevated risk, and every
  finding is phrased that way.
- **The index is not validated against ground-truth field data.** It is tested for internal
  consistency and boundary behaviour. Real validation needs paired citizen and professional sampling
  across a season.
- **Several physico-chemical guidelines are modelled, not legal limits.** The WFD sets them per
  Member State and water body type; no single European number exists to cite. Anyone deploying this
  on real streams must substitute their competent authority's standards.
- **The reference ASPT is one constant, not a site-specific prediction.** Real practice derives it
  per site from RIVPACS/RICT. Neer does not implement that.
- **River discharge is catchment-scale.** GloFAS at ~5 km cannot represent an individual urban
  stream, so it is used as a hydrological covariate and never as a reach discharge value.
- **Sensor sites lack catchment attributes.** The EA API does not publish combined-sewer, outfall
  or public-access data, so the exposure rules stay quiet on those sites rather than guessing.
- **EA readings are unchecked.** They are what the instrument said, before the agency's review.
- **Open-Meteo's free tier is non-commercial.** Fine for a hackathon, academic or non-profit use;
  a commercial deployment needs the paid tier.

---

## Documentation

|                                                          |                                                 |
| -------------------------------------------------------- | ----------------------------------------------- |
| [`SUBMISSION.md`](SUBMISSION.md)                         | Track alignment, problem, solution, impact      |
| [`docs/INDEX_METHODOLOGY.md`](docs/INDEX_METHODOLOGY.md) | Every formula and threshold, with citations     |
| [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md)           | Provenance, licences, and the simulator's model |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)           | Why ClickHouse, why the split, how it scales    |
| [`docs/MODEL_CARD.md`](docs/MODEL_CARD.md)               | The forecasting tier, its evaluation and limits |
| [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md)             | Shot list for the demo video                    |
| [`COSTS.md`](COSTS.md)                                   | What a real deployment actually costs           |

---

## Alignment with OneAquaHealth

Neer is built on the project's published framework rather than a guessed one. OneAquaHealth
(Horizon Europe, 2023–2026; coordinator Universidade de Coimbra) runs pilot sites across Benevento,
Coimbra, Ghent, Oslo and Toulouse, and publishes **eleven key indicators** spanning ecosystem health
and health risk ([DOI 10.5281/zenodo.20345207](https://doi.org/10.5281/zenodo.20345207)) plus field
sampling protocols ([DOI 10.5281/zenodo.20344421](https://doi.org/10.5281/zenodo.20344421)).

Neer's observation schema follows those protocols — the outfall counts driving its AMR proxy are a
field the project already asks volunteers to record. The project publishes indicators but **no
composite index with cut-offs**; the aggregation here is our construct layered on their indicator
set, and the methodology says so.

---

MIT licensed. Contains Environment Agency information © Environment Agency and database right
(Open Government Licence v3). Weather by Open-Meteo (CC-BY 4.0). Map data © OpenStreetMap contributors.
