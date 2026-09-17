# The Stream One Health Index — methodology

Every number in this document is tagged by provenance. The tags are enforced in the source
(`packages/scoring/src/provenance.ts`), not merely written here.

| Tag          | Meaning                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **standard** | Taken verbatim from a legal instrument, standard, or peer-reviewed index definition. Not ours; must not be silently changed.                 |
| **derived**  | Arithmetically derived from a `standard` value — a unit conversion, a percentile restatement, an interpolation between published boundaries. |
| **modelled** | Our own construct. Documented and defensible, but not backed by a published boundary. Every one is a calibration target.                     |

A reader has no way to distinguish a legally binding limit from something an author invented on a
Tuesday unless the code says which is which. That is why the type system refuses to let a threshold
exist without a tag.

---

## 1. Composition

```
SOHI = 100 × (E/100)^0.45 × (H/100)^0.30 × (P/100)^0.25
```

| Sub-index                      | Weight | Direction                             |
| ------------------------------ | ------ | ------------------------------------- |
| **E** — ecological integrity   | 0.45   | higher is better                      |
| **H** — health exposure        | 0.30   | inverted: higher means lower risk     |
| **P** — anthropogenic pressure | 0.25   | inverted: higher means lower pressure |

All three point the same way so they compose without sign bookkeeping.

**Weights are `modelled`.** They are a judgement, not a published standard, and they are exposed as
constants and documented here precisely so they can be argued with. No composite environmental index
has objectively correct weights. The reasoning: ecology carries most because an invertebrate
community integrates months of conditions rather than the morning it was sampled; exposure outweighs
pressure because this is a One Health index, and where the two diverge the realised risk to people
and animals matters more than the pressure that produced it.

### Why geometric, not arithmetic

The single most consequential decision in the model.

| Scores               | Arithmetic      | Geometric                              |
| -------------------- | --------------- | -------------------------------------- |
| E 85, P 80, **H 10** | **62 — "Good"** | **41 — Moderate, limited by exposure** |

A reach with intact ecology and low litter but an active sewage discharge is not "Good", and
publishing that about water people let their children paddle in is indefensible. Geometric
aggregation makes any sub-index approaching zero pull the composite toward zero.

This is the behaviour the WFD's _one out, all out_ rule encodes, **without that rule's
brittleness**. UKTAG warns explicitly that OOAO amplifies measurement error — "monitoring results
for only one quality element need to wrongly suggest an adverse impact in order for the water body
to be assigned a lower class" — and that the risk rises with the number of elements assessed. With
ordinal, kit-derived citizen data that effect would be severe. The geometric mean degrades smoothly
instead of snapping, which is the right property for noisy data.

Sub-indices are floored at 1 before aggregation. A true zero would take the logarithm to negative
infinity and discard every other measurement; the floor preserves dominance while keeping the
arithmetic finite. `modelled`.

### Status classes

Five equal 20-point bands on the 0–100 scale, named for the WFD classes: **bad / poor / moderate /
good / high**. `derived`.

The evenness is legitimate here where it would not be on a raw EQR scale: the ecological sub-index
has already mapped the _unevenly spaced_ WHPT EQR boundaries onto equal output bands, so each
20-point span already corresponds to its true, unequal span of ecological quality.

---

## 2. E — Ecological integrity

### The WFD element asymmetry

Biological and physico-chemical elements are **not interchangeable**. Reading the Annex V
classification flowchart:

- Biology alone determines Moderate, Poor and Bad. Physico-chemistry cannot push below Good on its own.
- Physico-chemistry can _prevent_ High status, and through OOAO can cap at Moderate — but cannot
  reach into Poor or Bad.
- Hydromorphology only ever distinguishes High from Good.

Neer encodes this ordering (`standard`, UKTAG 2009):

| Condition                              | Result                                                               |
| -------------------------------------- | -------------------------------------------------------------------- |
| Biology + chemistry present            | Biology leads; chemistry acts as a ceiling only                      |
| CCME WQI < 45 ("Poor")                 | Caps E at 60 regardless of biology                                   |
| CCME WQI < 80, biology would exceed 80 | Caps E at 80 — chemistry prevents High                               |
| No biological survey                   | E bounded to 60–78. Cannot establish High; cannot assert Poor or Bad |
| Neither                                | E = 0, reported as "no data"                                         |

A naive weighted average reports the opposite in both directions: it lets clean chemistry rescue a
collapsed community, and lets a site with no survey at all be called pristine.

### Physico-chemistry: CCME WQI 1.0 — `standard`

Source: [CCME WQI User's Manual](https://ccme.ca/en/res/wqimanualen.pdf).

```
F1 = (failed variables / total variables) × 100          scope
F2 = (failed tests / total tests) × 100                  frequency
excursion = (value / objective) − 1        when value must not exceed
excursion = (objective / value) − 1        when value must not fall below
nse = Σ excursion / total tests
F3  = nse / (0.01 × nse + 0.01)                          amplitude
WQI = 100 − √(F1² + F2² + F3²) / 1.732
```

Chosen over NSF WQI for two decisive reasons: NSF requires nine fixed parameters including
laboratory BOD₅ and faecal coliform, which no volunteer can produce; and its sub-index transfer
functions are graphical Delphi curves with no published equations, so every implementation digitises
them differently and no two NSF scores are comparable.

CCME needs only a guideline value per parameter. A site measuring four parameters and one measuring
twelve are scored by the same published method, and the guideline set swaps per water body type
without touching code — which is exactly what the WFD's type-specific reference conditions demand.

**Two Neer additions, both flagged rather than passed off as CCME:**

- `direction: 'range'` for pH, which is meaningfully bad in both directions. The excursion is
  computed against whichever bound was crossed, using the manual's own one-sided formula, so the
  arithmetic stays CCME's even though the parameter handling is ours.
- A cap of 100 on any single excursion. Without it one decimal-slip transcription error (14.0 NTU
  entered as 1400) drives F3 to ~100 alone and collapses the index for that window.

**An empty window returns WQI 0, not 100.** Returning 100 would paint an unmonitored stream as
pristine on a public map — the exact failure this project exists to correct. Absence is carried by
the confidence model, not by the index.

### Default guideline objectives

These are the calibration surface. **Only the faecal indicators are legally binding; the
physico-chemical guidelines are `modelled`** — they sit in the range used for good ecological status
in temperate lowland rivers, but the WFD sets them per Member State and per water body type and no
single European number exists to cite.

| Parameter         | Objective    | Direction | Tag        | Note                                                                                                                         |
| ----------------- | ------------ | --------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Dissolved oxygen  | 6 mg/L       | min       | `modelled` | Salmonid waters demand substantially more                                                                                    |
| pH                | 6–9          | range     | `modelled` | Naturally acidic peat-fed and alkaline karst streams fall outside without being degraded                                     |
| Nitrate           | 25 mg NO₃/L  | max       | `modelled` | Half the 50 mg/L drinking-water limit; ecological standards are typically stricter                                           |
| Orthophosphate    | 0.4 mg PO₄/L | max       | `modelled` | ≈0.13 mg P/L. Usually the limiting nutrient, so the most calibration-sensitive value in the set                              |
| Ammonium          | 0.4 mg NH₄/L | max       | `modelled` | Strongest single chemical predictor of IBMWP in Iberian data (β = −0.322)                                                    |
| Turbidity         | 25 NTU       | max       | `modelled` | Chosen inside the Secchi-tube detection range (~12–240 NTU) so the guideline is measurable by the instrument volunteers hold |
| Conductivity      | 1000 µS/cm   | max       | `modelled` | Strongly geology-dependent; a site-specific reference is preferable where one exists                                         |
| Water temperature | 25 °C        | max       | `modelled` | Thermal-stress threshold where oxygen solubility loss compounds organic loading                                              |

**Anyone deploying Neer on real streams must replace this profile with their competent authority's
standards.** The UI marks any score leaning on a `modelled` guideline.

### Biology: ASPT against WHPT EQR boundaries

**ASPT, not BMWP total.** BMWP sums tolerance scores across families present, so it rises with taxon
count, which rises with how long and how well someone sampled. Volunteer effort is precisely the
variable that is _not_ standardised in citizen science. ASPT divides by scoring taxa, removing
richness — and therefore effort — from the numerator.

**EQR, not raw score bands.** The widely circulated BMWP class boundaries ("> 100 very good, 51–100
good…") could not be traced to any authoritative source, and the UK abandoned raw BMWP
classification in favour of WHPT with site-specific RIVPACS-predicted references. Rather than
hard-code folklore, scores are expressed as an EQR and classified on verified boundaries.

**Class boundaries — `standard`, UKTAG Annex 4 (WHPT-ASPT):**

| Boundary        | EQR   | → score |
| --------------- | ----- | ------- |
| High / Good     | 0.969 | 80      |
| Good / Moderate | 0.860 | 60      |
| Moderate / Poor | 0.723 | 40      |
| Poor / Bad      | 0.585 | 20      |

**These are deliberately not evenly spaced.** The High/Good cut sits within 3% of reference
condition. Using the 0.8 / 0.6 / 0.4 / 0.2 bands an implementer would naturally reach for would
classify genuinely degraded streams as Good — the single most consequential calibration error
available in this domain. There is a test asserting an EQR of 0.9 classifies as Good and not High.

**Taxon scores** are BMWP family values (`standard` where the field group maps to one family,
`derived` where it spans several). Groups spanning families with different published scores take a
conservative value: being wrong toward "less pristine" is the safer error for a public-health-adjacent
index.

**Reference ASPT is a single modelled constant (6.0).** Real WFD practice derives it per site from
RIVPACS/RICT using 43 predictive end-groups. Neer does not implement that, and this is a genuine
limitation rather than a simplification — though using a pristine-stream reference instead would
classify every urban site as Bad and destroy the index's ability to discriminate among them.

**Tolerant dominance.** BMWP and ASPT are presence/absence measures by definition, so a reach where
one stonefly clings on among ten thousand bloodworm scores identically to a balanced assemblage.
Neer computes the abundance share of tolerant taxa (BMWP ≤ 3) separately and surfaces it as a
finding, recovering signal ASPT structurally discards.

---

## 3. P — Anthropogenic pressure

Weighted mean of components, inverted so high means low pressure.

| Component                 | Weight | Basis                                            |
| ------------------------- | ------ | ------------------------------------------------ |
| Riparian condition (QBR)  | 0.30   | `standard`                                       |
| Foam / films / discharges | 0.25   | `modelled` — worst of the three                  |
| Litter                    | 0.20   | `modelled` — linear inversion of the 0–3 ordinal |
| Catchment sealing         | 0.15   | `modelled`                                       |
| Outfall density           | 0.10   | `modelled`, saturating at five                   |
| Invasive alien plants     | 0.10   | `modelled` — OneAquaHealth indicator XI          |

### QBR — `standard` (Munné, Solà & Prat, 1998)

Implemented in full: four blocks, each clamped 0–25, summed to 0–100. **The per-block clamp is
load-bearing** — without it, generous modifiers in one block would compensate for another's
collapse, which is exactly what the four-block structure exists to prevent.

Class boundaries: ≥95 natural · ≥75 good · ≥55 fair · ≥30 bad · else very bad. The gaps in the
published bands (91–94, 71–74…) are not errors: QBR scores are always multiples of 5, so those
values are unreachable by construction.

QBR carries the heaviest weight on the evidence. It is the strongest single predictor of
invertebrate community quality in the Iberian reference data (β = 0.342, r = 0.705 against IBMWP) —
stronger than ammonium, conductivity or habitat structure — and it needs no taxonomy beyond telling
a native tree from an introduced one. A volunteer who can only do one thing well should do this one.

Where full QBR field data is absent, a coarse 0–3 riparian ordinal maps to band midpoints. This is
an explicit degradation, tagged `modelled`, and any score using it is marked lower-confidence rather
than presented as a QBR result.

### Acute pollution signals

Foam, surface film and visible discharge are combined as a maximum rather than summed, because they
are alternative symptoms of the same underlying event — scoring them separately would triple-count
one incident.

---

## 4. H — Health exposure

**Everything here is a risk proxy, never a measurement.** Faecal indicators, cyanotoxins, pathogens
and resistance genes are all laboratory measurements. What volunteers _can_ observe — sewage odour,
visible discharge, scum, stagnation, litter, clarity, outfall pipes — are the field-observable
correlates, and this is what the module scores.

The distinction is not pedantry. Asserting a measured pathogen level from a turbidity reading would
either trigger an unwarranted closure or manufacture false reassurance about a hazard nobody tested
for.

| Component            | Anchor                                                      | Tag                                 |
| -------------------- | ----------------------------------------------------------- | ----------------------------------- |
| Faecal contamination | Bathing Water Directive 2006/7/EC inland limits             | `modelled` proxy, `standard` anchor |
| Cyanobacterial bloom | WHO 2021 Alert Level Framework                              | `derived`                           |
| Mosquito vector      | ECDC / Culex thermal competence 14–34.3 °C, optimum 23.7 °C | `derived`                           |
| AMR pressure         | Recast UWWTD Article 17                                     | `derived`                           |

### Faecal contamination

Mechanism: first flush. A combined sewer carries foul and storm water in one pipe, so a storm
exceeding capacity spills untreated sewage. Risk concentrates in the first hours of a storm
_following a dry spell_, because the dry period accumulates the load the rain then mobilises. That
interaction — rain **after** drought — is the signal, which is why antecedent dry days are weighted
rather than rainfall alone.

**Bathing Water Directive values (`standard`, inland):**

| Parameter              | Excellent | Good | Sufficient |
| ---------------------- | --------- | ---- | ---------- |
| Intestinal enterococci | 200       | 400  | 330        |
| _E. coli_              | 500       | 1000 | 900        |

_cfu/100 ml. Excellent and Good are 95th-percentile; Sufficient is 90th-percentile._

**Two traps, both load-bearing.** "Sufficient" is numerically _lower_ than "Good" because it is
evaluated at a different percentile — they are not points on one monotonic scale, and a naive
`if (value < x)` ladder misclassifies. And a Directive class is defined over a dataset of at least
16 samples across four bathing seasons; a single measurement has no Directive class. **Neer never
claims one.**

### Cyanobacterial bloom

WHO Alert Level 2 triggers on **visible surface scum** or **transparency below 0.5–1 m** — the one
health hazard in the set where citizen observation maps directly onto an international guideline
rather than a proxy for one, and it maps cleanly onto the Secchi tube and photo reference cards
volunteer programmes already use.

WHO also warns that clear, low-biomass water can carry toxic benthic cyanobacterial mats on
sediments and submerged plants. Absence of a visible bloom is not evidence of absent risk, so this
component never scores a clean zero on visual grounds alone.

### Combination

Components combine by **soft maximum** — 75% worst-case, 25% mean — then scale by exposure
potential. Averaging would let three quiet hazards dilute one acute one: a stream with an active
sewage spill would score as mildly concerning because its bloom and vector risks happen to be low,
inverting the priority any health officer would assign. `modelled`.

**Exposure potential** floors at 0.15 rather than 0. A hazard nobody is exposed to is not a health
risk, but "no recorded public access" is a statement about records, not about dogs, children or
wildlife — and downstream users inherit what happens upstream.

---

## 5. Confidence

Every constant here is `modelled`. There is no published standard for confidence in citizen-science
water data, and pretending otherwise would be the exact failure this package is built to avoid.

| Component            | Weight | Model                                                   |
| -------------------- | ------ | ------------------------------------------------------- |
| Completeness         | 0.25   | Parameters measured ÷ expected, × 0.75 if no biology    |
| Density              | 0.20   | Observations ÷ 4 per 14-day window                      |
| Recency              | 0.25   | Exponential decay, 10-day half-life                     |
| Observer reliability | 0.15   | novice 0.6 · trained 0.85 · expert 1.0 · instrument 1.0 |
| Agreement            | 0.15   | 1 − (CV ÷ 0.5) between observers on the same day        |

Combined by weighted geometric mean, for the same reason the headline index is: data three months
stale is untrustworthy however complete, and an arithmetic mean would hide that behind four healthy
components.

**A lone observer scores 0.7 agreement, not 1.0.** Scoring a single observation as perfect agreement
would reward thin data with maximum confidence — exactly backwards. It is not penalised as
disagreement, but neither is it credited as corroboration.

**Novices are down-weighted, not excluded.** Excluding them would discard most citizen-science data
and defeat the purpose of collecting it. The evidence from established programmes is that novice
observations carry real signal with wider error — which is what a weight expresses and an exclusion
cannot.

### Credible interval

```
half-width = (1 − confidence) × 30 index points
```

**This is not a statistical confidence interval.** It is a communicated-uncertainty band: the error
distribution of citizen measurements is not characterised, so a formal interval would be a fiction
with decimal places. At zero confidence the band spans ±30 — wide enough to cross two status
classes, which is the honest representation of knowing almost nothing. Deliberately not ±50: a band
spanning the whole scale conveys nothing and invites readers to ignore bands entirely.

---

## 6. What would make this defensible on real streams

In priority order:

1. **Replace the modelled physico-chemical guidelines** with the deploying authority's standards.
2. **Implement site-specific reference conditions** — RIVPACS/RICT or a national equivalent —
   replacing the single reference ASPT constant.
3. **Validate against paired sampling.** Run citizen and professional protocols at the same sites
   across a season and measure agreement. Until this exists, the index is internally consistent but
   externally unvalidated, and the README says so.
4. **Ingest ordinal nutrient bands natively**, as real test kits produce, rather than continuous values.
5. **Calibrate the sub-index weights** against expert judgement or measured health outcomes, rather
   than leaving them as a documented assertion.

---

## Sources

- CCME Water Quality Index 1.0 User's Manual — <https://ccme.ca/en/res/wqimanualen.pdf>
- UKTAG (2009), Recommendations on Surface Water Status Classification
- UKTAG Annex 4, Rivers Invertebrates WHPT — EQR class boundaries
- Munné, Solà & Prat (1998), QBR riparian quality index protocol
- Alba-Tercedor et al. (2002), _Limnetica_ 21(2):175 — IBMWP boundaries and covariates
- EU Bathing Water Directive 2006/7/EC, Annex I — CELEX:32006L0007
- WHO (2021), Guidelines on Recreational Water Quality, Vol. 1
- ECDC West Nile virus factsheet; Culex thermal competence
- Recast Urban Wastewater Treatment Directive, Article 17
- OneAquaHealth Key Indicators factsheets — [10.5281/zenodo.20345207](https://doi.org/10.5281/zenodo.20345207)
- OneAquaHealth Field Sampling Protocols — [10.5281/zenodo.20344421](https://doi.org/10.5281/zenodo.20344421)
