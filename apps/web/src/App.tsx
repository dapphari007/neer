import { useEffect, useMemo, useState } from 'react';
import {
  adapter,
  type DataDisclosure,
  type Finding,
  type Measurements,
  type SiteSummary,
} from './lib/api';
import { useGame } from './lib/game';
import { OceanBackdrop, Seafloor } from './components/OceanBackdrop';
import { Mascot } from './components/Mascot';
import { Explorer } from './views/Explorer';
import { StreamStory } from './views/StreamStory';
import { Overview } from './views/Overview';
import { SiteDetail } from './views/SiteDetail';
import { Method } from './views/Method';

/**
 * Shell, modes and routing.
 *
 * Two front doors onto one dataset. Explorer mode is for children, families and
 * classrooms: faces, stars, real-life comparisons, a map to mark. Scientist mode
 * is the analytical dashboard: credible intervals, score decomposition, evidence
 * and citations. Switching modes keeps you on the same stream, because they are
 * the same stream — told differently, never scored differently.
 *
 * Routing is a piece of state rather than a router library; there are five
 * screens and no deep links to honour yet.
 */

type Mode = 'explorer' | 'scientist';
type Route = { view: 'home' } | { view: 'site'; siteId: string } | { view: 'method' };

export function App() {
  const [sites, setSites] = useState<SiteSummary[] | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [measurements, setMeasurements] = useState<Measurements[]>([]);
  const [disclosure, setDisclosure] = useState<DataDisclosure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('explorer');
  const [route, setRoute] = useState<Route>({ view: 'home' });
  const game = useGame();

  useEffect(() => {
    Promise.all([
      adapter.getSites(),
      adapter.getFindings(),
      adapter.getDisclosure(),
      // Comparisons are an enhancement; losing them must not take the app down.
      adapter.getMeasurements().catch(() => [] as Measurements[]),
    ])
      .then(([loadedSites, loadedFindings, loadedDisclosure, loadedMeasurements]) => {
        setSites(loadedSites);
        setFindings(loadedFindings);
        setDisclosure(loadedDisclosure);
        setMeasurements(loadedMeasurements);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const selectedSite = useMemo(
    () => (route.view === 'site' ? (sites?.find((s) => s.siteId === route.siteId) ?? null) : null),
    [route, sites],
  );

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route, mode]);

  const simulated = disclosure?.observations !== 'real';
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
          {/* Not dismissible, and above the data: nobody reaches a score without
              first passing the statement of what is measured and what is modelled. */}
          {disclosure && simulated && (
            <div className="provenance" role="note">
              <span aria-hidden="true">🧪</span>
              <span>
                <strong>This is a demo.</strong>{' '}
                {mode === 'explorer'
                  ? 'The weather here is real, but the stream check-ups are pretend ones made by a computer, so we can show how Neer works. They do not tell you how these real streams are doing.'
                  : 'Weather and hydrology are real measurements from Open-Meteo. Citizen observations are simulated by a documented physical model — no real person recorded them, and nothing here describes the measured condition of any real stream.'}{' '}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setRoute({ view: 'method' })}
                >
                  How it works
                </button>
              </span>
            </div>
          )}

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
              site={selectedSite}
              measurements={measurements.find((m) => m.siteId === selectedSite.siteId)}
              disclosure={simulated ? 'simulated' : 'real'}
              game={game}
              onBack={() => setRoute({ view: 'home' })}
              onSeeScience={() => setMode('scientist')}
            />
          )}

          {selectedSite && mode === 'scientist' && (
            <SiteDetail site={selectedSite} onBack={() => setRoute({ view: 'home' })} />
          )}
        </main>

        <Seafloor />
      </div>
    </>
  );
}
