import { Injectable, Logger } from '@nestjs/common';
import { scoreSites } from '@neer/pipeline';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { EventsService } from './events.service';

/**
 * Incremental re-scoring.
 *
 * When observations land for a site, that site is re-scored a couple of seconds
 * later — debounced, so a burst of readings from one sonde produces one scoring
 * run rather than fifteen. Runs are serialised through a single promise chain:
 * two concurrent runs writing the same site would race on the result tables.
 *
 * The scoring function is the same one the batch tool calls. An incremental
 * score and a batch score can therefore never disagree, which is the property
 * that lets a "live" number be trusted as much as a nightly one.
 */
@Injectable()
export class LiveScoringService {
  private readonly logger = new Logger(LiveScoringService.name);
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly events: EventsService,
  ) {}

  /** Ask for a site to be re-scored soon. Coalesces with other requests in the window. */
  schedule(siteIds: readonly string[], debounceMs = 2_000): void {
    for (const id of siteIds) this.pending.add(id);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), debounceMs);
  }

  /** Re-score now, waiting for any run in progress first. */
  async scoreNow(siteIds: readonly string[]): Promise<void> {
    const ids = [...siteIds];
    this.chain = this.chain.then(() => this.run(ids));
    return this.chain;
  }

  private flush(): void {
    const ids = [...this.pending];
    this.pending.clear();
    this.timer = null;
    if (ids.length === 0) return;
    this.chain = this.chain.then(() => this.run(ids));
  }

  private async run(siteIds: string[]): Promise<void> {
    const started = Date.now();
    try {
      const summary = await scoreSites(this.clickhouse.writer, { siteIds });
      this.logger.log(
        `Re-scored ${summary.sites} site(s), ${summary.siteDays} site-days, ${summary.findings} findings in ${Date.now() - started}ms`,
      );
      this.events.emit({ type: 'scores', siteIds, at: new Date().toISOString() });
    } catch (error) {
      // A failed re-score leaves the previous score in place, which is the
      // right outcome: stale beats wrong, and the next observation retries.
      this.logger.error(
        `Re-scoring failed for ${siteIds.join(', ')}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
