import { useEffect, useMemo, useState } from 'react';
import {
  adapter,
  type Finding,
  type Measurements,
  type SiteSummary,
  type TrendPoint,
} from '../lib/api';
import type { Game } from '../lib/game';
import { buildComparisons, KID_FINDINGS, kidStatus } from '../lib/kid';
import { Mascot } from '../components/Mascot';
import { ShareModal } from '../components/ShareModal';
import { TrendChart } from '../components/TrendChart';
import { Stars } from './Explorer';
import { num } from '../lib/format';

/**
 * One stream's story, told for a child.
 *
 * The order is deliberate: how the stream feels (face, stars, one sentence),
 * then why (comparisons built from real measurements), then what is going on
 * (findings, retold), then what you can do. The "what you can do" text is the
 * rule engine's own citizen action, unedited — the retelling simplifies the
 * explanation, never the safety advice.
 */

interface Props {
  site: SiteSummary;
  measurements: Measurements | undefined;
  disclosure: 'simulated' | 'real';
  game: Game;
  onBack: () => void;
  onSeeScience: () => void;
}

const meterColor = (goodness: number): string =>
  goodness >= 0.85
    ? 'var(--status-high)'
    : goodness >= 0.6
      ? 'var(--status-good)'
      : goodness >= 0.35
        ? 'var(--status-moderate)'
        : goodness >= 0.15
          ? 'var(--status-poor)'
          : 'var(--status-bad)';

/** Has the stream been getting better or worse? First month against the latest. */
function direction(points: TrendPoint[]): { emoji: string; text: string } | null {
  const scored = points.filter((p) => p.sohi !== null);
  if (scored.length < 20) return null;
  const mean = (list: TrendPoint[]) => list.reduce((s, p) => s + (p.sohi ?? 0), 0) / list.length;
  const change = mean(scored.slice(-10)) - mean(scored.slice(0, 10));
  if (change > 5)
    return { emoji: '📈', text: 'Good news — this stream has been feeling better lately.' };
  if (change < -5)
    return {
      emoji: '📉',
      text: 'This stream has been feeling worse than it did a few months ago.',
    };
  return { emoji: '➡️', text: 'This stream has been feeling about the same for a while.' };
}

export function StreamStory({ site, measurements, disclosure, game, onBack, onSeeScience }: Props) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [points, setPoints] = useState<TrendPoint[] | null>(null);
  const [sharing, setSharing] = useState(false);

  const kid = kidStatus(site.status);
  const comparisons = useMemo(() => buildComparisons(measurements), [measurements]);
  const [river, reach] = site.name.split(' — ');

  const { visit } = game;
  useEffect(() => {
    visit(site.siteId);
  }, [site.siteId, visit]);

  useEffect(() => {
    let cancelled = false;
    setPoints(null);
    Promise.all([adapter.getFindings(site.siteId), adapter.getTrend(site.siteId)])
      .then(([siteFindings, trend]) => {
        if (cancelled) return;
        setFindings(siteFindings);
        setPoints(trend);
      })
      .catch(() => {
        if (!cancelled) setPoints([]);
      });
    return () => {
      cancelled = true;
    };
  }, [site.siteId]);

  // Worst first, and skip the purely technical ones a child cannot act on.
  const stories = useMemo(() => {
    const rank: Record<string, number> = { info: 0, watch: 1, elevated: 2, high: 3 };
    return [...findings]
      .filter((f) => KID_FINDINGS[f.ruleId])
      .sort((a, b) => (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0))
      .slice(0, 4);
  }, [findings]);

  const trendDirection = points ? direction(points) : null;

  return (
    <>
      <button type="button" className="back-link" onClick={onBack} style={{ marginTop: 20 }}>
        ← Back to the map
      </button>

      <section className="hero story-hero" style={{ paddingTop: 18 }}>
        <div className="hero-art">
          <Mascot status={site.status} size={190} float />
        </div>
        <div>
          <p className="compare-title" style={{ marginTop: 0 }}>
            {site.catchment} · Coimbra
          </p>
          <h1 style={{ fontSize: 'clamp(30px, 4.4vw, 50px)' }}>{river}</h1>
          {reach && (
            <p className="secondary" style={{ fontSize: 18, fontWeight: 700 }}>
              {reach}
            </p>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              marginTop: 14,
              flexWrap: 'wrap',
            }}
          >
            <span className="tile-value tnum" style={{ fontSize: 62, marginTop: 0 }}>
              {num(site.sohi, 0)}
              <span className="muted" style={{ fontSize: 22 }}>
                /100
              </span>
            </span>
            <span>
              <Stars count={kid.stars} />
              <span
                className="pill"
                style={{ marginTop: 6, display: 'flex', width: 'fit-content', fontSize: 14 }}
              >
                <i
                  className="swatch"
                  style={{ background: `var(--status-${site.status ?? 'moderate'})` }}
                />
                {kid.label}
              </span>
            </span>
          </div>

          <div
            className="speech beside"
            style={{ textAlign: 'left', maxWidth: 480, marginTop: 18 }}
          >
            “{kid.says}”
          </div>

          <div className="hero-actions">
            <button type="button" className="btn btn-coral" onClick={() => setSharing(true)}>
              🚀 Share this stream's story
            </button>
            <button type="button" className="btn" onClick={onSeeScience}>
              🔬 See the science
            </button>
          </div>
        </div>
      </section>

      <section>
        <h2 className="section-title">What is the water like?</h2>
        <p className="section-sub">
          Scientists measure streams with numbers. Here is what those numbers feel like in real life
          — with the real measurement underneath each one.
        </p>
        {comparisons.length > 0 ? (
          <div className="compare-grid">
            {comparisons.map((c) => (
              <article className="compare" key={c.key}>
                <div className="compare-emoji" aria-hidden="true">
                  {c.emoji}
                </div>
                <h3 className="compare-title">{c.topic}</h3>
                <p className="compare-like">{c.like}</p>
                <p className="compare-why">{c.why}</p>
                {c.goodness > 0 && (
                  <div className="meter" aria-hidden="true">
                    <span
                      style={{
                        width: `${Math.max(6, c.goodness * 100)}%`,
                        background: meterColor(c.goodness),
                      }}
                    />
                  </div>
                )}
                <p className="compare-real">{c.real}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="card" style={{ padding: 22 }}>
            <p className="secondary">
              Nobody has measured this stream in the last two weeks, so there is nothing to compare
              yet. We never guess — this stream needs an explorer!
            </p>
          </div>
        )}
      </section>

      <section>
        <h2 className="section-title">What is going on here?</h2>
        {stories.length === 0 ? (
          <div className="card" style={{ padding: 22 }}>
            <p className="secondary">
              Nothing worrying has been spotted here lately. That is good — but it only stays true
              if explorers keep checking.
            </p>
          </div>
        ) : (
          <div
            className="compare-grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}
          >
            {stories.map((finding) => {
              const story = KID_FINDINGS[finding.ruleId]!;
              return (
                <article className="compare" key={finding.findingId}>
                  <div className="compare-emoji" aria-hidden="true">
                    {story.emoji}
                  </div>
                  <p className="compare-like" style={{ marginTop: 10 }}>
                    {story.title}
                  </p>
                  <p className="compare-why">{story.story}</p>
                  <div className="action-text" style={{ marginTop: 12 }}>
                    <strong style={{ color: 'var(--glow)' }}>What you can do: </strong>
                    {finding.actionCitizen}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="section-title">How has it been feeling?</h2>
        <div className="card">
          <div className="card-head">
            <p style={{ fontWeight: 800, fontSize: 16 }}>
              {trendDirection
                ? `${trendDirection.emoji} ${trendDirection.text}`
                : 'Health score over time'}
            </p>
            <p className="card-sub">
              The white line is the health score. The soft blue band shows how sure we are — it gets
              wider when fewer explorers have visited. The little bars underneath are rainy days.
            </p>
          </div>
          {points === null ? (
            <div className="loading">Loading…</div>
          ) : (
            <TrendChart points={points} showSubIndices={false} />
          )}
        </div>
      </section>

      {sharing && (
        <ShareModal
          site={site}
          comparisons={comparisons}
          disclosure={disclosure}
          onClose={() => setSharing(false)}
          onShared={game.recordShare}
        />
      )}
    </>
  );
}
