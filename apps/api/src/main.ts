import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { loadEnv } from './config/env';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Keep the raw body for webhook signature verification (WhatsApp, Stripe).
    rawBody: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  configureApp(app, env);

  const ioAdapter = new RedisIoAdapter(app);
  await ioAdapter.connectToRedis();
  app.useWebSocketAdapter(ioAdapter);

  await app.listen(env.API_PORT, '0.0.0.0');
  app.get(Logger).log(`Sellora AI API listening on port ${env.API_PORT}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  console.error('Failed to start Sellora AI API:', err instanceof Error ? err.message : err);
  process.exit(1);
});
