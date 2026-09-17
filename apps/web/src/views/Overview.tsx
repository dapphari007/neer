import { useMemo, useState } from 'react';
import type { Finding, SiteSummary } from '../lib/api';
import { GameMap } from '../components/GameMap';
import { FindingCard } from '../components/FindingCard';
import { num, statusColor, statusLabel, urbanClassLabel } from '../lib/format';

/**
 * The overview.
 *
 * Ordered worst-first throughout. A dashboard that lists sites alphabetically,
 * or best-first, makes the reader do the ranking — and the whole claim of this
 * product is that it does the interpretation so they do not have to.
 */

interface Props {
  sites: SiteSummary[];
  findings: Finding[];
  onSelectSite: (siteId: string) => void;
}

export function Overview({ sites, findings, onSelectSite }: Props) {
  const [hoveredSite, setHoveredSite] = useState<string | null>(null);

  /**
   * Order worst-first here rather than trusting the adapter.
   *
   * The live API sorts by score; the static export sorts by site id. Relying on
   * either would make the "worst first" heading true in one deployment and false
   * in the other — and presentation order is the presentation layer's business
   * anyway. Unscored sites sort last: they are not "best", they are unknown, and
   * the row says so.
   */
  const ordered = useMemo(
    () =>
      [...sites].sort((a, b) => {
        if (a.sohi === null && b.sohi === null) return a.name.localeCompare(b.name);
        if (a.sohi === null) return 1;
        if (b.sohi === null) return -1;
        return a.sohi - b.sohi;
      }),
    [sites],
  );

  const stats = useMemo(() => {
    const scored = sites.filter((s) => s.sohi !== null);
    const mean = scored.reduce((sum, s) => sum + (s.sohi ?? 0), 0) / Math.max(1, scored.length);
    const belowGood = scored.filter((s) => (s.sohi ?? 100) < 60).length;
    const highSeverity = findings.filter((f) => f.severity === 'high' || f.severity === 'elevated');
    const withContact = sites.filter(
      (s) => Boolean(Number(s.recreationalAccess)) && (s.sohi ?? 100) < 60,
    ).length;
    const meanConfidence =
      scored.reduce((sum, s) => sum + (s.confidence ?? 0), 0) / Math.max(1, scored.length);

    return { scored, mean, belowGood, highSeverity, withContact, meanConfidence };
  }, [sites, findings]);

  const priority = useMemo(
    () =>
      [...findings].sort((a, b) => {
        const rank: Record<string, number> = { info: 0, watch: 1, elevated: 2, high: 3 };
        const conf: Record<string, number> = { low: 0, medium: 1, high: 2 };
        return (
          (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0) ||
          (conf[b.confidence] ?? 0) - (conf[a.confidence] ?? 0)
        );
      }),
    [findings],
  );

  return (
    <>
      <section className="tiles" style={{ marginTop: 18 }}>
        <div className="tile">
          <div className="tile-label">Sites monitored</div>
          <div className="tile-value tnum">{sites.length}</div>
          <div className="tile-note">Coimbra, Portugal — across an urbanisation gradient</div>
        </div>
        <div className="tile">
          <div className="tile-label">Mean index</div>
          <div className="tile-value tnum">{num(stats.mean)}</div>
          <div className="tile-note">
            {stats.belowGood} of {stats.scored.length} sites below Good status
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Active findings</div>
          <div className="tile-value tnum">{findings.length}</div>
          <div className="tile-note">{stats.highSeverity.length} at elevated severity or above</div>
        </div>
        <div className="tile">
          <div className="tile-label">Public contact at risk</div>
          <div className="tile-value tnum">{stats.withContact}</div>
          <div className="tile-note">Sites below Good where people and animals enter the water</div>
        </div>
        <div className="tile">
          <div className="tile-label">Mean confidence</div>
          <div className="tile-value tnum">{Math.round(stats.meanConfidence * 100)}%</div>
          <div className="tile-note">
            How far the data supports the scores — not how good the water is
          </div>
        </div>
      </section>

      <div
        className="grid two-col"
        style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(300px, 1fr)', marginTop: 16 }}
      >
        <GameMap sites={sites} selectedId={hoveredSite} onSelect={onSelectSite} compact />

        <div className="card" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div className="card-head">
            <h2 className="card-title">Sites, worst first</h2>
            <p className="card-sub">
              The bar shows the credible interval, not a point value. A long bar means the data is
              thin, not that the stream is variable.
            </p>
          </div>
          <div style={{ overflowY: 'auto', flex: 1, maxHeight: 440 }}>
            {ordered.map((site) => (
              <button
                key={site.siteId}
                type="button"
                className="site-row"
                aria-current={hoveredSite === site.siteId}
                onMouseEnter={() => setHoveredSite(site.siteId)}
                onFocus={() => setHoveredSite(site.siteId)}
                onClick={() => onSelectSite(site.siteId)}
              >
                <span style={{ minWidth: 0 }}>
                  <span className="site-row-name">{site.name}</span>
                  <span className="site-row-meta" style={{ display: 'block' }}>
                    {urbanClassLabel(site.urbanClass)} · {statusLabel(site.status)}
                    {Number(site.activeFindingCount ?? 0) > 0 &&
                      ` · ${site.activeFindingCount} finding${Number(site.activeFindingCount) === 1 ? '' : 's'}`}
                  </span>
                  <span
                    className="site-row-meta tnum"
                    style={{ display: 'block', marginTop: 3 }}
                    title="Credible interval"
                  >
                    {num(site.sohiLow)} – {num(site.sohiHigh)}
                  </span>
                </span>
                <span className="score-chip">
                  <span className="score-num">{num(site.sohi, 0)}</span>
                  <span
                    className="score-bar"
                    style={{ background: statusColor(site.status) }}
                    aria-hidden="true"
                  />
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <section style={{ marginTop: 26 }}>
        <div style={{ marginBottom: 12 }}>
          <h2 className="section-title" style={{ marginTop: 8 }}>
            Priority findings
          </h2>
          <p className="card-sub" style={{ maxWidth: 780 }}>
            Ranked by severity, then by how confident the rule is. A severe finding the engine is
            unsure of still outranks a certain trivial one — the cost of missing the first is higher
            than the cost of investigating it. Every card opens to its evidence, the exact values
            behind it, and the standard each threshold came from.
          </p>
        </div>
        {priority.slice(0, 6).map((finding) => (
          <FindingCard key={finding.findingId} finding={finding} showSite />
        ))}
        {priority.length === 0 && (
          <div className="card" style={{ padding: 28, textAlign: 'center' }}>
            <p className="secondary" style={{ margin: 0 }}>
              No active findings. Note that this reflects the absence of detections, which is not
              the same as the absence of risk — sites with no recent observations cannot produce
              findings at all.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
