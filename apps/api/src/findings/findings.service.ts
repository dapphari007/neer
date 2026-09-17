import { Injectable } from '@nestjs/common';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { RULES } from '@neer/insights';

export interface FindingsQuery {
  siteId?: string;
  domain?: string;
  minSeverity?: 'info' | 'watch' | 'elevated' | 'high';
  limit?: number;
}

const SEVERITY_ORDER = ['info', 'watch', 'elevated', 'high'] as const;

/** Every severity at or above `minimum`, worst-inclusive. */
function severitiesAtLeast(minimum: string): string[] {
  const index = SEVERITY_ORDER.indexOf(minimum as (typeof SEVERITY_ORDER)[number]);
  return [...SEVERITY_ORDER.slice(index < 0 ? 1 : index)];
}

/**
 * Serves the deterministic findings produced by the batch rule pass.
 *
 * Findings are read, never recomputed per request. Evaluating rules at request
 * time would make identical queries return different answers as the clock moved,
 * and a health statement that changes between two page loads is not one anybody
 * can act on or cite.
 */
@Injectable()
export class FindingsService {
  constructor(private readonly clickhouse: ClickHouseService) {}

  async listFindings(query: FindingsQuery = {}) {
    // Filter by an explicit list of severity names rather than by converting the
    // enum to its ordinal.
    //
    // Two traps are avoided here. First, ClickHouse resolves SELECT aliases
    // inside WHERE, so `toString(severity) AS severity` in the projection makes a
    // later `toUInt8(severity)` operate on the label string, which fails with
    // "Cannot parse string 'elevated' as UInt8" — a message that points at the
    // parameter rather than at the shadowing that actually caused it. Second, an
    // explicit list does not silently change meaning if the enum's numeric
    // assignments are ever reordered.
    const severities = severitiesAtLeast(query.minSeverity ?? 'watch');

    return this.clickhouse.query(
      `
      SELECT
          finding_id                       AS findingId,
          site_id                          AS siteId,
          site_name                        AS siteName,
          catchment                        AS catchment,
          lat                              AS lat,
          lon                              AS lon,
          toString(day)                    AS day,
          rule_id                          AS ruleId,
          rule_version                     AS ruleVersion,
          toString(domain)                 AS domain,
          toString(severity)               AS severity,
          toString(confidence)             AS confidence,
          headline                         AS headline,
          mechanism                        AS mechanism,
          evidence                         AS evidence,
          metrics                          AS metrics,
          citations                        AS citations,
          action_citizen                   AS actionCitizen,
          action_municipal                 AS actionMunicipal,
          action_health                    AS actionHealth,
          toString(detected_at)            AS detectedAt,
          toString(valid_until)            AS validUntil
      FROM findings_active AS fa
      WHERE ({siteId:String} = '' OR fa.site_id = {siteId:String})
        AND ({domain:String} = '' OR toString(fa.domain) = {domain:String})
        AND toString(fa.severity) IN {severities:Array(String)}
      ORDER BY fa.rank_score DESC, fa.day DESC
      LIMIT {limit:UInt32}`,
      {
        siteId: query.siteId ?? '',
        domain: query.domain ?? '',
        severities,
        limit: Math.min(query.limit ?? 50, 200),
      },
    );
  }

  /**
   * The rule catalogue.
   *
   * Exposed as an endpoint because a system that makes public health statements
   * should let anyone read the logic behind them without cloning the repository.
   * Each entry carries its rationale and the standards its thresholds come from.
   */
  listRules() {
    return RULES.map((rule) => ({
      id: rule.id,
      version: rule.version,
      domain: rule.domain,
      title: rule.title,
      rationale: rule.rationale,
      citations: rule.citations,
    }));
  }
}
