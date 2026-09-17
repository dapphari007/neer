import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Uniform error shape.
 *
 * Unexpected errors return a generic message to the client and log the detail
 * server-side. A ClickHouse exception can name tables, columns and query text;
 * echoing that to an unauthenticated caller hands them a schema map for free.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    if (!isHttp) {
      this.logger.error(
        `Unhandled error on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body = isHttp ? exception.getResponse() : null;
    const message =
      isHttp && typeof body === 'object' && body !== null && 'message' in body
        ? (body as { message: string | string[] }).message
        : isHttp
          ? exception.message
          : 'Internal server error';

    response.status(status).json({
      statusCode: status,
      error: HttpStatus[status] ?? 'Error',
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
