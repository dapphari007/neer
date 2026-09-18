import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createClient, type ClickHouseClient } from '@clickhouse/client';

/**
 * ClickHouse access.
 *
 * Two connections, two jobs. The read client serves every dashboard query and
 * is locked read-only at the connection with tight limits, so a mistaken or
 * injected mutation fails at the server and a runaway query degrades one
 * request rather than the process. The write client exists for the live path —
 * ingesting observations and re-scoring — and is handed only to the code that
 * does that. Nothing in a request handler touches it directly.
 */
@Injectable()
export class ClickHouseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClickHouseService.name);
  private reader!: ClickHouseClient;
  private writerClient!: ClickHouseClient;

  onModuleInit(): void {
    const shared = {
      url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
      username: process.env.CLICKHOUSE_USER ?? 'neer',
      password: process.env.CLICKHOUSE_PASSWORD ?? 'neer_local_dev',
      database: process.env.CLICKHOUSE_DATABASE ?? 'neer',
    };

    this.reader = createClient({
      ...shared,
      request_timeout: 15_000,
      max_open_connections: 10,
      clickhouse_settings: {
        readonly: '1',
        max_execution_time: 12,
        max_result_rows: '200000',
        result_overflow_mode: 'throw',
      },
    });

    this.writerClient = createClient({
      ...shared,
      request_timeout: 60_000,
      max_open_connections: 4,
      clickhouse_settings: {
        async_insert: 1,
        wait_for_async_insert: 1,
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.reader?.close(), this.writerClient?.close()]);
  }

  /** The write-capable client, for the live ingestion and scoring services only. */
  get writer(): ClickHouseClient {
    return this.writerClient;
  }

  /**
   * Run a parameterised read.
   *
   * Parameters bind through ClickHouse's `{name:Type}` syntax — nothing
   * user-supplied is ever concatenated into SQL.
   */
  async query<T>(sql: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const started = Date.now();
    try {
      const result = await this.reader.query({
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

  async ping(): Promise<boolean> {
    try {
      await this.query('SELECT 1 AS ok');
      return true;
    } catch {
      return false;
    }
  }
}
