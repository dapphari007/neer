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

export interface DataDisclosure {
  observations: string;
  environmental: string;
  note: string;
}

export interface DataAdapter {
  readonly kind: 'live' | 'static';
  getSites(): Promise<SiteSummary[]>;
  getTrend(siteId: string): Promise<TrendPoint[]>;
  getFindings(siteId?: string): Promise<Finding[]>;
  getDisclosure(): Promise<DataDisclosure>;
}

// ─── Live API ─────────────────────────────────────────────────────────────────

class HttpAdapter implements DataAdapter {
  readonly kind = 'live' as const;
  private disclosure: DataDisclosure | null = null;

  constructor(private readonly baseUrl: string) {}

  private async get<T>(path: string): Promise<{ data: T; meta?: { dataDisclosure: DataDisclosure } }> {
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
    const query = siteId ? `?siteId=${encodeURIComponent(siteId)}&minSeverity=info&limit=200` : '?minSeverity=info&limit=200';
    return (await this.get<Finding[]>(`/api/findings${query}`)).data;
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

    const promise = fetch(`${import.meta.env.BASE_URL}demo-data/${file}`).then((response) => {
      if (!response.ok) {
        throw new Error(
          `Demo data not found (${file}). Run \`pnpm export:demo\` to generate it, or set VITE_API_BASE_URL to use the live API.`,
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
