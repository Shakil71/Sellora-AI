import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { loadEnv } from './config/env';
import { WorkerModule } from './worker.module';

/**
 * Background worker process: consumes BullMQ queues (WhatsApp, AI, documents,
 * automation, notifications, analytics). Runs separately from the HTTP API.
 */
async function bootstrap() {
  loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('Sellora AI worker started', 'Worker');
}

bootstrap().catch((err) => {
  console.error('Failed to start Sellora AI worker:', err instanceof Error ? err.message : err);
  process.exit(1);
});
