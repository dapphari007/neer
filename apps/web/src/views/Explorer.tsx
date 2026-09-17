import { useMemo, useRef } from 'react';
import type { SiteSummary } from '../lib/api';
import type { Game } from '../lib/game';
import { kidStatus } from '../lib/kid';
import { GameMap } from '../components/GameMap';
import { Mascot } from '../components/Mascot';
import { num } from '../lib/format';

/**
 * Explorer home — the way in for children, families and classrooms.
 *
 * Same data as Scientist mode, different front door. Nothing here is a separate
 * "kids' dataset": every star, face and comparison is derived from the same
 * index and the same measurements, so a child and a catchment officer looking at
 * the same stream are never told different things — only told them differently.
 */

interface Props {
  sites: SiteSummary[];
  game: Game;
  onSelectSite: (siteId: string) => void;
}

const Stars = ({ count }: { count: number }) => (
  <span className="stars" aria-label={`${count} out of 5 stars`}>
    {Array.from({ length: 5 }, (_, i) => (
      <span
        key={i}
        className={i < count ? undefined : 'off'}
        style={{ color: 'var(--sun)' }}
        aria-hidden="true"
      >
        ★
      </span>
    ))}
  </span>
);

export function Explorer({ sites, game, onSelectSite }: Props) {
  const mapRef = useRef<HTMLElement>(null);
  const streamsRef = useRef<HTMLElement>(null);

  const ordered = useMemo(
    () => [...sites].sort((a, b) => (a.sohi ?? 999) - (b.sohi ?? 999)),
    [sites],
  );
  const worst = ordered[0];
  const needHelp = ordered.filter((s) => s.sohi !== null && s.sohi < 60).length;

  const quests = [
    { text: 'Meet 3 different streams', done: game.visited.length >= 3, xp: '+10 XP each' },
    {
      text: 'Find the stream that needs the most help',
      done: worst ? game.visited.includes(worst.siteId) : false,
      xp: 'Hint: it pulses',
    },
    {
      text: 'Mark 3 things you have spotted on the map',
      done: game.marks.length >= 3,
      xp: '+20 XP each',
    },
    { text: "Share a stream's story", done: game.shares >= 1, xp: '+30 XP' },
  ];

  return (
    <>
      <section className="hero">
        <div>
          <h1>
            Every stream has a story. <em>Dive in!</em>
          </h1>
          <p className="hero-lede">
            Streams can feel healthy or poorly — just like us. Meet the streams of Coimbra, find out
            how each one is feeling, and discover what makes water happy.
          </p>
          <div className="hero-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              🗺️ Explore the map
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                streamsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              Meet the streams
            </button>
          </div>
        </div>

        <div className="hero-art">
          <Mascot status={needHelp > 0 ? 'moderate' : 'high'} size={170} float />
          <div className="speech">
            Hi, I'm Drip! {sites.length} streams live around here.{' '}
            {needHelp > 0
              ? `${needHelp} of them ${needHelp === 1 ? 'is' : 'are'} not feeling great — can you find ${needHelp === 1 ? 'it' : 'them'}?`
              : 'They are all feeling good today!'}
          </div>
        </div>
      </section>

      <section ref={mapRef} style={{ scrollMarginTop: 80 }}>
        <h2 className="section-title">The stream map</h2>
        <p className="section-sub">
          Each pin is a stream, and its number is a health score out of 100. Pulsing pins need help.
          Seen litter, foam, a fish or a bird near a stream? Pick a sticker and tap the map to mark
          it. Your marks are saved on this device only — they are your explorer's notebook.
        </p>

        <div
          className="grid two-col"
          style={{ gridTemplateColumns: 'minmax(0, 2.3fr) minmax(270px, 1fr)' }}
        >
          <GameMap sites={sites} onSelect={onSelectSite} game={game} />

          <div className="card" style={{ alignSelf: 'start' }}>
            <div className="card-head">
              <h3 className="card-title">Explorer quests</h3>
              <p className="card-sub">
                Level {game.level.number}: {game.level.name}
              </p>
            </div>
            {quests.map((quest) => (
              <div className="quest" key={quest.text} data-done={quest.done}>
                <span className="quest-check" aria-hidden="true">
                  {quest.done ? '✓' : ''}
                </span>
                <span className="quest-text">
                  {quest.text}
                  <span className="sr-only">{quest.done ? ' (done)' : ' (not done yet)'}</span>
                </span>
                <span className="quest-xp">{quest.xp}</span>
              </div>
            ))}
            {(game.xp > 0 || game.marks.length > 0) && (
              <div style={{ padding: '10px 16px 14px' }}>
                <button
                  type="button"
                  className="link-button"
                  style={{ fontSize: 12.5 }}
                  onClick={game.reset}
                >
                  Start my adventure again
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      <section ref={streamsRef} style={{ scrollMarginTop: 80 }}>
        <h2 className="section-title">Meet the streams</h2>
        <p className="section-sub">
          The ones that need the most help come first. Tap a stream to hear its story.
        </p>

        <div className="stream-grid">
          {ordered.map((site) => {
            const kid = kidStatus(site.status);
            const [river, reach] = site.name.split(' — ');
            return (
              <button
                key={site.siteId}
                type="button"
                className="stream-card"
                onClick={() => onSelectSite(site.siteId)}
              >
                <span className="stream-card-top">
                  <Mascot status={site.status} size={58} />
                  <span style={{ minWidth: 0 }}>
                    <span className="stream-card-name" style={{ display: 'block' }}>
                      {river}
                    </span>
                    {reach && (
                      <span className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>
                        {reach}
                      </span>
                    )}
                  </span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="tile-value tnum" style={{ fontSize: 30, marginTop: 0 }}>
                    {num(site.sohi, 0)}
                  </span>
                  <span>
                    <Stars count={kid.stars} />
                    <span
                      className="pill"
                      style={{ marginTop: 4, display: 'flex', width: 'fit-content' }}
                    >
                      <i
                        className="swatch"
                        style={{ background: `var(--status-${site.status ?? 'moderate'})` }}
                      />
                      {kid.label}
                    </span>
                  </span>
                </span>
                {site.sohi !== null && site.sohi < 60 && (
                  <span className="help-flag">Needs help!</span>
                )}
                {game.visited.includes(site.siteId) && (
                  <span className="muted" style={{ fontSize: 12, fontWeight: 800 }}>
                    ✓ You have visited
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}

export { Stars };
