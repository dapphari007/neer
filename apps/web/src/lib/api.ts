/**
 * The data layer — two adapters behind one interface.
 *
 * `HttpAdapter` talks to the NestJS API over ClickHouse: the real architecture,
 * live queries, the whole stack. `StaticAdapter` reads pre-exported JSON with no
 * backend at all.
 *
 * The second one exists for a specific and unglamorous reason: cost. Hosting
 * ClickHouse and an always-on API publicly costs real money, and the free tiers
 * that do not cost money sleep after fifteen minutes and take the better part of
 * a minute to wake — which is exactly the experience someone following a
 * submission link would get. The rollups for twelve sites over six months are a
 * few hundred kilobytes, so the dashboard can serve them as static files from
 * any CDN, instantly, forever, for nothing.
 *
 * Nothing is faked to make this work. The static files are the same computed
 * output the API returns, exported by `pnpm export:demo`. The adapter is chosen
 * by whether `VITE_API_BASE_URL` is set, so the same build runs against either.
 */

export interface SiteSummary {
  siteId: string;
  name: string;
  catchment: string;
  city: string;
  lat: number;
  lon: number;
  urbanClass: string;
  recreationalAccess: boolean | number;
  /** What produces this site's observations: 'simulated' | 'sensor' | 'citizen'. */
  source?: string;
  /** Map grouping — one viewport per region. */
  region?: string;
  provider?: string;
  sohi: number | null;
  status: string | null;
  confidence: number | null;
  sohiLow: number | null;
  sohiHigh: number | null;
  ecologicalScore: number | null;
  pressureScore: number | null;
  exposureScore: number | null;
  daysSinceLastObs: number | null;
  nObs?: number | null;
  asOf: string | null;
  activeFindingCount?: number | string;
  maxSeverity?: string;
}

export interface TrendPoint {
  siteId?: string;
  day: string;
  sohi: number | null;
  sohiLow: number | null;
  sohiHigh: number | null;
  ecologicalScore: number | null;
  pressureScore: number | null;
  exposureScore: number | null;
  confidence: number | null;
  nObs: number;
  tempMeanC: number | null;
  precipMm: number | null;
  dischargeM3s: number | null;
}

export interface Finding {
  findingId: string;
  siteId: string;
  siteName?: string;
  catchment?: string;
  day: string;
  ruleId: string;
  ruleVersion?: string;
  domain: string;
  severity: string;
  confidence: string;
  headline: string;
  mechanism: string;
  evidence: string[];
  metrics: Record<string, number>;
  citations: string[];
  actionCitizen: string;
  actionMunicipal: string;
  actionHealth: string;
  detectedAt: string;
  validUntil: string;
}

/** Trailing 14-day mean measurements, in real units. Null where not measured. */
export interface Measurements {
  siteId: string;
  nObs: number;
  waterTempC: number | null;
  dissolvedOxygenMgl: number | null;
  turbidityNtu: number | null;
  nitrateMgl: number | null;
  phosphateMgl: number | null;
  ph: number | null;
  litterScore: number | null;
  foamRate: number | null;
  sewageOdourRate: number | null;
}

export interface DataDisclosure {
  observations: string;
  environmental: string;
  note: string;
}

export type LiveEvent =
  | { type: 'scores'; siteIds: string[]; at: string }
  | { type: 'weather'; sites: number; at: string }
  | { type: 'sensors'; sites: number; rows: number; at: string }
  | { type: 'observations'; siteIds: string[]; count: number; at: string }
  | { type: 'heartbeat'; at: string };

export interface LiveStatus {
  sources: Array<{ source: string; lastRun: string; rows: number; ok: boolean; detail: string }>;
  stations: Array<{
    id: string;
    siteId: string;
    name: string;
    river: string;
    parameters: string[];
  }>;
  liveWeather: boolean;
  liveSensors: boolean;
}

export interface DataAdapter {
  readonly kind: 'live' | 'static';
  /**
   * Subscribe to change events. Returns an unsubscribe. The static adapter has
   * nothing to say and returns a no-op — a static export does not change.
   */
  subscribe(
    onEvent: (event: LiveEvent) => void,
    onState?: (connected: boolean) => void,
  ): () => void;
  getLiveStatus(): Promise<LiveStatus | null>;
  getSites(): Promise<SiteSummary[]>;
  getTrend(siteId: string): Promise<TrendPoint[]>;
  getFindings(siteId?: string): Promise<Finding[]>;
  getMeasurements(): Promise<Measurements[]>;
  getDisclosure(): Promise<DataDisclosure>;
}

// ─── Live API ─────────────────────────────────────────────────────────────────

class HttpAdapter implements DataAdapter {
  readonly kind = 'live' as const;
  private disclosure: DataDisclosure | null = null;

  constructor(private readonly baseUrl: string) {}

  private async get<T>(
    path: string,
  ): Promise<{ data: T; meta?: { dataDisclosure: DataDisclosure } }> {
    const response = await fetch(`${this.baseUrl}${path}`);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? `Request failed: ${response.status} ${path}`);
    }
    const payload = (await response.json()) as {
      data: T;
      meta?: { dataDisclosure: DataDisclosure };
    };
    // The disclosure rides on every response, so it is captured from whichever
    // call happens to land first rather than needing its own request.
    if (payload.meta?.dataDisclosure) this.disclosure = payload.meta.dataDisclosure;
    return payload;
  }

  async getSites(): Promise<SiteSummary[]> {
    return (await this.get<SiteSummary[]>('/api/sites')).data;
  }

  async getTrend(siteId: string): Promise<TrendPoint[]> {
    const payload = await this.get<{ points: TrendPoint[] }>(
      `/api/sites/${encodeURIComponent(siteId)}/trend`,
    );
    return payload.data.points;
  }

  async getFindings(siteId?: string): Promise<Finding[]> {
    const query = siteId
      ? `?siteId=${encodeURIComponent(siteId)}&minSeverity=info&limit=200`
      : '?minSeverity=info&limit=200';
    return (await this.get<Finding[]>(`/api/findings${query}`)).data;
  }

  async getMeasurements(): Promise<Measurements[]> {
    return (await this.get<Measurements[]>('/api/measurements')).data;
  }

  async getLiveStatus(): Promise<LiveStatus | null> {
    try {
      return (await this.get<LiveStatus>('/api/live/status')).data;
    } catch {
      return null;
    }
  }

  /**
   * Server-sent events. EventSource reconnects on its own after a drop, so the
   * only state worth surfacing is whether the stream is currently open.
   */
  subscribe(
    onEvent: (event: LiveEvent) => void,
    onState?: (connected: boolean) => void,
  ): () => void {
    const source = new EventSource(`${this.baseUrl}/api/events`);
    const handle = (raw: MessageEvent) => {
      try {
        onEvent(JSON.parse(raw.data) as LiveEvent);
      } catch {
        // A malformed event is ignored; the next one will be fine.
      }
    };
    for (const type of ['scores', 'weather', 'sensors', 'observations', 'heartbeat']) {
      source.addEventListener(type, handle as EventListener);
    }
    source.onopen = () => onState?.(true);
    source.onerror = () => onState?.(false);
    return () => source.close();
  }

  async getDisclosure(): Promise<DataDisclosure> {
    if (!this.disclosure) await this.getSites();
    return (
      this.disclosure ?? {
        observations: 'unknown',
        environmental: 'unknown',
        note: 'Data provenance was not reported by the API.',
      }
    );
  }
}

// ─── Static export ────────────────────────────────────────────────────────────

class StaticAdapter implements DataAdapter {
  readonly kind = 'static' as const;
  // Each file is fetched at most once per session. The trend file is the only
  // sizeable one and every site view needs it, so re-fetching per navigation
  // would be the dominant cost of using the app.
  private cache = new Map<string, Promise<unknown>>();

  private load<T>(file: string): Promise<T> {
    const existing = this.cache.get(file);
    if (existing) return existing as Promise<T>;

    const promise = fetch(`${import.meta.env.BASE_URL}data/${file}`).then((response) => {
      if (!response.ok) {
        throw new Error(
          `Exported data not found (${file}). Run \`pnpm export:demo\` to generate it, or set VITE_API_BASE_URL to use the live API.`,
        );
      }
      return response.json();
    });

    this.cache.set(file, promise);
    return promise as Promise<T>;
  }

  async getSites(): Promise<SiteSummary[]> {
    return this.load<SiteSummary[]>('sites.json');
  }

  async getTrend(siteId: string): Promise<TrendPoint[]> {
    const all = await this.load<TrendPoint[]>('trends.json');
    return all.filter((point) => point.siteId === siteId);
  }

  async getFindings(siteId?: string): Promise<Finding[]> {
    const all = await this.load<Finding[]>('findings.json');
    return siteId ? all.filter((finding) => finding.siteId === siteId) : all;
  }

  async getMeasurements(): Promise<Measurements[]> {
    return this.load<Measurements[]>('measurements.json');
  }

  async getLiveStatus(): Promise<LiveStatus | null> {
    return null;
  }

  subscribe(): () => void {
    return () => {};
  }

  async getDisclosure(): Promise<DataDisclosure> {
    const manifest = await this.load<{ dataDisclosure: DataDisclosure }>('manifest.json');
    return manifest.dataDisclosure;
  }
}

/**
 * Pick an adapter.
 *
 * `VITE_API_BASE_URL` is baked in at build time, so a static deployment cannot
 * accidentally point at a localhost API that will never answer for its visitors.
 */
export function createAdapter(): DataAdapter {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return baseUrl ? new HttpAdapter(baseUrl.replace(/\/$/, '')) : new StaticAdapter();
}

export const adapter = createAdapter();
