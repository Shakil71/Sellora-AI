import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, All } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentActor, Public, RawResponse, RequirePermissions, SkipCsrf, TenantId } from '../../common/decorators';
import type { Actor, AppRequest } from '../../common/auth-context';
import { zBody } from '../../common/zod.pipe';
import { env } from '../../config/env';
import { PaymentsService } from '../commerce/payments.service';
import { createPaymentMethodSchema, PaymentMethodsService, updatePaymentMethodSchema } from './payment-methods.service';

const uuid = new ParseUUIDPipe();

/** Setup of the payment methods a workspace accepts (gateways, local wallets, bank transfer…). */
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly methods: PaymentMethodsService) {}

  /** Gateways and one-click presets the owner can choose from. */
  @Get('catalog')
  @RequirePermissions('integrations.view')
  catalog() {
    return this.methods.catalog();
  }

  @Get()
  @RequirePermissions('integrations.view')
  list(@TenantId() tenantId: string) {
    return this.methods.list(tenantId);
  }

  @Post()
  @RequirePermissions('integrations.manage')
  create(@CurrentActor() actor: Actor, @Body(zBody(createPaymentMethodSchema)) body: z.infer<typeof createPaymentMethodSchema>) {
    return this.methods.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('integrations.manage')
  update(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(updatePaymentMethodSchema)) body: z.infer<typeof updatePaymentMethodSchema>) {
    return this.methods.update(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions('integrations.manage')
  remove(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.methods.remove(actor, id);
  }

  @Post(':id/test')
  @HttpCode(200)
  @RequirePermissions('integrations.manage')
  test(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.methods.test(actor, id);
  }
}

const OUTCOMES = ['success', 'cancelled', 'failed'];

/** Public endpoints used by payment gateways: notifications and the customer's return trip. */
@Controller('payment-gateways')
export class PaymentGatewaysPublicController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('webhooks/:token')
  @Public()
  @SkipCsrf()
  @HttpCode(200)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  webhook(@Param('token') token: string, @Req() req: AppRequest, @Headers() headers: Record<string, string>) {
    return this.payments.handleGatewayWebhook(token.slice(0, 80), req.rawBody ?? Buffer.from(''), headers);
  }

  /**
   * Where gateways send the customer after paying. Some gateways POST here, so
   * every method redirects to a plain page. Nothing is trusted from this request:
   * payments are only confirmed by the verified webhook.
   */
  @All('return')
  @Public()
  @SkipCsrf()
  @RawResponse()
  complete(@Query('outcome') outcome: string, @Res() res: Response) {
    const status = OUTCOMES.includes(outcome) ? outcome : 'success';
    res.redirect(303, `${env.APP_URL}/pay/complete?status=${status}`);
  }
}
