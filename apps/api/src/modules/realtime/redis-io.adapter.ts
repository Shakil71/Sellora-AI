import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { ServerOptions } from 'socket.io';
import { createRedisConnection } from '../../redis/redis.service';
import { env } from '../../config/env';

/** Socket.IO adapter backed by Redis so events work across processes and instances. */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const pubClient = createRedisConnection();
    const subClient = pubClient.duplicate();
    pubClient.on('error', (e) => this.logger.warn(`Socket pub error: ${e.message}`));
    subClient.on('error', (e) => this.logger.warn(`Socket sub error: ${e.message}`));
    this.adapterConstructor = createAdapter(pubClient, subClient, { key: 'sellora-socket' });
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
    const server = super.createIOServer(port, {
      ...options,
      path: '/socket.io',
      cors: { origin: origins, credentials: true },
      serveClient: false,
    });
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
