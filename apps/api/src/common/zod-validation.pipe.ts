import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Validate request input against a Zod schema.
 *
 * Nest's stock `ValidationPipe` wants `class-validator` and decorated DTO
 * classes. This project already defines every contract as a Zod schema in
 * `@neer/shared`, shared by the API and the dashboard, so adopting
 * class-validator would mean two validation libraries describing the same
 * shapes — and inevitably drifting apart.
 *
 * Using the shared schemas here means a contract change fails at compile time
 * on both sides of the wire, rather than passing validation on the server and
 * breaking silently in the browser.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      // Report every failing field at once. Returning only the first turns a
      // malformed request into a round trip per mistake.
      throw new BadRequestException(
        result.error.issues.map((issue) =>
          issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
        ),
      );
    }

    return result.data;
  }
}
