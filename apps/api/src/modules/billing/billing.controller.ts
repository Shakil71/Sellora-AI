import { Body, Controller, Get, Headers, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { PLAN_KEYS } from '@sellora/shared';
import { Auth, CurrentActor, Public, RequirePermissions, SkipCsrf, TenantId } from '../../common/decorators';
import type { Actor, AppRequest, AuthContext } from '../../common/auth-context';
import { zBody } from '../../common/zod.pipe';
import { BillingService } from './billing.service';
import { UsageService } from './usage.service';

const changePlanSchema = z.object({ plan: z.enum(PLAN_KEYS) });

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly usage: UsageService,
  ) {}

  @Get('plans')
  @Public()
  plans() {
    return this.billing.plans();
  }

  @Get()
  @RequirePermissions('billing.view')
  overview(@TenantId() tenantId: string) {
    return this.billing.overview(tenantId);
  }

  /** Lightweight usage summary for in-app limit warnings (any member). */
  @Get('usage')
  usageSummary(@TenantId() tenantId: string) {
    return this.usage.summary(tenantId);
  }

  @Post('change-plan')
  @RequirePermissions('billing.manage')
  changePlan(
    @CurrentActor() actor: Actor,
    @Auth() auth: AuthContext,
    @Body(zBody(changePlanSchema)) body: z.infer<typeof changePlanSchema>,
  ) {
    return this.billing.changePlan(actor, body.plan, auth.email ?? '');
  }

  /** Provider webhooks (signature verified by the provider implementation). */
  @Post('webhooks/:provider')
  @Public()
  @SkipCsrf()
  webhook(@Param('provider') provider: string, @Req() req: AppRequest, @Headers() headers: Record<string, string>) {
    return this.billing.handleWebhook(provider, req.rawBody ?? Buffer.from(''), headers);
  }
}
