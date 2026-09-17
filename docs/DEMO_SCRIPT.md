# Demo video — script and shot list

**Target: 4:00.** The brief allows 3–5 minutes.

Judging weights Impact & Alignment, Innovation, Architecture, UX and Scale. This script spends its
time on the two things that are hard to fake — the reasoning behind the index, and the fact that it
runs — rather than on a feature tour.

## Before recording

```bash
docker compose up -d
pnpm db:migrate && pnpm db:seed && pnpm --filter @neer/tools compute
```

Open http://localhost:5173. Check the basemap has loaded before you start; it occasionally needs a
reload. The app opens in **Explorer** mode — the script starts there and switches to **Scientist**
at 1:00.

Have a second window on `docs/INDEX_METHODOLOGY.md` and a terminal ready.

---

## 0:00–0:25 · The problem

**Shot:** a raw observation row on screen — `DO 6.2 mg/L · turbidity 14 NTU · foam: yes`.

> "This is a citizen stream observation. It means nothing to the volunteer who recorded it, little
> to the municipal officer who receives it, and nothing at all to the public health team who never
> sees it.
>
> Citizen science solved collection. It has not solved interpretation. Track 2 says so directly:
> stream data is hard to interpret and does not show risks or health impact."

---

## 0:25–1:00 · What it produces

**Shot:** Explorer home. Scroll to the map, drop one sticker, open the pulsing stream, then open
its share card. Keep it moving — fifteen seconds.

> "Neer turns those observations into something a ten-year-old can read. Every stream gets a score,
> a face and a colour — the Water Framework Directive's own colour code. 'Turbidity 32 NTU' becomes
> 'about as cloudy as tea with milk', with the real number underneath. Kids mark what they spot,
> and one tap makes a shareable card — with the demo-data label drawn into the image itself.
>
> Same data, second front door."

**Switch to Scientist mode.**

> "For the people who have to act on it: a defensible composite index, twelve sites near Coimbra —
> a real OneAquaHealth pilot city — ranked worst first. Honest uncertainty on every score. And One
> Health findings, each written for a different reader."

**Point at the provenance banner.**

> "This banner is not dismissible. Weather is real — 57,000 hourly readings from Open-Meteo. The
> citizen observations are simulated, and the system says so on every page and in every API
> response."

---

## 1:00–1:50 · The decision that defines the product

**Shot:** Method page, the arithmetic-vs-geometric comparison.

> "Here is the decision everything else rests on.
>
> A stream with intact ecology — 85. Low litter — 80. And an active sewage discharge driving health
> exposure to 10.
>
> Average those and you get 62. 'Good.' That is not a defensible thing to publish about water people
> let their children paddle in.
>
> Neer uses a weighted geometric mean, so the composite is 41 — Moderate, limited by exposure, with
> the reason named. That is what the Water Framework Directive's one-out-all-out rule encodes,
> without its brittleness — UKTAG warns that rule amplifies measurement error, which would be severe
> with citizen data."

**Scroll to "Biology leads, chemistry caps".**

> "The same care goes into the WFD element asymmetry. Biology alone can push a site below Good.
> Chemistry can only cap. And no site reaches High status without a biological survey."

---

## 1:50–2:40 · Uncertainty that does work

**Shot:** site detail for **Ribeira de Coselhas — culverted reach**. Hover along the trend.

> "The shaded band is the credible interval. Watch it widen where observations thin out and narrow
> where volunteers visited more often."

**Go back, open _Vala de Arzila — Pedrulha industrial_.**

> "This site has 55 sampled days. Confidence 46%, band plus or minus 17.
>
> Compare Ribeira dos Covões — 111 days, confidence 71%, band plus or minus 9.
>
> The uncertainty is live, not decorative. And it is reported component by component, because '46%'
> tells a coordinator nothing — 'two novice observers, no oxygen reading in nine days' is a task
> list. That turns uncertainty into the most operationally useful thing here: it says where the next
> volunteer visit is worth most."

---

## 2:40–3:20 · One Health translation

**Shot:** the combined-sewer-overflow finding. Expand evidence, then click through the three
audience tabs.

> "This is the One Health layer. Rainfall after a dry spell on a combined-sewer catchment, corroborated
> by sewage odour and an oxygen crash — the signature of a first-flush spill.
>
> The same fact, three readers. A resident needs to know whether to let a dog in the water. A
> municipal officer needs to know which outfall to inspect. A public health officer needs the
> regulatory yardstick — and note it says Neer _cannot_ measure faecal indicators and confirmatory
> sampling is required.
>
> Every finding opens to its evidence, the exact values that fired the rule, and a citation for every
> threshold. No language model decides what is true here. A fabricated pathogen warning on a public
> waterway either triggers an unwarranted closure or manufactures false reassurance."

---

## 3:20–3:50 · That it actually runs

**Shot:** terminal, split with the browser.

```bash
pnpm test          # 60 passing
docker compose ps  # clickhouse, api, web — healthy
```

> "Sixty tests, including one asserting that healthy sub-indices cannot mask a catastrophic one.
>
> ClickHouse for the serving layer — materialized views over aggregate state, and an ASOF join
> binding every observation to the weather that prevailed when it was taken. A NestJS read API. The
> BigQuery ML tier is real code, credential-gated off, so this runs for anyone with no cloud account
> at all.
>
> One command, no accounts, no API keys."

---

## 3:50–4:00 · Close

**Shot:** Method page, "What this system cannot do".

> "And it says what it cannot do. It does not measure pathogens. It is not validated against
> ground-truth field data. The observations here are simulated.
>
> A tool that makes statements next to public health earns trust by naming its boundaries — not by
> projecting confidence past them."

---

## Recording notes

- **Do not narrate the UI.** "Now I click here" wastes seconds. Say why it matters.
- **Let the numbers land.** Pause after 62-vs-41 and after the two confidence bands.
- **Show one finding well** rather than three quickly.
- **Do not hide the simulated data.** Judges will find it; volunteering it reads as rigour.
- 1280×800 or 1440×900. Zoom the browser to 110% so text survives compression.
- Charts animate nothing — no need to wait for transitions.

## If you have 5 minutes

Add 40 seconds after the One Health section: open the **monitoring-gap** finding.

> "The most under-used output. Absence of findings reflects absence of observation, not absence of
> risk — and the worst-monitored sites are frequently the most degraded. Here, 55 sampled days at
> the industrial reach against 152 at the city-centre park. A system that reports confidently where
> it is already watched and says nothing where it is not would entrench that gap. So a coverage gap
> is a finding in its own right."
