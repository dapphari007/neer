import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createClient, type ClickHouseClient } from '@clickhouse/client';

/**
 * ClickHouse access for the read path.
 *
 * Settings differ deliberately from the seeding client in `@neer/tools`: this
 * one serves interactive dashboard queries, where a slow response is a worse
 * failure than an incomplete one. Timeouts are short, result sets are capped,
 * and readonly mode is on.
 */
@Injectable()
export class ClickHouseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClickHouseService.name);
  private client!: ClickHouseClient;

  onModuleInit(): void {
    this.client = createClient({
      url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
      username: process.env.CLICKHOUSE_USER ?? 'neer',
      password: process.env.CLICKHOUSE_PASSWORD ?? 'neer_local_dev',
      database: process.env.CLICKHOUSE_DATABASE ?? 'neer',
      request_timeout: 15_000,
      max_open_connections: 10,
      clickhouse_settings: {
        // This service never writes. Enforcing that at the connection rather
        // than trusting every query to behave means an injected or mistaken
        // mutation fails at the server instead of succeeding quietly.
        readonly: '1',
        max_execution_time: 12,
        // Cap result size. A missing WHERE clause should degrade one request,
        // not stream the whole table into the API process and take it down.
        max_result_rows: '200000',
        result_overflow_mode: 'throw',
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
  }

  /**
   * Run a parameterised query.
   *
   * Parameters go through ClickHouse's `{name:Type}` binding rather than string
   * interpolation. Nothing user-supplied is ever concatenated into SQL — the
   * site id in a URL path is attacker-controlled input like any other.
   */
  async query<T>(sql: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const started = Date.now();
    try {
      const result = await this.client.query({
        query: sql,
        query_params: params,
        format: 'JSONEachRow',
      });
      const rows = (await result.json()) as T[];
      const elapsed = Date.now() - started;
      if (elapsed > 1_000) {
        this.logger.warn(`Slow query (${elapsed}ms): ${sql.slice(0, 120).replace(/\s+/g, ' ')}`);
      }
      return rows;
    } catch (error) {
      this.logger.error(
        `Query failed: ${sql.slice(0, 200).replace(/\s+/g, ' ')}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /** Liveness probe for the health endpoint and the container healthcheck. */
  async ping(): Promise<boolean> {
    try {
      await this.query('SELECT 1 AS ok');
      return true;
    } catch {
      return false;
    }
  }
}
