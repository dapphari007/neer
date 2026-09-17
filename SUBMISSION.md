# Neer — Submission

**IEEE OneAquaHealth Global Hackathon 2026**

---

## 1. Track alignment

**Track 2 — Data-to-Insight.** Single track, chosen for depth over breadth.

The track states the challenge as _"turn citizen-collected data into actionable stream health and
One Health insights"_ against the problem that _"stream data is hard to interpret and does not
clearly show patterns, risks, or health impact."_ It asks for dashboards, maps, trend analysis, and
One Health insight summaries.

| Track asks for               | Neer delivers                                                                                                                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboards                   | Overview with ranked sites, stat tiles and priority findings; site detail with score decomposition and confidence breakdown                                                                                                   |
| Maps                         | MapLibre map of twelve Coimbra sites, coloured in the WFD statutory colour code (validated for colour-blind separation), glowing waterways, a sticker-marking game layer, with a graceful fallback when tiles are unreachable |
| Trend analysis               | Daily index series with credible-interval ribbon, 7-day trailing mean, raw values retained, and rainfall on a shared time axis                                                                                                |
| One Health insight summaries | Nine deterministic rules producing evidence-bearing findings, each rendered for citizen, municipality and public health officer                                                                                               |

---

## 2. The problem

Citizen science has solved **collection**. What it has not solved is **interpretation**, and three
specific failures follow from that gap.

**No synthesis.** A row reading `DO 6.2 mg/L, turbidity 14 NTU, foam: yes` means nothing to the
volunteer who recorded it. Parameters are reported in isolation; nobody computes "is this stream
healthy?" from them, so nobody can compare sites, rank priorities, or see a trend.

**No uncertainty handling.** Citizen data is sparse and uneven in quality. Systems either treat
every observation as equally authoritative — misleading — or discard citizen data entirely, which
wastes the only observations that exist at useful frequency.

**No One Health translation.** OneAquaHealth's premise is that ecosystem condition and human
well-being are linked. But no operational tool converts a stream measurement into a statement about
human or animal health risk, which is the only form in which the data becomes actionable for a
health authority. The project's own scoping review found that most urban aquatic ecosystem
literature studies environmental _risk_ rather than human health _outcomes_ — the same gap, in the
research base.

---

## 3. The solution

**Neer** is a working analytics platform: ClickHouse for the serving layer, a NestJS read API, a
React dashboard, and two pure TypeScript packages holding the science.

### The Stream One Health Index

A 0–100 composite of three sub-indices — ecological integrity (45%), health exposure (30%),
anthropogenic pressure (25%) — built on published methods rather than invented arithmetic:

- **CCME WQI 1.0** for physico-chemistry. Chosen over NSF WQI, which requires laboratory BOD₅ and
  faecal coliform that no volunteer can produce, and whose sub-index curves are graphical Delphi
  functions with no published equations, so no two implementations agree.
- **ASPT** rather than a BMWP total. Dividing by taxon count removes sampling effort from the
  numerator — and effort is precisely what is unstandardised in citizen science.
- **UKTAG WHPT EQR boundaries** (0.969 / 0.860 / 0.723 / 0.585), which are deliberately _not_
  evenly spaced. The widely circulated BMWP class bands could not be traced to any authoritative
  source and are not used.
- **QBR** implemented in full, including its per-block clamp. It is the strongest single predictor
  of invertebrate community quality in the Iberian reference data and requires no taxonomy — the
  highest-value observation a trained volunteer can contribute.
- **Bathing Water Directive**, **WHO 2021 recreational water**, and **ECDC vector** thresholds
  anchor the exposure proxies.

Every threshold carries a provenance tag — `standard`, `derived`, or `modelled` — enforced by the
type system, so a reader can tell a legally binding limit from our own construct without reading
the commit log.

### Three decisions that define the product

**Geometric aggregation.** A reach with intact ecology (85) and low litter (80) but an active
sewage discharge driving exposure to 10 scores **62 — "Good"** under an arithmetic mean. That is not
a defensible thing to publish about water people let their children paddle in. Geometric
aggregation returns **41 — Moderate, limited by exposure**. This is what the WFD's _one out, all
out_ rule encodes, without its brittleness: UKTAG warns OOAO amplifies measurement error as element
count rises, which would be severe with ordinal citizen data.

**Uncertainty as a first-class output.** Every score carries a credible interval driven by
completeness, density, recency, observer reliability and inter-observer agreement — reported
component by component. "59%" tells a coordinator nothing they can act on; "two novice observers, no
oxygen reading in nine days" is a task list. Uncertainty becomes the product's most actionable
output: it says where the next visit is worth most.

**No language model decides what is true.** Findings come from deterministic rules that are pure
functions of their inputs. Each carries its rule id, the exact metrics that fired it, and a citation
per threshold. A fabricated pathogen warning on a public waterway either triggers an unwarranted
closure or manufactures false reassurance about a hazard nobody tested for — neither is recoverable
from a system whose reasoning cannot be audited.

---

## 4. Target users

| User                               | What they get                                                                                                                                                 | Example                                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Children, families, classrooms** | Explorer mode: a mascot whose face shows how each stream feels, real-life comparisons built from real measurements, a game map to mark, one-click share cards | _"About as cloudy as tea with milk — turbidity 32 NTU."_                                                                                                                                                     |
| **Citizens & volunteers**          | Whether the water is safe to touch, and which observation to record next                                                                                      | _"Avoid contact for 48 hours after heavy rain. Keep dogs out — they are far more likely than people to ingest a lethal cyanotoxin dose."_                                                                    |
| **Municipalities**                 | Which reach to inspect, and what to look for                                                                                                                  | _"Inspect sewer overflow structures in the Covões catchment within 48 hours. Check for blockages, misconnections and consent breaches."_                                                                     |
| **Public health authorities**      | Whether exposure warrants surveillance, with the regulatory yardstick named                                                                                   | _"Treat as elevated faecal exposure at an access point with recorded public contact. Directive inland limits are 500 cfu/100 ml E. coli — Neer cannot measure these, so confirmatory sampling is required."_ |
| **Citizen-science coordinators**   | Where coverage gaps undermine the network                                                                                                                     | _"No observations for 34 days at a site with public access. Absence of findings reflects absence of observation, not absence of risk."_                                                                      |

---

## 5. Expected impact

**On ecosystem monitoring.** Turns an unranked stream of observations into a ranked list of reaches
with named causes. A catchment manager opens the dashboard and sees, in order, which sites are worst
and what is dragging each one down — and the headroom decomposition answers the question they
actually ask, which is not "what is wrong" but "what is worth fixing first".

**On human health.** Closes the translation gap the OneAquaHealth scoping review identifies. Stream
conditions become statements about faecal exposure, bloom risk, vector habitat and AMR pressure,
each phrased as a risk proxy and each carrying its regulatory anchor. The AMR component has a direct
policy hook: the recast Urban Wastewater Treatment Directive now requires AMR surveillance for
agglomerations of 100,000 population equivalents and above, and Neer identifies candidate sites from
an observation volunteers already record.

**On participation.** The confidence model tells a coordinator exactly where the next visit is worth
most, which turns volunteer effort from undirected collection into targeted contribution. Novice
observations are down-weighted rather than discarded, so nobody's contribution is thrown away.

**On trust.** Every claim traces to a number and a source. An environmental index that cannot be
interrogated is an assertion; this one publishes its rule catalogue at `/api/rules` and its
limitations on the dashboard itself.

---

## 6. Deliverables

| Required             | Where                                                              |
| -------------------- | ------------------------------------------------------------------ |
| Track alignment      | This document, §1                                                  |
| Project description  | This document + [`README.md`](README.md)                           |
| Demo video (3–5 min) | Script and shot list: [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) |
| Code repository      | This repository — MIT licensed                                     |
| Working prototype    | `docker compose up` — no accounts, no keys, no cloud credentials   |

---

## 7. What was verified, not just claimed

Running the system found defects that reading it would not have:

- `arrayJoin` in a materialized view expanded the row set for every aggregate in the SELECT, not
  just its own, inflating observation counts 2.9×.
- The headline score used `argMax` over the latest day, which at irregularly sampled sites is
  dominated by that morning's weather — it scrambled a site ranking that is unambiguous in the data.
- ClickHouse resolves SELECT aliases inside WHERE, so projecting `toString(severity) AS severity`
  made a severity filter compare an ordinal against a label.
- The official ClickHouse image listens only on container loopback, presenting as a healthy
  container the host cannot reach.
- Findings encoded absent metrics as `-1`; an impossible concentration in an audit trail is exactly
  what later gets read as though it were real.
- The raw daily series was too noisy to read a trend from — a single low reading looked identical to
  the onset of a decline.

Each is documented in the commit that fixed it.

---

## 8. Honest limitations

Stated in full in [`README.md`](README.md) and on the dashboard's Method page. The short version:
Neer does not measure pathogens, cyanotoxins or resistance genes; the index is not validated against
ground-truth field data; several physico-chemical guidelines are modelled rather than legal limits;
and the citizen observations in this deployment are simulated, with weather and hydrology real and
the distinction disclosed on every response and every page.

A tool that makes statements adjacent to public health earns trust by naming its boundaries, not by
projecting confidence past them.
