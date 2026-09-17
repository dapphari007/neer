# What this actually costs to run

Written because "it scales" is a claim, and an unpriced claim is not one. Figures are order-of-magnitude
list prices as of late 2026 and will drift; the reasoning is the durable part.

---

## Local / evaluation — **€0**

`docker compose up`. No accounts, no keys, no cloud. This is the path a reviewer uses and it costs
nothing but disk.

---

## Public demo — **€0, indefinitely**

The path this repository ships.

| Component          | Service                                              | Cost |
| ------------------ | ---------------------------------------------------- | ---- |
| Dashboard (static) | Vercel / Netlify / Cloudflare Pages free tier        | €0   |
| Data               | 377 KB of pre-exported JSON, served as static assets | €0   |
| Backend            | none                                                 | €0   |

```bash
pnpm export:demo && pnpm --filter @neer/web build   # deploy dist/
```

**Why this exists.** The obvious deployment — ClickHouse plus an always-on API — costs real money,
and the free tiers that do not cost money sleep after fifteen minutes and take the better part of a
minute to wake. That is precisely the experience someone clicking a submission link would get. Two
adapters behind one interface removes the problem rather than paying to work around it.

**What it gives up.** No live queries, no ad-hoc date ranges, no ingestion. It is a faithful snapshot
of computed output, not the system. The full stack remains one command away.

---

## Pilot: one city, ~20 sites

Roughly OneAquaHealth's per-city design.

| Component  | Option                                         | Monthly                  |
| ---------- | ---------------------------------------------- | ------------------------ |
| ClickHouse | Self-hosted, 2 vCPU / 4 GB VM                  | €12–20                   |
|            | ClickHouse Cloud, smallest development service | €50–100                  |
| API        | Cloud Run / Fly.io, scale-to-zero              | €0–5                     |
| Dashboard  | Static hosting                                 | €0                       |
| Weather    | Open-Meteo free tier                           | €0 (non-commercial only) |
| **Total**  | self-hosted                                    | **€12–25/month**         |

**Data volume is negligible.** Twenty sites producing 2,500 observations a year plus hourly weather
is roughly 100 MB/year before compression, and ClickHouse typically compresses this shape 8–12×. The
cost is the VM being switched on, not the data on it.

**The realistic trap** is ClickHouse Cloud's idle billing. A development service that never scales to
zero costs the same whether anyone visits or not, which for a pilot with a dozen weekly users is
poor value against a €12 VM.

---

## Regional: 100 sites, five cities

| Component               | Option                                          | Monthly            |
| ----------------------- | ----------------------------------------------- | ------------------ |
| ClickHouse              | 4 vCPU / 16 GB, managed or self-hosted          | €60–150            |
| API                     | 2 instances, always-on                          | €20–40             |
| Dashboard + CDN         | Static                                          | €0–5               |
| Weather                 | Open-Meteo **paid** tier (commercial or volume) | €30–100            |
| Object storage (photos) | S3-compatible, ~50 GB                           | €1–3               |
| **Total**               |                                                 | **€110–300/month** |

Still small. The binding cost at this scale is not infrastructure — it is **volunteer coordination**,
which is staff time and an order of magnitude larger than everything in this table.

### If the BigQuery tier is activated

| Item                                   | Cost                                  |
| -------------------------------------- | ------------------------------------- |
| Storage (~2 GB mirrored)               | ~€0.04/month                          |
| ARIMA_PLUS training, 100 sites, weekly | Inside the 1 TB/month free query tier |
| Forecast serving                       | Negligible                            |
| **Realistic**                          | **€0–5/month** at this scale          |

The free tier genuinely covers it here. That stops being true at national scale with per-site
retraining, where partition pruning stops being an optimisation and becomes the thing standing
between you and a four-figure bill. The mirror schema is partitioned by day and clustered by site
for exactly that reason.

---

## National: 10,000+ sites, continuous sensors

| Component                                | Monthly              |
| ---------------------------------------- | -------------------- |
| ClickHouse cluster (3 nodes, replicated) | €400–900             |
| API (autoscaled)                         | €80–200              |
| BigQuery (training + analysis)           | €50–300              |
| Object storage                           | €20–60               |
| **Total**                                | **€550–1,500/month** |

At this point the architectural decisions start paying rent:

- **Rollups bound query cost.** The API reads pre-aggregated daily state, so dashboard cost grows
  with _sites × days_, not with observation volume. Adding continuous sensors multiplies raw rows
  without moving the serving cost.
- **Raw-grain TTL.** Keep raw observations hot for 12–24 months, keep rollups forever. The index is
  computed from rollups, so history survives at a fraction of the storage.
- **The cold path stops being optional.** Training across 10,000 sites is exactly the work that has
  no business in a request path, and exactly what BigQuery is priced for.

---

## The costs that are not infrastructure

Honest accounting, because these dominate and are routinely omitted:

|                                     | Scale                                                                                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Volunteer coordination and training | The largest line at every scale. Dwarfs hosting.                                                                                                                                 |
| Laboratory confirmation             | Neer produces risk _proxies_. Acting on them requires real sampling — tens to low hundreds of euros per sample.                                                                  |
| Index calibration                   | Paired citizen/professional sampling across a season, to move the index from internally consistent to externally validated. One-off, and unavoidable before any real deployment. |
| Maintenance                         | A dependency and standards-review cadence. Environmental standards change.                                                                                                       |

---

## Licence constraints that carry cost

**Open-Meteo's free tier is non-commercial.** Explicitly: personal, non-profit and academic use.
Data is CC-BY 4.0; limits are 10,000 calls/day. A hackathon entry qualifies. **A commercial product
does not**, and needs the paid tier — the €30–100/month line above, not an oversight.

**EEA Waterbase and WISE** are free for commercial and non-commercial reuse with attribution. They
are the right first real-data integration and add no cost.

**Copernicus** is free but requires registration for API access. Useful for catchment context —
imperviousness, riparian greenness — and not for in-stream quality, since 10–20 m resolution cannot
see a 1–5 m urban stream.

---

## Summary

| Deployment             | Monthly        | Notes                              |
| ---------------------- | -------------- | ---------------------------------- |
| Local evaluation       | **€0**         | `docker compose up`                |
| Public demo            | **€0**         | Static, indefinite, no cold starts |
| One-city pilot         | **€12–25**     | Self-hosted ClickHouse             |
| Five cities, 100 sites | **€110–300**   | Matches OneAquaHealth's own design |
| National, 10,000 sites | **€550–1,500** | Rollups and TTL doing the work     |

Infrastructure is not what makes this hard. Volunteer coordination is, and the confidence model is
built to spend that effort where it buys the most.
