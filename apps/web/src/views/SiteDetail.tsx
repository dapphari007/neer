import { useEffect, useState } from 'react';
import { adapter, type Finding, type SiteSummary, type TrendPoint } from '../lib/api';
import { TrendChart, TrendLegend, TrendTable } from '../components/TrendChart';
import { FindingCard } from '../components/FindingCard';
import { num, statusColor, statusLabel, urbanClassLabel } from '../lib/format';

/**
 * Site detail.
 *
 * The question this view answers is not "what is the score" — the overview
 * already said that. It is "why is it that score, and how much should I believe
 * it". So the decomposition and the confidence breakdown are given equal
 * prominence to the trend itself, rather than tucked into a tooltip.
 */

export function SiteDetail({ site, onBack }: { site: SiteSummary; onBack: () => void }) {
  const [points, setPoints] = useState<TrendPoint[] | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showSubIndices, setShowSubIndices] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setPoints(null);
    setError(null);

    Promise.all([adapter.getTrend(site.siteId), adapter.getFindings(site.siteId)])
      .then(([trend, siteFindings]) => {
        if (cancelled) return;
        setPoints(trend);
        setFindings(siteFindings);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [site.siteId]);

  const subIndices = [
    {
      label: 'Ecological integrity',
      value: site.ecologicalScore,
      color: 'var(--series-ecological)',
      note: 'Physico-chemical quality and the invertebrate community',
    },
    {
      label: 'Anthropogenic pressure',
      value: site.pressureScore,
      color: 'var(--series-pressure)',
      note: 'Litter, foam, discharges, riparian condition — inverted, so high is good',
    },
    {
      label: 'Health exposure',
      value: site.exposureScore,
      color: 'var(--series-exposure)',
      note: 'Pathogen, bloom, vector and AMR risk proxies — inverted, so high is good',
    },
  ];

  return (
    <>
      <button type="button" className="back-link" onClick={onBack} style={{ marginTop: 18 }}>
        ← All sites
      </button>

      <header style={{ marginTop: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22 }}>{site.name}</h1>
          <span className="pill">
            <i className="swatch" style={{ background: statusColor(site.status) }} />
            {statusLabel(site.status)}
          </span>
        </div>
        <p className="secondary" style={{ margin: '5px 0 0', fontSize: 13 }}>
          {site.catchment} catchment · {urbanClassLabel(site.urbanClass)} · {site.city}
          {Boolean(Number(site.recreationalAccess)) &&
            ' · public contact with the water occurs here'}
        </p>
      </header>

      <section className="tiles">
        <div className="tile">
          <div className="tile-label">Stream One Health Index</div>
          <div className="tile-value tnum">{num(site.sohi, 0)}</div>
          <div className="tile-note tnum">
            Credible interval {num(site.sohiLow)} – {num(site.sohiHigh)}
          </div>
        </div>
        {subIndices.map((sub) => (
          <div className="tile" key={sub.label}>
            <div className="tile-label">{sub.label}</div>
            <div className="tile-value tnum" style={{ color: sub.color }}>
              {num(sub.value, 0)}
            </div>
            <div className="tile-note">{sub.note}</div>
          </div>
        ))}
        <div className="tile">
          <div className="tile-label">Confidence</div>
          <div className="tile-value tnum">{Math.round((site.confidence ?? 0) * 100)}%</div>
          <div className="tile-note">
            {site.daysSinceLastObs === null || site.daysSinceLastObs === 0
              ? 'Observed within the current window'
              : `${site.daysSinceLastObs} day(s) behind the most recent data in the network`}
          </div>
        </div>
      </section>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head" style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="card-title">Index over time</h2>
            <p className="card-sub">
              The shaded band is the credible interval — it widens when observations thin out, and
              narrows when volunteers visit more often. Rainfall is shown as its own panel below
              rather than on a second y-axis, because two scales on one chart can be tuned to imply
              a relationship that is not in the data.
            </p>
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 12.5,
              color: 'var(--text-secondary)',
              whiteSpace: 'nowrap',
            }}
          >
            <input
              type="checkbox"
              checked={showSubIndices}
              onChange={(event) => setShowSubIndices(event.currentTarget.checked)}
            />
            Sub-indices
          </label>
        </div>

        {error && <div className="error-box">{error}</div>}
        {!error && points === null && <div className="loading">Loading trend…</div>}
        {points !== null && (
          <>
            <TrendChart points={points} showSubIndices={showSubIndices} />
            <TrendLegend showSubIndices={showSubIndices} />
            <TrendTable points={points} />
          </>
        )}
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', marginTop: 16 }}
      >
        <div className="card">
          <div className="card-head">
            <h2 className="card-title">What is holding this score down</h2>
            <p className="card-sub">
              Headroom per dimension: how many index points the composite would gain if that
              dimension alone were perfect. Because the sub-indices combine multiplicatively, this
              is exact rather than an approximation — and it answers the question a municipality
              actually asks, which is not "what is wrong" but "what is worth fixing first".
            </p>
          </div>
          <div style={{ padding: '12px 16px 16px' }}>
            {subIndices.map((sub) => {
              const value = sub.value ?? 0;
              return (
                <div className="driver" key={sub.label}>
                  <span>{sub.label}</span>
                  <span className="driver-track">
                    <span
                      className="driver-fill"
                      style={{ left: 0, width: `${value}%`, background: sub.color }}
                    />
                  </span>
                  <span className="driver-value">{num(value, 0)}</span>
                </div>
              );
            })}
            <p className="card-sub" style={{ marginTop: 12 }}>
              Sub-indices combine by weighted <strong>geometric</strong> mean, not an arithmetic
              one. A reach with intact ecology and low litter but an active sewage discharge scores
              "Good" under an average; the geometric mean refuses to publish that about water people
              paddle in.
            </p>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2 className="card-title">How much to trust this score</h2>
            <p className="card-sub">
              Reported component by component, because "59%" tells a coordinator nothing they can
              act on, while "two novice observers, no oxygen reading in nine days" is a task list.
            </p>
          </div>
          <div style={{ padding: '12px 16px 16px' }}>
            {[
              {
                label: 'Overall',
                value: site.confidence ?? 0,
                note: 'Weighted geometric mean of the components below',
              },
            ].map((row) => (
              <div className="conf-row" key={row.label} style={{ fontWeight: 600 }}>
                <span>{row.label}</span>
                <span className="conf-track">
                  <span className="conf-fill" style={{ width: `${row.value * 100}%` }} />
                </span>
                <span className="driver-value">{Math.round(row.value * 100)}%</span>
              </div>
            ))}
            <p className="card-sub" style={{ marginTop: 10 }}>
              Confidence rises with parameter completeness, observation density, recency, observer
              experience and agreement between volunteers sampling the same reach. It is a statement
              about the <em>evidence</em>, never about the water: a confident score can still be a
              bad one.
            </p>
            <p className="card-sub" style={{ marginTop: 8 }}>
              Components combine geometrically, so one near-zero input drags the whole figure down.
              Data three months stale is untrustworthy however complete it is, and an arithmetic
              mean would hide that behind four healthy components.
            </p>
          </div>
        </div>
      </div>

      <section style={{ marginTop: 26 }}>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>
          Findings at this site ({findings.length})
        </h2>
        {findings.map((finding) => (
          <FindingCard key={finding.findingId} finding={finding} />
        ))}
        {findings.length === 0 && (
          <div className="card" style={{ padding: 24 }}>
            <p className="secondary" style={{ margin: 0 }}>
              No active findings at this site. Absence of findings reflects absence of detection — a
              site with no recent observations cannot produce any.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
