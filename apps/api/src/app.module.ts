import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { DomainModule } from './domain.module';
import { API_CONTROLLERS } from './api.controllers';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ResponseInterceptor } from './common/response.interceptor';
import { AuthGuard, CsrfGuard, PermissionsGuard } from './common/guards';
import { RedisThrottlerStorage } from './common/redis-throttler.storage';
import { RealtimeGateway } from './modules/realtime/realtime.gateway';
import { PermissionSyncService } from './modules/tenants/tenants.service';
import { loggerOptions } from './common/logger';
import { env } from './config/env';
import { RedisService } from './redis/redis.service';
import { API_EXTRA_PROVIDERS } from './api.providers';

@Module({
  imports: [
    LoggerModule.forRoot(loggerOptions('sellora-api')),
    DomainModule,
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ name: 'default', ttl: env.RATE_LIMIT_TTL_SECONDS * 1000, limit: env.RATE_LIMIT_MAX }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
  ],
  controllers: API_CONTROLLERS,
  providers: [
    RealtimeGateway,
    PermissionSyncService,
    ...API_EXTRA_PROVIDERS,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    // Order matters: rate limit → authenticate → CSRF → permissions
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(_consumer: MiddlewareConsumer) {
    /* request ids are assigned by pino-http (see common/logger.ts) */
  }
}
