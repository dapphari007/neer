# Architecture

```
Open-Meteo (real) ──┐
                    ├──→  ClickHouse  ──→  NestJS API  ──→  React dashboard
Observations ───────┘      hot path        read-only        map · trends · findings
                               │
                               ├─ MVs maintain daily aggregate state on insert
                               ├─ ASOF JOIN binds each visit to prevailing weather
                               └─ batch scorer: @neer/scoring + @neer/insights
                               │
                               └──→  BigQuery ML  (cold path — dormant)
```

---

## The organising principle

**The database aggregates. TypeScript does science. Neither does the other's job.**

ClickHouse is extremely good at collapsing millions of rows into hundreds. It is a poor place to
express a scoring model: SQL that encodes class boundaries, weighting and uncertainty is unreadable
to the domain experts who most need to check it, and untestable without standing up a database.

So `packages/scoring` and `packages/insights` are **pure** — no database, no HTTP, no clock, no
environment access. Every function is a total function of its arguments. A scientist can read one
file per concept and every threshold carries a provenance tag. The 60 tests construct context
literals; none needs a container.

The cost is one extra hop: rollups leave ClickHouse, get scored, and results are written back. At
this volume that is seconds. The benefit is that the science is reviewable and the class boundaries
live in exactly one place.

---

## ClickHouse, used as ClickHouse

Not "Postgres with a different name". The features that matter here:

**`AggregatingMergeTree` with aggregate states.** `site_daily_metrics` stores `-State` values, not
finalised numbers, maintained incrementally by materialized views on insert. Because states are
composable, the same table answers daily, weekly and monthly questions by merging at different
granularities — no second rollup table, no re-scan of the raw grain. A 180-day trend merges ~180
rows regardless of how many field visits produced them.

**`ASOF JOIN`** binds each observation to the weather that actually prevailed when it was taken. The
two series run on unrelated clocks — a volunteer samples at 09:14 on a Saturday, the archive ticks
hourly — so an equi-join is either wrong at bucket boundaries or quadratic. ASOF resolves each
observation against the most recent preceding reading in one pass over sorted data. This is the
feature that turns "dissolved oxygen 4.1 mg/L" into "4.1 mg/L, 31 °C, 38 mm of rain in 48 hours
after 11 dry days" — a hypothesis someone can check.

**Window functions** for rolling trends. **`argMax`** for latest-value-per-key in a single pass.
**`LowCardinality`** for enums. **`quantilesTDigest`** for the within-day spread that feeds
inter-observer agreement — a signal a plain average throws away.

**Partitioning and ordering.** `PARTITION BY toYYYYMM`, `ORDER BY (site_id, day)`. Every dashboard
query filters site then time, so that is the primary-key prefix.

### Two schema decisions that were wrong first

**`arrayJoin` in a materialized view.** Computing taxon richness needed `arrayJoin(taxa_groups)` in
the view's SELECT — which expands the row set for _every_ aggregate in that SELECT, not only the one
referencing it. Observation counts inflated 2.9×. Richness is derived from the raw grain instead,
and the table comment says why so nobody re-adds it.

**Latest-day headline.** `site_health_current` began as a view using `argMax(sohi, day)`. At
irregularly sampled sites the most recent day is dominated by that morning's weather, and ranking
twelve sites that way scrambled a gradient that is unambiguous in the data. It is now a table
holding a trailing 14-day summary written by the batch scorer — which also keeps classification in
`classifySohi` rather than duplicating class boundaries into a SQL `multiIf` where the two would
drift apart on the first recalibration.

---

## ClickHouse _and_ BigQuery — the split

Two columnar OLAP engines need a reason. Theirs:

|         | ClickHouse — hot                                  | BigQuery ML — cold                                            |
| ------- | ------------------------------------------------- | ------------------------------------------------------------- |
| Role    | Interactive serving, every dashboard query        | Batch training, cross-site analysis                           |
| Latency | Sub-second, synchronous                           | Minutes, asynchronous                                         |
| Work    | Rollups, ASOF joins, window trends, index serving | ARIMA_PLUS forecasting, K-means archetypes, anomaly detection |
| Status  | **Live** — the system of record                   | **Dormant** — real code, credential-gated                     |

Model training has no business in a request path, and ClickHouse is not a training engine.
ARIMA_PLUS brings automatic seasonality detection, holiday effects, spike/dip handling, and
`ML.EXPLAIN_FORECAST` — which decomposes a projection into trend and seasonal components, turning a
forecast into something a non-statistician can interrogate. A single `CREATE MODEL` with
`TIME_SERIES_ID_COL` fits every site at once, so adding cities scales by row count rather than
orchestration.

The mirror is loaded by **periodic export, not dual writes**. Dual writes would put a cloud
dependency in the ingestion path, turning a BigQuery outage into an ingestion outage — an
unacceptable trade for a tier whose entire purpose is work that can wait.

**Why dormant.** The repository must run for a reviewer with no cloud account. The forecast provider
interface has two implementations: a local damped-trend model (default, zero credentials) and the
BigQuery one. Both write to the same `forecasts` table tagged by `model`, so results are directly
comparable and evaluating one against the other is a single `GROUP BY`. Switching is one environment
variable; if BigQuery is requested but unavailable the module falls back and logs a warning rather
than starting in a state where every forecast request fails.

---

## The API

Read-only, and constrained at the connection rather than by convention: `readonly=1`, a 12-second
execution cap, a 200k row ceiling. A missing `WHERE` clause degrades one request instead of
streaming a table into the API process. Parameters bind through ClickHouse's `{name:Type}` syntax
throughout — a site id in a URL path is attacker-controlled input like any other.

Validation uses the Zod schemas in `@neer/shared` rather than Nest's `ValidationPipe`, which wants
`class-validator` and decorated DTO classes. Adopting it would mean two libraries describing the
same contracts, and they would drift. Sharing schemas makes a contract change fail at compile time
on both sides of the wire.

Errors return a generic message to the client and detail to the log: a ClickHouse exception names
tables, columns and query text.

Every response carries `meta.dataDisclosure`. A client cannot obtain Neer data without also
obtaining the statement of what is measured and what is modelled, which makes honest presentation
the default rather than an act of diligence by whoever builds the UI.

---

## The dashboard, and the cost problem

Two adapters behind one interface: `HttpAdapter` (live API) and `StaticAdapter` (pre-exported JSON,
no backend). Selected by whether `VITE_API_BASE_URL` is set at build time.

This exists for cost. Hosting ClickHouse and an always-on API publicly costs real money, and the
free tiers that do not cost money sleep after fifteen minutes and take the better part of a minute
to wake — exactly what someone following a submission link would hit. The rollups are 377 KB, so
they serve from any CDN instantly, forever, for nothing. Nothing is faked: the static files are the
same computed output the API returns.

Charts are hand-rolled SVG. The marks needed here — a credible-interval ribbon, a crosshair reading
two series, a rainfall panel sharing an x-axis — are less work to draw than to argue a charting
library out of its defaults, and every colour was run through a contrast, chroma, lightness-band and
colourblind-separation validator in both themes rather than chosen by eye.

---

## Scaling

The hackathon dataset is 12 sites, 1,515 observations, 57k environmental readings. OneAquaHealth's
own design is 100 sites across five cities. What changes:

| Scale                             | What holds                                                                          | What needs work                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 100 sites, 5 cities               | Everything. ClickHouse is idle at this volume; the API reads rollups, not raw rows. | Nothing structural.                                                          |
| 1,000 sites                       | Rollups still bound query cost. Batch scoring is ~1 ms/site-day.                    | Scoring moves from a single process to a queue.                              |
| 10,000+ sites, continuous sensors | ClickHouse is designed for exactly this ingest profile.                             | Raw-grain TTL with rollup retention; the BigQuery tier stops being optional. |

The binding constraint is not the database. It is **volunteer coverage** — 55 sampled days at the
worst-monitored site here, against 152 at the best. Which is why the confidence model is not a
disclaimer but the product's most operationally useful output: it says where the next visit is worth
most.

---

## Deliberate omissions

**No authentication.** A read-only public-interest environmental dataset. Adding auth would be
security theatre over data whose value lies in being open. Write endpoints would need it; there are
none.

**No ORM.** Analytical queries built around merge combinators, ASOF joins and window functions are
not what an ORM is for, and the abstraction would obscure exactly the features chosen for.

**No router library.** Two views and a method page. A router would be a dependency and a bundle for
no capability used.

**No language model anywhere in the decision path.** Prose generation, where used at all, only
renders an already-decided finding. Stated in `INDEX_METHODOLOGY.md` and enforced by the rule
engine's purity.
