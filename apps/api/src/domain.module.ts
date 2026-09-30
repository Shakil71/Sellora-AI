import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from './prisma/prisma.service';
import { RedisModule } from './redis/redis.service';
import { QueueModule } from './queue/queue.module';
import { RealtimeCoreModule } from './modules/realtime/realtime.service';
import { MailModule } from './modules/mail/mail.service';
import { StorageModule } from './modules/storage/storage.service';
import { AuditService } from './modules/audit/audit.service';
import { AccessService } from './modules/auth/access.service';
import { TokenService } from './modules/auth/token.service';
import { AuthService } from './modules/auth/auth.service';
import { ApiKeysService } from './modules/api-keys/api-keys.service';
import { UsageService } from './modules/billing/usage.service';
import { BillingService } from './modules/billing/billing.service';
import { NotificationsService } from './modules/notifications/notifications.service';
import { TenantsService } from './modules/tenants/tenants.service';
import { TeamService } from './modules/team/team.service';
import { UploadsService } from './modules/storage/uploads.service';
import { DOMAIN_PROVIDERS } from './domain.providers';

/**
 * All business services, shared by the HTTP API and the background worker.
 * Controllers live in ApiModule so the worker never exposes HTTP routes.
 */
@Global()
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    QueueModule,
    RealtimeCoreModule,
    MailModule,
    StorageModule,
    JwtModule.register({}),
  ],
  providers: [
    AuditService,
    AccessService,
    TokenService,
    AuthService,
    ApiKeysService,
    UsageService,
    BillingService,
    NotificationsService,
    TenantsService,
    TeamService,
    UploadsService,
    ...DOMAIN_PROVIDERS,
  ],
  exports: [
    JwtModule,
    AuditService,
    AccessService,
    TokenService,
    AuthService,
    ApiKeysService,
    UsageService,
    BillingService,
    NotificationsService,
    TenantsService,
    TeamService,
    UploadsService,
    ...DOMAIN_PROVIDERS,
  ],
})
export class DomainModule {}
