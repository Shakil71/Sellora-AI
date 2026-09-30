import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public, RawResponse } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { StorageService } from '../storage/storage.service';
import { QueueService } from '../../queue/queue.module';

const startedAt = Date.now();
const version = process.env.npm_package_version ?? '1.0.0';

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

/** Liveness and readiness probes (excluded from the /api/v1 prefix). */
@Controller('health')
@Public()
@RawResponse()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly queues: QueueService,
  ) {}

  @Get()
  health() {
    return { status: 'ok', service: 'sellora-api', version, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) };
  }

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res() res: Response) {
    const [database, redis, storage] = await Promise.all([
      withTimeout(this.prisma.isHealthy(), 3000, false),
      withTimeout(this.redis.isHealthy(), 3000, false),
      withTimeout(this.storage.provider.isHealthy(), 3000, false),
    ]);
    let workers: number | null = null;
    try {
      workers = (await withTimeout(this.queues.whatsapp.getWorkers(), 2000, [])).length;
    } catch {
      workers = null;
    }
    const ok = database && redis;
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      status: ok ? 'ready' : 'unavailable',
      checks: {
        database: database ? 'up' : 'down',
        redis: redis ? 'up' : 'down',
        storage: storage ? 'up' : 'down',
        worker: workers === null ? 'unknown' : workers > 0 ? 'up' : 'down',
      },
      timestamp: new Date().toISOString(),
    });
  }
}
