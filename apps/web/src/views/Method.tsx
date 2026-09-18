import { REPO_URL, SETUP_COMMAND } from '../lib/links';

/**
 * The method page.
 *
 * An environmental index that cannot be interrogated is an assertion, and this
 * page exists so that Neer's can be. It states what each number is built from,
 * which thresholds come from published standards and which are our own
 * construct, and — at the end, unhedged — what the system cannot do.
 *
 * The limitations section is deliberately not a footnote. A tool that makes
 * statements adjacent to public health earns trust by being explicit about its
 * boundaries, not by projecting confidence past them.
 */

const SUB_INDICES = [
  {
    letter: 'E',
    name: 'Ecological integrity',
    color: 'var(--series-ecological)',
    weight: '45%',
    built:
      'CCME Water Quality Index 1.0 over the physico-chemical parameters, plus ASPT from citizen-identifiable invertebrate groups, expressed as an Ecological Quality Ratio.',
    why: 'Weighted highest because an invertebrate community integrates months of conditions. It records what a stream has been through, not what the weather was doing on the morning somebody sampled it.',
  },
  {
    letter: 'P',
    name: 'Anthropogenic pressure',
    color: 'var(--series-pressure)',
    weight: '25%',
    built:
      'QBR riparian quality index, litter, foam and surface films, visible discharges, catchment sealing, outfall count, invasive riparian plants.',
    why: 'This is where volunteer data beats professional monitoring rather than approximating it. A quarterly official survey cannot see a Tuesday foam event; a resident walking a dog can.',
  },
  {
    letter: 'H',
    name: 'Health exposure',
    color: 'var(--series-exposure)',
    weight: '30%',
    built:
      'Field-observable risk proxies for faecal contamination, cyanobacterial blooms, mosquito vector habitat and antimicrobial resistance pressure, scaled by how much human and animal contact actually occurs.',
    why: 'Outweighs pressure because this is a One Health index. Where the two diverge, the realised risk to people and animals matters more than the pressure that produced it.',
  },
];

const STANDARDS = [
  {
    name: 'CCME Water Quality Index 1.0',
    use: 'Physico-chemical scoring',
    note: 'Chosen over the more familiar NSF WQI, which needs laboratory BOD₅ and faecal coliform — neither obtainable by a volunteer — and whose sub-index curves are graphical, so no two implementations agree.',
  },
  {
    name: 'UKTAG WHPT-ASPT EQR boundaries',
    use: 'Biological class boundaries',
    note: '0.969 / 0.860 / 0.723 / 0.585. Deliberately not evenly spaced: the High/Good cut sits within 3% of reference condition, and using even 0.2 bands would classify genuinely degraded streams as Good.',
  },
  {
    name: 'QBR (Munné, Solà & Prat, 1998)',
    use: 'Riparian quality',
    note: 'The strongest single predictor of invertebrate community quality in the Iberian reference data, and it needs no taxonomy — the highest-value observation a trained volunteer can contribute.',
  },
  {
    name: 'EU Bathing Water Directive 2006/7/EC',
    use: 'Faecal risk anchor',
    note: 'Inland limits of 500 cfu/100 ml E. coli and 200 cfu/100 ml intestinal enterococci. Neer cannot measure these and never claims a Directive class — the Directive defines one over at least 16 samples across four seasons.',
  },
  {
    name: 'WHO (2021) Recreational Water Quality',
    use: 'Cyanobacteria alert levels',
    note: 'Alert Level 2 triggers on visible scum or transparency below 0.5–1 m — the one health hazard here a volunteer can assess against an international guideline rather than a proxy for one.',
  },
  {
    name: 'ECDC / Culex thermal competence',
    use: 'Vector risk',
    note: 'West Nile virus establishment envelope of 14–34.3 °C, optimum near 23.7 °C. Transmission is demonstrated from 18 °C, so temperate sites are not treated as exempt.',
  },
  {
    name: 'Recast UWWTD, Article 17',
    use: 'AMR pressure',
    note: 'Makes wastewater AMR surveillance a legal requirement for agglomerations of 100,000 population equivalents and above, which turns outfall connectivity into a reporting concern rather than an academic one.',
  },
  {
    name: 'OneAquaHealth key indicators',
    use: 'Framework alignment',
    note: 'DOI 10.5281/zenodo.20345207. The project publishes eleven key indicators but no composite index with cut-offs — the aggregation here is ours, layered on their indicator set.',
  },
];

export function Method() {
  return (
    <div style={{ maxWidth: 820, marginTop: 22 }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>How the index works</h1>
      <p className="secondary" style={{ fontSize: 14, lineHeight: 1.6, marginTop: 0 }}>
        The Stream One Health Index is a 0–100 composite of three sub-indices. Every threshold
        behind it is tagged in the source with where it came from — a published standard, a value
        derived from one, or our own modelled construct — and that tag is enforced by the type
        system rather than left to documentation discipline.
      </p>

      <section style={{ marginTop: 22 }}>
        <div className="card" style={{ padding: 20, borderColor: 'var(--glow)' }}>
          <h2 style={{ fontSize: 20 }}>The short version, for explorers</h2>
          <ul style={{ fontSize: 15, lineHeight: 1.7, margin: '10px 0 0', paddingLeft: 22 }}>
            <li>
              Every stream gets a <strong>health score out of 100</strong>, a colour, and a face —
              like a check-up at the doctor.
            </li>
            <li>
              The score looks at three things: <strong>the water and its creatures</strong>,{' '}
              <strong>the mess people leave</strong>, and <strong>whether it is safe</strong> for
              people and pets.
            </li>
            <li>
              If just one of those is really bad, the whole score drops. A stream with lovely bugs
              but sewage in it is <em>not</em> a healthy stream.
            </li>
            <li>
              The comparisons — “as cloudy as tea with milk” — always come from a real measurement,
              and the real number is shown underneath. If nobody measured it, we say so. We never
              guess.
            </li>
            <li>
              The Coimbra check-ups are a sample dataset made by a computer model over real weather.
              The English rivers marked “Real sensor” are measured by real instruments.
            </li>
          </ul>
        </div>
      </section>

      <section style={{ marginTop: 26 }}>
        <h2 style={{ fontSize: 17, marginBottom: 12 }}>The three sub-indices</h2>
        {SUB_INDICES.map((sub) => (
          <div className="card" key={sub.letter} style={{ padding: 16, marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 7,
                  background: sub.color,
                  color: '#fff',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 700,
                  fontSize: 14,
                  flex: 'none',
                }}
                aria-hidden="true"
              >
                {sub.letter}
              </div>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ fontSize: 14.5 }}>
                  {sub.name}{' '}
                  <span className="muted" style={{ fontWeight: 400, fontSize: 12.5 }}>
                    · weight {sub.weight}
                  </span>
                </h3>
                <p className="card-sub" style={{ marginTop: 6 }}>
                  <strong>Built from:</strong> {sub.built}
                </p>
                <p className="card-sub" style={{ marginTop: 5 }}>
                  <strong>Why this weight:</strong> {sub.why}
                </p>
              </div>
            </div>
          </div>
        ))}
      </section>

      <section style={{ marginTop: 26 }}>
        <h2 style={{ fontSize: 17, marginBottom: 8 }}>Why a geometric mean</h2>
        <div className="card" style={{ padding: 18 }}>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.62 }}>
            This is the single most consequential decision in the model. Consider a reach with
            intact ecology (85) and low litter (80) whose exposure sub-index has collapsed to 10
            because of an active sewage discharge.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              margin: '14px 0',
            }}
          >
            <div
              style={{
                padding: 13,
                borderRadius: 8,
                background: 'var(--surface-sunken)',
                border: '1px solid var(--border)',
              }}
            >
              <div className="tile-label">Arithmetic mean</div>
              <div className="tile-value tnum" style={{ fontSize: 26 }}>
                62
              </div>
              <div className="tile-note">Reported as “Good”</div>
            </div>
            <div
              style={{
                padding: 13,
                borderRadius: 8,
                background: 'var(--surface-sunken)',
                border: '1px solid var(--border)',
              }}
            >
              <div className="tile-label">Geometric mean (used here)</div>
              <div className="tile-value tnum" style={{ fontSize: 26 }}>
                41
              </div>
              <div className="tile-note">Moderate, limited by exposure</div>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.62 }}>
            “Good” is not a defensible thing to publish about water people let their children paddle
            in. Geometric aggregation makes any sub-index approaching zero pull the composite toward
            zero — the behaviour the Water Framework Directive's “one out, all out” rule encodes,
            without that rule's brittleness. UKTAG warns that strict one-out-all-out amplifies
            measurement error as the number of elements grows, which would be severe with ordinal
            citizen data, so the geometric mean degrades smoothly instead of snapping.
          </p>
        </div>
      </section>

      <section style={{ marginTop: 26 }}>
        <h2 style={{ fontSize: 17, marginBottom: 8 }}>Biology leads, chemistry caps</h2>
        <div className="card" style={{ padding: 18 }}>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.62 }}>
            Under the Water Framework Directive, biological and physico-chemical elements are not
            interchangeable, and Neer encodes that asymmetry rather than flattening it into a
            weighted average:
          </p>
          <ul style={{ fontSize: 13.5, lineHeight: 1.62, marginTop: 10, paddingLeft: 20 }}>
            <li>
              Biology alone can drive a site below Good. Clean chemistry cannot rescue a collapsed
              invertebrate community.
            </li>
            <li>
              Chemistry acts as a ceiling — it can prevent High status and cap at Moderate, but
              cannot on its own assert Poor or Bad.
            </li>
            <li>
              No site reaches High status without a biological survey. A site with no survey is
              bounded, and told that a survey is its highest-value next observation.
            </li>
          </ul>
          <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.62 }}>
            A naive weighted average reports the opposite in both directions.
          </p>
        </div>
      </section>

      <section style={{ marginTop: 26 }}>
        <h2 style={{ fontSize: 17, marginBottom: 12 }}>Standards the thresholds come from</h2>
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Standard</th>
                <th scope="col">Used for</th>
              </tr>
            </thead>
            <tbody>
              {STANDARDS.map((standard) => (
                <tr key={standard.name}>
                  <td style={{ verticalAlign: 'top', width: '32%' }}>
                    <strong>{standard.name}</strong>
                    <div className="card-sub" style={{ marginTop: 4 }}>
                      {standard.note}
                    </div>
                  </td>
                  <td style={{ verticalAlign: 'top' }}>{standard.use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: 26 }}>
        <h2 style={{ fontSize: 17, marginBottom: 8 }}>What this system cannot do</h2>
        <div className="card" style={{ padding: 18, borderLeft: '3px solid var(--sev-watch)' }}>
          <ul style={{ fontSize: 13.5, lineHeight: 1.66, margin: 0, paddingLeft: 20 }}>
            <li>
              <strong>It does not measure pathogens, cyanotoxins or resistance genes.</strong> All
              three need laboratory work. What it scores are the field-observable conditions
              associated with elevated risk, and every finding is phrased that way.
            </li>
            <li>
              <strong>The index is not validated against ground-truth field data.</strong> It is
              tested for internal consistency and boundary behaviour. A real validation study would
              need paired citizen and professional sampling across a season.
            </li>
            <li>
              <strong>Several physico-chemical guidelines are modelled, not legal limits.</strong>{' '}
              The Directive sets them per Member State and per water body type; no single European
              number exists to cite. Anyone deploying this on real streams must substitute their own
              competent authority's standards.
            </li>
            <li>
              <strong>The reference ASPT is one constant, not a site-specific prediction.</strong>{' '}
              Real practice derives it per site from RIVPACS/RICT. Neer does not implement that.
            </li>
            <li>
              <strong>River discharge is catchment-scale.</strong> The flood API is GloFAS at
              roughly 5 km — far too coarse to represent an individual urban stream, so it is used
              as a hydrological covariate and never as a reach discharge value.
            </li>
            <li>
              <strong>Coimbra observations are a sample dataset.</strong> Weather and hydrology are
              real; the observations are generated by a documented physical model so the analytics
              can be exercised end to end. Sites marked <em>Real sensor</em> carry measured
              Environment Agency readings.
            </li>
          </ul>
        </div>
      </section>

      <section style={{ marginTop: 26 }}>
        <h2 style={{ fontSize: 17, marginBottom: 8 }}>No language model decides what is true</h2>
        <div className="card" style={{ padding: 18 }}>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.62 }}>
            Every finding is produced by a deterministic rule that is a pure function of its inputs:
            no database, no network, no clock. Each one carries the rule that fired it, the exact
            metric values behind every claim, and a citation for every threshold, so any statement
            can be traced back to a number and a source.
          </p>
          <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.62 }}>
            This is a safety property, not an architectural preference. A fabricated pathogen
            warning on a public waterway either triggers an unwarranted closure or manufactures
            false reassurance about a hazard nobody tested for — and neither is recoverable from a
            system whose reasoning cannot be audited.
          </p>
        </div>
      </section>

      <section style={{ marginTop: 26, marginBottom: 40 }}>
        <h2 style={{ fontSize: 17, marginBottom: 8 }}>Run it yourself</h2>
        <div className="card" style={{ padding: 18 }}>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.62 }}>
            Neer is open source. The full stack — ClickHouse, the API, this dashboard and the live
            ingestion of sensor readings, weather and CSV uploads — starts with one command and
            needs no accounts or keys:
          </p>
          <pre className="code-block">
            <code>{SETUP_COMMAND}</code>
          </pre>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.62 }}>
            This hosted site serves a snapshot exported from that stack, which is why it costs
            nothing to keep online. The repository, the method and every threshold's citation are at{' '}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              {REPO_URL.replace(/^https?:\/\//, '')}
            </a>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
