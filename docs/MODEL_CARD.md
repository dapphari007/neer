# Model card — Neer forecasting tier

Covers the two forecasting implementations behind `ForecastProvider`. It does **not** cover the
Stream One Health Index itself, which is a deterministic scoring model documented in
[`INDEX_METHODOLOGY.md`](INDEX_METHODOLOGY.md), nor the rule engine, which is deterministic logic
rather than a learned model.

---

## Status

| Provider            | Default | Requires                  | State                                    |
| ------------------- | ------- | ------------------------- | ---------------------------------------- |
| `local-holt-damped` | **Yes** | Nothing                   | Live                                     |
| `bqml-arima-plus`   | No      | GCP project + credentials | **Dormant — never trained or evaluated** |

**The BigQuery provider has not been run.** This project had no GCP access, so the SQL in
`infra/bigquery/bqml/` is written and reviewable but unexecuted, and the evaluation table below is
empty rather than filled with plausible-looking numbers. Reporting metrics for a model that was
never trained would be fabrication.

---

## Intended use

Short-horizon projection (7–21 days) of the Stream One Health Index per site, to support:

- **Monitoring prioritisation** — where a decline is projected, send a volunteer.
- **Advance notice** — flagging deteriorating trends before a threshold is crossed.

### Out of scope

- **Not a public health forecast.** It projects an index built on modelled risk proxies, not
  measured hazard. It must never be used to open or close a bathing site.
- **Not a regulatory instrument.** WFD classification is a multi-year process over professional
  sampling.
- **Not valid beyond ~21 days.** Intervals widen to uselessness; the damped trend flattens by design.

---

## `local-holt-damped` (default)

Holt's linear trend method — double exponential smoothing with a damped trend. α = 0.3, β = 0.1,
φ = 0.85.

**Why a deliberately simple model.** Citizen observation series are short, gappy and irregular: at
most a few hundred points per site, many days missing. Fitting a seasonal ARIMA to that produces
confident-looking output whose intervals are not honest, because the model has nowhere near the data
its assumptions require. Holt's method needs only a level and a trend and degrades gracefully.

**Why damped (φ < 1).** Undamped linear extrapolation of a bounded index is actively misleading: a
fortnight of decline projected straight out reaches zero inside two months, which is not a forecast
but an artefact of the functional form. Damping flattens the projection toward a plateau — both the
better-performing choice at short horizons and the more honest one.

**Prediction intervals** come from observed one-step-ahead residuals, not a distributional
assumption about the data. Uncertainty grows with √h, as for a random walk. Output is clamped to
0–100.

**Refuses below 10 observation days**, returning an empty result with a reason. Extrapolating from
nine points would produce a line with an interval wide enough to contain every possible outcome —
less useful than saying so.

### Evaluation

Not yet run. The honest baseline comparison is against **persistence** ("tomorrow equals today"),
which is free and frequently wins at short horizons on noisy environmental series. The query is in
`infra/bigquery/bqml/02_evaluate.sql`; an equivalent local harness is the first thing this tier
needs.

**A forecaster that cannot beat persistence should be switched off, not reported.** That has not
been established either way here.

---

## `bqml-arima-plus` (dormant)

BigQuery ML `ARIMA_PLUS`, one model over all sites via `TIME_SERIES_ID_COL`.

`AUTO_ARIMA` (max order 5), daily frequency, `HOLIDAY_REGION = 'PT'`, `CLEAN_SPIKES_AND_DIPS`,
`ADJUST_STEP_CHANGES`, 21-day horizon holdout.

**Why it would be better.** Automatic seasonality detection, holiday effects, explicit spike/dip
handling, and `ML.EXPLAIN_FORECAST` — which decomposes a projection into trend, seasonal and holiday
components. That last one matters most: it lets a municipal officer see whether a projected decline
is a real trend or the weekend-sampling artefact the volunteer rota produces.

**Training excludes days with confidence < 0.25.** Those days remain in the index and on the
dashboard; they are simply poor evidence to fit on, and including them teaches the model that noise
is signal.

### Known modelling hazard, unresolved

Weekly seasonality in this data is **an artefact of when volunteers sample**, not of the stream.
Weekend visits dominate. ARIMA_PLUS will find that periodicity and model it as if Saturdays were
ecologically distinct.

It is modelled deliberately so it can be _removed_ from the trend — but a naive reading of the
seasonal component would conclude streams are healthier at weekends, which is a statement about
volunteer rotas. Anyone activating this tier must check the decomposition before trusting the trend.

---

## Training data

|            |                                                                |
| ---------- | -------------------------------------------------------------- |
| Source     | `site_health_daily` — the computed index                       |
| Extent     | 12 sites, 1,212 site-days, 1 Mar – 15 Sep 2026                 |
| Per site   | 55–152 observed days                                           |
| Provenance | **Index derived from simulated observations and real weather** |

**The forecasters would be trained on simulated data.** Any evaluation metric obtained here measures
how well a model predicts the simulator, not how well it predicts a stream. This is disqualifying
for any claim of real-world accuracy and is the single largest limitation of this tier.

---

## Ethical considerations

**Failure asymmetry.** A missed decline means a stream degrades unobserved. A false alarm means a
wasted inspection. The first is worse, which argues for sensitivity over precision — but only up to
the point where alerts stop being read. Neer resolves this by keeping forecasting _advisory_: no
finding, no alert and no public health statement is derived from a forecast. Findings come only from
deterministic rules over observed data.

**Automation bias.** A projected line invites more confidence than a prediction interval warrants.
This is why intervals are mandatory in the interface (`ForecastResult` has no point-only shape), why
they come from observed residuals, and why the damped trend refuses to draw a dramatic slope.

**Equity of coverage.** Sites with the most volunteers get the best forecasts. In practice the
best-monitored sites are the visible, accessible, often-affluent ones, and the worst-monitored are
frequently the most degraded — here, 55 days at the industrial reach against 152 at the city-centre
park. A system that forecasts well where it is already watched and poorly where it is not can
entrench that gap. The monitoring-gap rule exists partly to counteract it by making absence of
observation a visible finding in its own right.

---

## Before this tier is trusted

1. Evaluate the local forecaster against persistence. If it does not win, disable it.
2. Never report BigQuery metrics until the model has actually been trained.
3. Re-evaluate on real observations. Metrics from simulated data are not transferable.
4. Check the seasonal decomposition for the sampling artefact before publishing any trend.
5. Keep forecasts out of the finding path. They are advisory, and the architecture should keep
   enforcing that rather than relying on discipline.
