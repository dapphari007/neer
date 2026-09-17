import { useEffect, useMemo, useState } from 'react';
import { adapter, type DataDisclosure, type Finding, type SiteSummary } from './lib/api';
import { Overview } from './views/Overview';
import { SiteDetail } from './views/SiteDetail';
import { Method } from './views/Method';

/**
 * Shell and routing.
 *
 * Routing is a piece of state rather than a router library: there are two views
 * and a method page. Pulling in a router to express that would add a dependency
 * and a bundle for no capability the app uses.
 */

type Route = { view: 'overview' } | { view: 'site'; siteId: string } | { view: 'method' };

export function App() {
  const [sites, setSites] = useState<SiteSummary[] | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [disclosure, setDisclosure] = useState<DataDisclosure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>({ view: 'overview' });

  useEffect(() => {
    Promise.all([adapter.getSites(), adapter.getFindings(), adapter.getDisclosure()])
      .then(([loadedSites, loadedFindings, loadedDisclosure]) => {
        setSites(loadedSites);
        setFindings(loadedFindings);
        setDisclosure(loadedDisclosure);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const selectedSite = useMemo(
    () => (route.view === 'site' ? (sites?.find((s) => s.siteId === route.siteId) ?? null) : null),
    [route, sites],
  );

  // Scroll to the top on navigation. Landing halfway down a new page because the
  // previous one was scrolled is disorienting and easy to miss in testing.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route]);

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead-inner">
          <div className="wordmark">
            <span>नीर Neer</span>
            <span className="tag">Stream One Health intelligence</span>
          </div>
          <nav className="nav">
            <button
              type="button"
              aria-current={route.view !== 'method' ? 'page' : undefined}
              onClick={() => setRoute({ view: 'overview' })}
            >
              Dashboard
            </button>
            <button
              type="button"
              aria-current={route.view === 'method' ? 'page' : undefined}
              onClick={() => setRoute({ view: 'method' })}
            >
              Method
            </button>
          </nav>
        </div>
      </header>

      <main className="shell">
        {/*
          The provenance banner sits above the data and is not dismissible.
          A reader must not be able to reach a score without first passing the
          statement of what is measured and what is modelled.
        */}
        {disclosure && (
          <div className="provenance" role="note">
            <span aria-hidden="true">⚠</span>
            <span>
              <strong>Data provenance.</strong> Weather and hydrology are <strong>real</strong>{' '}
              measurements from Open-Meteo. Citizen observations are <strong>simulated</strong> by a
              documented physical model — no real person recorded them, and nothing here describes
              the measured condition of any real stream.{' '}
              <button
                type="button"
                className="back-link"
                style={{ textDecoration: 'underline' }}
                onClick={() => setRoute({ view: 'method' })}
              >
                How the index works
              </button>
            </span>
          </div>
        )}

        {error && (
          <div className="error-box">
            <p>{error}</p>
          </div>
        )}

        {!error && sites === null && <div className="loading">Loading stream network…</div>}

        {route.view === 'method' && <Method />}

        {route.view === 'overview' && sites !== null && (
          <Overview
            sites={sites}
            findings={findings}
            onSelectSite={(siteId) => setRoute({ view: 'site', siteId })}
          />
        )}

        {route.view === 'site' && selectedSite && (
          <SiteDetail site={selectedSite} onBack={() => setRoute({ view: 'overview' })} />
        )}
      </main>
    </div>
  );
}
