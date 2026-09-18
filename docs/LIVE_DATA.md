# Live data — what is real, what moves, and how fast

Neer runs on three layers of data that arrive by different routes and are labelled differently.
This document says exactly what each one is.

| Layer                         | Source                                                             | Real?                         | Cadence                                                        | Sites                            |
| ----------------------------- | ------------------------------------------------------------------ | ----------------------------- | -------------------------------------------------------------- | -------------------------------- |
| Weather & hydrology           | Open-Meteo (ERA5 archive + live forecast service)                  | **Real**                      | refreshed every 15 min                                         | all                              |
| Sensor water quality          | Environment Agency Hydrology API — sub-daily sondes                | **Real, official, unchecked** | stations polled every 10 min; instruments report ~every 15 min | discovered at runtime, default 6 |
| Citizen observations, Coimbra | Simulated field crew (documented physical model over real weather) | **Simulated**                 | one observation every ~25 s                                    | 12 pilot sites                   |
| Citizen observations, batch   | OneAquaHealth-format CSV import                                    | Whatever the file holds       | on upload                                                      | any known site                   |

Every site carries a `source` — `simulated`, `sensor` or `citizen` — and the dashboard shows a
provenance chip on every card, pin and story. A reader looking at a Thames sonde sees _Real
sensor_; a reader looking at a Coimbra reach sees _Simulated_, on the same screen.

---

## Why "real-time" has to be built this way

There is no public real-time feed of citizen or sensor water-quality data for the Coimbra
streams. OneAquaHealth's own app data is not published, and Portugal's national hydrological
service (SNIRH) has no API. Pretending otherwise would be the one thing this project must not do.

So "real-time" is assembled honestly from what exists:

1. **A genuinely live pipeline.** A new observation — from a phone, a sensor bridge or the
   simulated crew — is validated, stored in ClickHouse, re-scored and pushed to every open
   dashboard. Measured end to end: **3.2 seconds** from `POST` to the score changing on screen.
2. **Real live weather for every site**, so the antecedent-rainfall reasoning behind the sewer
   overflow rule is current, not a snapshot.
3. **Real sensor stations from an official network that publishes a keyless API** — the
   Environment Agency in England — added as clearly labelled real sites.

The Coimbra observations stay simulated, and say so everywhere. What is demonstrated on them is
the _pipeline_: the same code path that will carry real citizen data when a programme connects
its app, with nothing changed but the source.

---

## The live loop

```
 field crew / phone / sensor bridge
            │  POST /api/observations   (validated by the shared Zod schema)
            ▼
     ClickHouse  ──── materialized views update daily aggregate state on insert
            │
            │  debounced 2 s, one run per burst
            ▼
   @neer/pipeline scoreSites(siteIds)  ──── same function the batch tool uses
            │
            ├── site_health_daily, site_health_current, findings  (ReplacingMergeTree; readers use FINAL)
            │
            ▼
     GET /api/events  (server-sent events: scores · observations · sensors · weather · heartbeat)
            │
            ▼
   dashboard refetches the endpoints it already trusts, shows "Live · 4s ago · re-scored Lee"
```

**Incremental and batch scoring are one function.** `scoreSites` in `@neer/pipeline` is called by
the nightly-style batch tool (every site, truncate first) and by the API (one site, seconds after
its data changed). A live number can therefore never disagree with a batch number.

**Events carry ids, not payloads.** Pushing scored records over the stream would create a second
code path producing the same JSON as the REST endpoints, and two paths drift. The client hears
_what_ changed and asks the endpoint it already trusts.

**ReplacingMergeTree + FINAL.** Re-scoring inserts replacement rows rather than deleting; ClickHouse
collapses them at merge time, and every reader of a result table uses `FINAL` so it sees the
winner before the merge happens. A batch run truncates first; an incremental run must not.

---

## Environment Agency sensors

The EA runs sub-daily water-quality sondes on English rivers and publishes readings through the
Hydrology API at roughly fifteen-minute cadence: dissolved oxygen, temperature, pH, conductivity,
turbidity, ammonium and, at a few sites, nitrate.

**Stations are discovered, not hard-coded.** Sondes are deployed for a campaign and then moved —
the first probe of this API found stations whose "latest" reading was from 2014. Asking _which
measures have readings in the last 36 hours_ finds the ones reporting now. On boot and every six
hours the service ranks live stations by how many parameters they report, keeps the best-covered
(default six, `LIVE_SENSOR_LIMIT`), and registers them as sites. At the time of writing that set
includes the River Lee at Springfield Park in London — an urban river reporting all six
parameters.

**Ingestion is idempotent by asking the database, not by deduplicating.** `observations` is an
append-only MergeTree. Each poll asks for the latest stored reading per station and fetches only
newer ones. Readings are folded into one observation per fifteen-minute bucket, so two sondes on
one station line up.

**Limits, stated where they bite:**

- The catchment attributes the exposure rules need — combined sewer, outfall count, public
  access — are not published by this API. Sensor sites carry conservative defaults, and the rules
  that need those inputs stay quiet there rather than guessing. Their exposure sub-index is
  therefore _less informative_, not _better_, than a Coimbra site's.
- Ammonium is stored as reported; the API does not say whether it is expressed as NH₄ or as N.
- Readings arrive flagged **Unchecked** — what the instrument said, before the EA's quality
  review. A sonde can foul; a reading can be wrong.
- Licence: Open Government Licence v3. Attribution appears in the page footer: _Contains
  Environment Agency information © Environment Agency and database right._

---

## Live weather

`fetchLiveWeather` calls Open-Meteo's forecast service with `past_days=7` and keeps only hours
that have already happened — storing forecast hours as readings would let the rule engine cite
rain that has not fallen yet. Seven days of history are re-fetched every time because the
antecedent windows (24 h / 48 h / 7 d rainfall, consecutive dry days) need a week of context to be
right; `env_readings` is a ReplacingMergeTree, so the overlap overwrites rather than duplicates.

After every refresh all sites are re-scored: a storm changes the reading of an oxygen crash even
if no one has been out since.

**Budget.** Two calls per site per refresh, every 15 minutes: 18 sites → ~3,500 calls/day, inside
the free tier's 10,000/day. The free tier is **non-commercial**; a commercial deployment needs the
paid tier (see `COSTS.md`).

---

## The simulated field crew

`neer-tools live` (the `fieldcrew` container) picks a Coimbra site every ~25 seconds — busier sites
more often — asks ClickHouse for that site's latest _real_ weather, generates one observation from
the same physical model the seed uses, and `POST`s it exactly as a phone app would. Observations
are tagged `neer-field-crew`, land only on `simulated` sites, and never touch sensor sites.

It exists so the live path is exercised continuously by traffic that looks like the real thing —
and so a demo audience sees scores move.

---

## Batch import — OneAquaHealth CSV

The OneAquaHealth data platform (`apps.oneaquahealth`) collects field measurements against a
fixed parameter vocabulary. `POST /api/import/oah-csv` accepts a CSV in that vocabulary, resolves
each site reference against Neer's sites (by id, provider reference, then name), stores the visits
and re-scores every site touched. `?dryRun=1` parses and resolves without writing, and returns the
same report — so a coordinator sees exactly which columns and sites were understood before a row
is committed. The same importer is reachable from the command line (`pnpm --filter @neer/tools
import file.csv --dry-run`) and from the Scientist view.

Codes understood, from the platform's Water Parameters page:

| Code                                                   | Meaning                                     | Scored?                                           |
| ------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------- |
| `WTC`                                                  | Water temperature (°C)                      | yes                                               |
| `WDO_MG`                                               | Dissolved oxygen (mg/L)                     | yes                                               |
| `WPH`                                                  | pH                                          | yes                                               |
| `WCON_US`                                              | Conductivity (µS/cm)                        | yes                                               |
| `WTURB_NTU`, `WNO3_MG`, `WPO4_MG`, `WNH4_MG`           | turbidity, nitrate, phosphate, ammonium     | yes — assumed codes, confirm against the template |
| `ATC`                                                  | Air temperature                             | recorded, not scored                              |
| `WDO_PC`                                               | Dissolved oxygen (% saturation)             | recorded, not scored (mg/L is used)               |
| `WTDS_MG`                                              | Total dissolved solids                      | recorded, not scored                              |
| `FCV_VI/VII/VIII`, `WCD_DI/DII/DIII`, `WW_WI/WII/WIII` | flow velocity, depth, width at three points | recorded, not scored (hydromorphology)            |

Wide layout (one column per code) and long layout (`code,value` per row) are both accepted;
comma and semicolon delimiters, ISO and day-first dates, decimal commas. Unknown codes are
**reported, never silently dropped**.

**The exact template has not been verified against a downloaded file** — the code list is what
the platform's parameter page shows. The dry-run report is the check.

---

## Switches

| Variable                       | Default | Effect                                               |
| ------------------------------ | ------- | ---------------------------------------------------- |
| `LIVE_WEATHER`                 | `on`    | `off` disables the weather refresh (no internet, CI) |
| `LIVE_SENSORS`                 | `on`    | `off` disables EA discovery and polling              |
| `LIVE_SENSOR_LIMIT`            | `6`     | how many live stations to follow                     |
| `LIVE_WEATHER_INTERVAL_MS`     | 900000  | refresh cadence                                      |
| `LIVE_SENSOR_INTERVAL_MS`      | 600000  | poll cadence                                         |
| `LIVE_INTERVAL_MS` (fieldcrew) | 25000   | seconds between simulated visits                     |

`GET /api/live/status` reports, from the database, when each source last ran and whether it
succeeded — so freshness is a fact in ClickHouse rather than in a process's memory.
