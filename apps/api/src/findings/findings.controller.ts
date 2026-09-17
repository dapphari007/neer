import { Controller, Get, Query, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { FindingsService } from './findings.service';
import { envelope } from '../common/meta';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

/**
 * Query contract for the findings endpoint.
 *
 * `limit` is coerced and capped here rather than trusted. An uncapped limit from
 * a query string is an invitation to ask for every finding ever recorded in one
 * request.
 */
const FindingsQuerySchema = z.object({
  siteId: z.string().max(64).optional(),
  domain: z
    .enum(['ecological', 'pressure', 'human_health', 'animal_health', 'data_quality'])
    .optional(),
  minSeverity: z.enum(['info', 'watch', 'elevated', 'high']).default('watch'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
type FindingsQueryDto = z.infer<typeof FindingsQuerySchema>;

@ApiTags('findings')
@Controller('api')
export class FindingsController {
  constructor(private readonly findings: FindingsService) {}

  @Get('findings')
  @ApiOperation({ summary: 'Active One Health findings, ranked by severity then confidence' })
  @UsePipes(new ZodValidationPipe(FindingsQuerySchema))
  async list(@Query() query: FindingsQueryDto) {
    return envelope(await this.findings.listFindings(query));
  }

  @Get('rules')
  @ApiOperation({ summary: 'The rule catalogue — every rule, its rationale and its citations' })
  rules() {
    return envelope(this.findings.listRules());
  }
}
