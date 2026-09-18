# Presentation video — plan

**Status: plan only. Not built yet.** Features are still landing; this document is the brief we
build from once they settle. Anything marked ⏳ depends on a feature that may still change.

---

## What "a video in HTML" means here

Not an MP4 rendered by a video editor. A **self-contained web page that plays like a video**: a
sequence of scenes with timed narration captions, animated transitions, an animated architecture
diagram, and — the part no screen recording can do — **live embeds of the real dashboard** pulling
real numbers at the moment it plays.

It has a play/pause button, a scrubbable progress bar, keyboard navigation (← → space), and a
"present" mode that hides the controls. It is one HTML file plus the same static export the demo
already uses, so it deploys anywhere the dashboard deploys, for free.

Two ways to use it:

| Use                                                                  | How                                                                                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Submission deliverable** (the brief requires a 3–5 min video file) | Screen-record the player once at 1080p, export MP4. Because the player is deterministic and timed, a single take is enough.                                  |
| **Live pitch / judges' Q&A**                                         | Open the page and present from it. Scenes can be paused, and every embed is the real product, so a judge's "can you click that?" is answered by clicking it. |

The reason to do it this way instead of slides-plus-screen-recording: the product's whole claim is
that it turns numbers into meaning. A presentation that _shows the live numbers changing_ while the
narration explains them is the claim, demonstrated. A slide with a screenshot is the claim, asserted.

---

## Target length and structure

**4:15 total** — the brief allows 3–5 minutes; leave 45 seconds of margin for judges who play it
at 0.9× or pause.

The arc is **problem → child → scientist → how it works → why to trust it → close**. Explorer
mode goes before Scientist mode deliberately: it is the surprising thing, it earns attention, and
the Scientist section then reads as "and here is the rigour underneath what you just saw".

| #   | Scene                         | Time      | Runs |
| --- | ----------------------------- | --------- | ---- |
| 1   | The row of numbers            | 0:00–0:20 | 20 s |
| 2   | Meet Drip                     | 0:20–0:50 | 30 s |
| 3   | Tea with milk                 | 0:50–1:20 | 30 s |
| 4   | The map is a game             | 1:20–1:45 | 25 s |
| 5   | One tap to tell the story     | 1:45–2:05 | 20 s |
| 6   | Same stream, scientist's view | 2:05–2:35 | 30 s |
| 7   | 62 versus 41                  | 2:35–2:55 | 20 s |
| 8   | How it works — the pipeline   | 2:55–3:35 | 40 s |
| 9   | Why you can trust it          | 3:35–4:00 | 25 s |
| 10  | Close                         | 4:00–4:15 | 15 s |

---

## Scene by scene

Each scene lists: what is on screen, what animates, the narration (also shown as a caption), and
which real data it pulls.

### 1 · The row of numbers — 0:00–0:20

**On screen.** Black. A single monospaced line types itself out:
`DO 6.2 mg/L · turbidity 14 NTU · foam: yes · nitrate 12 mg/L`. It sits there. Nothing else.

**Animates.** Typewriter, then a slow cross-fade as the ocean gradient rises up from the bottom of
the frame and bubbles start.

**Narration.**

> This is a citizen stream observation. Someone stood in a river to record it. It means nothing
> to them, little to the council officer who receives it, and nothing at all to the public health
> team who never sees it. Citizen science solved collection. It never solved interpretation.

**Data.** None — the row is illustrative. (Do not pull a real row: a real row with a real site name
makes the first ten seconds about a specific stream instead of about the problem.)

### 2 · Meet Drip — 0:20–0:50

**On screen.** Explorer home, **live embed** (iframe of the running dashboard at `/`, Explorer
mode). The hero: headline, Drip, speech bubble.

**Animates.** Player fades the embed in. Then an overlay "hand" cursor (an SVG, not a real cursor)
scrolls the embed to _Meet the streams_ and hovers the worst stream's card so Drip's face is
visible large. Overlay callouts appear beside three things: the face, the stars, the colour pill.

**Narration.**

> Neer gives every stream a health score out of a hundred, a colour, and a face. The colours are
> the Water Framework Directive's own — the ones on every river map in Europe — and the face means
> a child who can't read the label yet still knows how the stream is feeling. Twelve streams around
> Coimbra, a real OneAquaHealth pilot city, ranked worst first.

**Data.** Live: the number of streams and how many need help are read from `sites.json` / the API
and interpolated into the caption (`{siteCount}`, `{needHelpCount}`), so the narration can never
disagree with what the embed shows.

### 3 · Tea with milk — 0:50–1:20

**On screen.** Live embed of the worst stream's story page. The comparison cards.

**Animates.** Cards enter one at a time. On the _water clarity_ card the overlay draws a bracket
from the plain-language line down to the real measurement underneath, and holds.

**Narration.**

> "Turbidity 32 NTU" becomes "about as cloudy as tea with milk". Oxygen becomes "like a stuffy,
> crowded bus". Every comparison is driven by the real measurement — never by the score — and the
> real number is printed underneath it. If nobody measured something, the card says so. It does
> not guess.

**Data.** Live: `measurements.json` / `GET /api/measurements`. The caption's "32 NTU" is
interpolated from the actual value. ⏳ The worst stream is chosen at play time, so if the seed
changes, the scene still tells the truth.

### 4 · The map is a game — 1:20–1:45

**On screen.** Live embed, scrolled to the game map.

**Animates.** Scripted interaction _inside the embed_ via `postMessage` (see _Technical design_):
select the Litter sticker, drop a mark near the culverted reach, toast fires, XP bar moves. Then
the overlay circles the pulsing pin.

**Narration.**

> The map is a game board. Rivers glow. Pins pulse when a stream needs help. Seen litter, foam,
> a fish? Pick a sticker and tap. Marks are a child's own notebook — saved on the device, never
> sent anywhere, and never mixed into the science.

**Data.** Live. ⏳ Depends on the marking feature's final shape; the scripted interaction is the
one part of the player that must be updated if the sticker set or HUD changes.

### 5 · One tap to tell the story — 1:45–2:05

**On screen.** Live embed: the share modal opens on the same stream; the generated card fills the
left half.

**Animates.** Overlay zooms the card to full frame for four seconds, then a callout lands on the
**DEMO DATA** band.

**Narration.**

> One tap makes a post — the card, the caption, straight into the phone's share sheet. And look at
> the bottom of the card. These are real rivers and this is demo data, so the label is drawn into
> the image itself. A caption can be deleted when a picture is reposted. Pixels can't.

**Data.** Live card render.

### 6 · Same stream, scientist's view — 2:05–2:35

**On screen.** Overlay clicks _Scientist_ in the embed's masthead. Same stream, now the analytical
page: stat tiles, trend with ribbon, decomposition, confidence breakdown.

**Animates.** The overlay hand hovers along the trend so the crosshair tooltip walks the year.
Then it drags a bracket across a wide stretch of ribbon and a narrow stretch, labelled _few
visits_ and _many visits_.

**Narration.**

> Same stream, same score, second front door. The band is the credible interval — it widens where
> volunteers visited less. Confidence is reported piece by piece, because "sixty percent" tells a
> coordinator nothing, while "two novice observers, no oxygen reading in nine days" is a to-do
> list. Uncertainty becomes the most useful output: it says where the next visit is worth most.

**Data.** Live: confidence and band width for the stream are interpolated.

### 7 · 62 versus 41 — 2:35–2:55

**On screen.** Not an embed. A built scene: two large tiles side by side, both starting at three
sub-index gauges (ecology 85, pressure 80, exposure 10).

**Animates.** Left tile: the three values slide together into an average — **62**, and the tile
turns green, labelled _"Good"_. Right tile: the same three multiply into **41**, the tile turns
yellow, labelled _Moderate — limited by exposure_. The left tile's "Good" gets a slow red
strikethrough.

**Narration.**

> The decision everything rests on. Intact ecology, low litter, and an active sewage discharge.
> Average those and you get sixty-two — "Good". That is not a defensible thing to say about water
> children paddle in. Neer uses a geometric mean: forty-one, Moderate, with the reason named. One
> catastrophic thing cannot be hidden by two fine ones.

**Data.** Fixed illustrative numbers — the same worked example as the Method page and the README.

### 8 · How it works — the pipeline — 2:55–3:35

**On screen.** The animated architecture diagram (see below). Full frame.

**Animates.** Nodes light up in order as the narration reaches them, and a "packet" travels the
edges: weather + observation → ClickHouse → scorer → back to ClickHouse → API → dashboard. The
BigQuery node stays dim and dashed, labelled _dormant_.

**Narration.**

> Real weather from Open-Meteo — fifty-seven thousand hourly readings — and citizen observations
> land in ClickHouse. Materialised views keep daily aggregates ready, and an ASOF join pins every
> observation to the weather at the moment it was taken — so "oxygen crashed" becomes "oxygen
> crashed forty-eight hours after forty millimetres of rain on a combined sewer". A pure
> TypeScript scorer reads the rollups, computes the index, runs nine deterministic One Health
> rules, and writes back. A NestJS API serves it. The BigQuery ML tier is real code, switched off,
> so this runs for anyone with no cloud account.

**Data.** Counts (57,312 readings; 1,515 observations; 62 findings) interpolated from the export
manifest so they stay true after a re-seed.

### 9 · Why you can trust it — 3:35–4:00

**On screen.** Three short built panels, entering in sequence.

1. A terminal panel: `pnpm test` output, `87 passed`, with one test name highlighted —
   _does not let healthy sub-indices mask a catastrophic one_.
2. A threshold panel: a line of code with its provenance tag `standard` / `derived` / `modelled`,
   and the source it cites.
3. The Method page's _What this system cannot do_ list, live embed, scrolled into view.

**Narration.**

> Eighty-seven tests, including the one that asserts the sixty-two-versus-forty-one story. Every
> threshold is tagged with where it came from — a directive, a derivation, or our own construct —
> and the type system won't let one exist without a tag. And the product says what it cannot do:
> it doesn't measure pathogens, it isn't validated against field data yet, and the observations
> here are simulated.

**Data.** The test count is read from a small `build-info.json` written at build time (⏳ add to
the export step), so the number cannot go stale.

### 10 · Close — 4:00–4:15

**On screen.** Ocean gradient, Drip large and happy, the wordmark, one line.

**Animates.** Bubbles. The line fades in: _Every stream has a story. Now everyone can read it._
Then the repository URL and `#OneAquaHealth`.

**Narration.**

> A tool that makes statements next to public health earns trust by naming its limits — not by
> projecting past them. Neer. Healthy streams, healthy us.

---

## The animated architecture diagram

Built as inline SVG so it animates with CSS and stays crisp at any size. Also reusable on its own
in the README, the Method page and slides.

```
 ┌──────────────┐    ┌──────────────┐
 │  Open-Meteo  │    │   Citizen    │
 │  real weather│    │ observations │
 └──────┬───────┘    └──────┬───────┘
        └────────┬──────────┘
                 ▼
        ┌────────────────────┐
        │     ClickHouse     │  hot path
        │  raw → MVs → daily │  ASOF JOIN obs↔weather
        └───────┬─────▲──────┘
                │     │ writes back
                ▼     │
        ┌────────────────────┐
        │  @neer/scoring +   │  pure TypeScript
        │  @neer/insights    │  index · confidence · 9 rules
        └───────┬────────────┘
                ▼
        ┌────────────────────┐        ┌────────────────────┐
        │     NestJS API     │        │   BigQuery ML      │  cold path
        │  read-only, Zod    │        │   dormant          │  ARIMA_PLUS · K-means
        └───────┬────────────┘        └────────────────────┘
                ▼
        ┌────────────────────┐
        │  React dashboard   │  Explorer · Scientist
        │  live or static    │  same data, two front doors
        └────────────────────┘
```

Animation order matches the narration in scene 8. Each node gets a one-line tooltip on hover in
present mode, so a judge can ask "what's an ASOF join?" and the answer is under the cursor.

---

## Technical design

**One page, no build step of its own.** `apps/pitch/index.html` + `pitch.css` + `pitch.js`, plain
HTML/CSS/JS. It reads `../web/dist` at deploy time (the same static export) and iframes the
dashboard. No framework: a player with ten scenes does not need one, and a plain file is the
thing most likely to still open in five years.

**Scene engine.** A JSON array of scenes: `{ id, duration, narration, steps: [...] }`. The player
advances a clock; each step is `{ at, action }` where action is one of `showEmbed`, `overlay`,
`callout`, `typewriter`, `scrollEmbed`, `embedCommand`, `counter`. Deterministic: the same clock
always produces the same frame, which is what makes a single screen-recording take sufficient.

**Driving the embed.** The dashboard gains a tiny, opt-in `postMessage` listener (only active when
loaded with `?presenter=1`) that accepts a fixed allow-list of commands: `openSite`, `setMode`,
`selectSticker`, `dropMark`, `openShare`, `scrollTo`. The allow-list is the security boundary —
the listener checks `event.origin` against its own origin and ignores everything else. ⏳ This is
the one addition the dashboard needs; it is small and isolated.

**Captions.** Every narration line renders as a caption at the bottom of the frame, synced to the
clock. This is what makes the piece work with the sound off — which is how most judges will first
watch it — and what makes it accessible.

**Live numbers.** A `data.js` loaded before the player fetches `sites.json`, `measurements.json`,
`findings.json` and `manifest.json` and exposes them to the narration templates (`{siteCount}`,
`{worstName}`, `{worstTurbidity}`, `{findingCount}`). If the fetch fails, templates fall back to
the numbers in this document, and a small badge says _fallback figures_ so nobody reads a stale
number as live.

**Recording to MP4.** Open the player in Chrome at 1920×1080, press _present_, press play, record
with OBS or the built-in screen recorder, stop at the final frame. Trim nothing — the player
starts and ends on black. Target ≤ 60 MB.

**Reduced motion.** The player honours `prefers-reduced-motion`: transitions become cuts, the
packet animation in the diagram becomes a static highlighted path.

---

## Assets to prepare

| Asset                                            | Source                                                  | Status    |
| ------------------------------------------------ | ------------------------------------------------------- | --------- |
| Ocean theme, Drip, fonts                         | Already in `apps/web` — reused                          | ✅        |
| Architecture SVG                                 | New, hand-drawn to match the theme                      | to do     |
| Overlay hand cursor + callout components         | New, small                                              | to do     |
| `build-info.json` (test count, commit, date)     | Add to `pnpm export:demo`                               | to do ⏳  |
| `?presenter=1` command listener in the dashboard | New, allow-listed                                       | to do ⏳  |
| Voice-over                                       | Record narration as written, or use captions only       | to decide |
| Music                                            | Optional, low, ocean ambience; must not fight the voice | to decide |

---

## Open decisions

1. **Voice-over or captions only?** Captions are required regardless. A recorded voice makes the
   MP4 stronger; captions-only makes the live pitch calmer. Recommendation: record the voice for
   the MP4, mute it for live presenting.
2. **Which stream is "the" stream?** The player chooses the worst-scoring site at play time. If the
   seed changes and a different site becomes worst, every scene still follows — but the narration
   in scene 3 should not name a river, so it never needs re-recording.
3. **Portuguese captions?** Coimbra is the pilot city and OneAquaHealth is coordinated there. A
   caption-language toggle is cheap once captions are data. Worth doing if time allows.

## Not in scope

- Rendering the video server-side. Screen recording the deterministic player is simpler and
  produces exactly what a judge would see in the browser.
- Any narration about the BigQuery tier beyond "real code, switched off". It has not been trained,
  and the video must not imply it has.
