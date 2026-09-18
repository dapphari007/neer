import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/**
 * Server-sent events — how the dashboard learns that something changed.
 *
 * SSE rather than WebSockets because the traffic is one-way and tiny: the
 * server says "site X was re-scored", the client refetches. There is no
 * client-to-server channel to justify a socket, SSE reconnects by itself, and
 * it works through every proxy and CDN that passes HTTP.
 *
 * Events carry ids, not payloads. Pushing the full scored record would mean a
 * second code path producing the same JSON the REST endpoints already produce,
 * and two paths drift. The client hears the id and asks the endpoint it already
 * trusts.
 */

export type LiveEvent =
  | { type: 'scores'; siteIds: string[]; at: string }
  | { type: 'weather'; sites: number; at: string }
  | { type: 'sensors'; sites: number; rows: number; at: string }
  | { type: 'observations'; siteIds: string[]; count: number; at: string }
  | { type: 'heartbeat'; at: string };

@Injectable()
export class EventsService {
  private readonly subject = new Subject<LiveEvent>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor() {
    // A heartbeat every 25 s keeps idle connections alive through proxies that
    // drop silent streams, and lets the client show "connected" honestly.
    this.heartbeat = setInterval(
      () => this.subject.next({ type: 'heartbeat', at: new Date().toISOString() }),
      25_000,
    );
    this.heartbeat.unref();
  }

  emit(event: LiveEvent): void {
    this.subject.next(event);
  }

  stream(): Observable<LiveEvent> {
    return this.subject.asObservable();
  }
}
