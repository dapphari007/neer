import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });

  // The CSV importer takes the file as the request body. Nest's default parsers
  // handle JSON and form bodies only; text/csv needs its own, with a ceiling so
  // an accidental multi-gigabyte upload cannot exhaust the process. Registered
  // through Nest rather than by importing express directly: express is a
  // transitive dependency here, and pnpm's strict layout will not resolve it
  // from this package at runtime even though its types are visible at build.
  app.useBodyParser('text', { type: ['text/csv', 'text/plain'], limit: '10mb' });

  app.useGlobalFilters(new AllExceptionsFilter());

  // No global validation pipe: request shapes are validated per route with
  // ZodValidationPipe against the same schemas in @neer/shared that the
  // dashboard compiles against. Nest's ValidationPipe would pull in
  // class-validator and give this project two validation libraries describing
  // the same contracts, which is one more than can stay in agreement.

  // Allow-list rather than wildcard. The dashboard's origin is known at deploy
  // time, and `*` would let any page on the internet read this API from a
  // visitor's browser.
  const corsOrigins = (process.env.API_CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: false,
  });

  /**
   * OpenAPI at /api/docs.
   *
   * Published rather than kept internal because a public-interest environmental
   * dataset that cannot be consumed programmatically is only half published.
   * The API is read-only, so there is nothing here to protect by hiding it.
   */
  const config = new DocumentBuilder()
    .setTitle('Neer API')
    .setDescription(
      'Stream One Health Index for urban freshwater. Reads everything; accepts observations at POST /api/observations; streams changes at GET /api/events.\n\n' +
        'Every response carries a `meta.dataDisclosure` block stating which parts of the ' +
        'payload are real measurements and which are modelled. Citizen observations in this ' +
        'deployment are simulated; weather and hydrology are real.',
    )
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  const port = Number(process.env.API_PORT ?? 3000);
  // Bind all interfaces. Binding loopback would make the service unreachable
  // from outside its container — the same trap the ClickHouse image sets.
  await app.listen(port, '0.0.0.0');

  logger.log(`Neer API listening on port ${port}`);
  logger.log(`OpenAPI docs at http://localhost:${port}/api/docs`);
  logger.log(`CORS origins: ${corsOrigins.join(', ')}`);
}

void bootstrap();
