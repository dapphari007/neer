import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  adapter,
  type Finding,
  type LiveEvent,
  type Measurements,
  type SiteSummary,
} from './lib/api';
import { useGame } from './lib/game';
import { OceanBackdrop, Seafloor } from './components/OceanBackdrop';
import { Mascot } from './components/Mascot';
import { LivePill } from './components/LivePill';
import { Explorer } from './views/Explorer';
import { StreamStory } from './views/StreamStory';
import { Overview } from './views/Overview';
import { SiteDetail } from './views/SiteDetail';
import { Method } from './views/Method';

/**
 * Shell, modes, routing — and the live loop.
 *
 * Two front doors onto one dataset. Explorer mode is for children, families and
 * classrooms; Scientist mode is the analytical dashboard. Switching keeps you
 * on the same stream, because it is the same stream — told differently, never
 * scored differently.
 *
 * Live updates: the adapter streams change events and the app refetches the
 * endpoints it already trusts. Events say WHAT changed, so the page can name it
 * ("River Lee re-scored") instead of flashing for no stated reason.
 */

type Mode = 'explorer' | 'scientist';
type Route = { view: 'home' } | { view: 'site'; siteId: string } | { view: 'method' };

export function App() {
  const [sites, setSites] = useState<SiteSummary[] | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [measurements, setMeasurements] = useState<Measurements[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('explorer');
  const [route, setRoute] = useState<Route>({ view: 'home' });
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [lastEventLabel, setLastEventLabel] = useState<string | null>(null);
  /** Bumps whenever data changed, so open detail views refetch their own slices. */
  const [dataVersion, setDataVersion] = useState(0);
  const game = useGame();
  const sitesRef = useRef<SiteSummary[] | null>(null);
  sitesRef.current = sites;

  const load = useCallback(async () => {
    const [loadedSites, loadedFindings, loadedMeasurements] = await Promise.all([
      adapter.getSites(),
      adapter.getFindings(),
      // Comparisons are an enhancement; losing them must not take the app down.
      adapter.getMeasurements().catch(() => [] as Measurements[]),
    ]);
    setSites(loadedSites);
    setFindings(loadedFindings);
    setMeasurements(loadedMeasurements);
  }, []);

  useEffect(() => {
    load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [load]);

  // ─── Live events ───────────────────────────────────────────────────────────
  useEffect(() => {
    const describe = (event: LiveEvent): string | null => {
      const names = (ids: string[]) =>
        ids
          .map((id) => sitesRef.current?.find((s) => s.siteId === id)?.name.split(' — ')[0] ?? id)
          .slice(0, 2)
          .join(', ') + (ids.length > 2 ? ` +${ids.length - 2}` : '');
      switch (event.type) {
        case 'scores':
          return `re-scored ${names(event.siteIds)}`;
        case 'observations':
          return `${event.count} new observation${event.count === 1 ? '' : 's'} at ${names(event.siteIds)}`;
        case 'sensors':
          return `${event.rows} sensor readings from ${event.sites} station${event.sites === 1 ? '' : 's'}`;
        case 'weather':
          return `weather refreshed for ${event.sites} sites`;
        default:
          return null;
      }
    };

    return adapter.subscribe((event) => {
      if (event.type === 'heartbeat') return;
      setLastEventAt(Date.now());
      setLastEventLabel(describe(event));
      // Scores are what the page shows; observations and readings only
      // matter once they have been scored, and that event follows within
      // seconds. Refetching on every event would just double the traffic.
      if (event.type === 'scores' || event.type === 'weather') {
        load()
          .then(() => setDataVersion((v) => v + 1))
          .catch(() => {});
      }
    }, setConnected);
  }, [load]);

  const selectedSite = useMemo(
    () => (route.view === 'site' ? (sites?.find((s) => s.siteId === route.siteId) ?? null) : null),
    [route, sites],
  );

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route, mode]);

  const openSite = (siteId: string) => setRoute({ view: 'site', siteId });

  return (
    <>
      <OceanBackdrop />

      <div className="app">
        <header className="masthead">
          <div className="masthead-inner">
            <button
              type="button"
              className="wordmark"
              onClick={() => setRoute({ view: 'home' })}
              aria-label="Neer — home"
            >
              <Mascot status="high" size={34} title="" />
              <span style={{ textAlign: 'left' }}>
                <span className="wordmark-name" style={{ display: 'block' }}>
                  Neer
                </span>
                <span className="wordmark-tag">Healthy streams, healthy us</span>
              </span>
            </button>

            {/* Only the live build has an event stream to report on. The hosted
                snapshot does not change, so it shows no indicator at all rather
                than a pulsing dot over data that cannot move. */}
            {adapter.kind === 'live' && (
              <LivePill
                connected={connected}
                lastEventAt={lastEventAt}
                lastEventLabel={lastEventLabel}
              />
            )}

            <div className="mode-switch" role="group" aria-label="Choose how to explore">
              <button
                type="button"
                aria-pressed={mode === 'explorer'}
                onClick={() => {
                  setMode('explorer');
                  if (route.view === 'method') setRoute({ view: 'home' });
                }}
              >
                🐟 Explorer
              </button>
              <button
                type="button"
                aria-pressed={mode === 'scientist'}
                onClick={() => setMode('scientist')}
              >
                🔬 Scientist
              </button>
            </div>

            <button
              type="button"
              className="nav-link"
              aria-current={route.view === 'method' ? 'page' : undefined}
              onClick={() => setRoute({ view: 'method' })}
              aria-label="How it works"
            >
              <span className="long">How it works</span>
              <span className="short" aria-hidden="true">
                ?
              </span>
            </button>
          </div>
        </header>

        <main className="shell">
          {error && (
            <div className="error-box">
              <p>{error}</p>
            </div>
          )}
          {!error && sites === null && <div className="loading">Diving in…</div>}

          {route.view === 'method' && <Method />}

          {sites !== null && route.view === 'home' && mode === 'explorer' && (
            <Explorer sites={sites} game={game} onSelectSite={openSite} />
          )}

          {sites !== null && route.view === 'home' && mode === 'scientist' && (
            <Overview sites={sites} findings={findings} onSelectSite={openSite} />
          )}

          {selectedSite && mode === 'explorer' && (
            <StreamStory
              key={`${selectedSite.siteId}-${dataVersion}`}
              site={selectedSite}
              measurements={measurements.find((m) => m.siteId === selectedSite.siteId)}
              disclosure={selectedSite.source === 'sensor' ? 'real' : 'simulated'}
              game={game}
              onBack={() => setRoute({ view: 'home' })}
              onSeeScience={() => setMode('scientist')}
            />
          )}

          {selectedSite && mode === 'scientist' && (
            <SiteDetail
              key={`${selectedSite.siteId}-${dataVersion}`}
              site={selectedSite}
              onBack={() => setRoute({ view: 'home' })}
            />
          )}
        </main>

        <Seafloor />
      </div>
    </>
  );
}
