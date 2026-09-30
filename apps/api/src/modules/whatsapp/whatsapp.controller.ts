import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UnauthorizedException, Logger } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentActor, Public, RawResponse, RequirePermissions, SkipCsrf, TenantId } from '../../common/decorators';
import type { Actor, AppRequest } from '../../common/auth-context';
import { zBody, ZodPipe } from '../../common/zod.pipe';
import { accountSchema, accountUpdateSchema, templateSchema, WhatsAppService } from './whatsapp.service';
import { WhatsAppWebhookService } from './webhook.service';

const uuid = new ParseUUIDPipe();
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  accountId: z.string().uuid().optional(),
  status: z.enum(['RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED']).optional(),
});

@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  @Get('accounts')
  @RequirePermissions('whatsapp.view')
  accounts(@TenantId() tenantId: string) {
    return this.whatsapp.listAccounts(tenantId);
  }

  @Post('accounts')
  @RequirePermissions('whatsapp.manage')
  create(@CurrentActor() actor: Actor, @Body(zBody(accountSchema)) body: z.infer<typeof accountSchema>) {
    return this.whatsapp.createAccount(actor, body);
  }

  @Post('accounts/import-env')
  @RequirePermissions('whatsapp.manage')
  importEnv(@CurrentActor() actor: Actor) {
    return this.whatsapp.importFromEnvironment(actor);
  }

  @Patch('accounts/:id')
  @RequirePermissions('whatsapp.manage')
  update(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(accountUpdateSchema)) body: z.infer<typeof accountUpdateSchema>) {
    return this.whatsapp.updateAccount(actor, id, body);
  }

  @Post('accounts/:id/verify')
  @RequirePermissions('whatsapp.manage')
  verify(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.whatsapp.verify(actor, id);
  }

  @Post('accounts/:id/rotate-verify-token')
  @RequirePermissions('whatsapp.manage')
  rotate(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.whatsapp.regenerateVerifyToken(actor, id);
  }

  @Delete('accounts/:id')
  @RequirePermissions('whatsapp.manage')
  remove(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.whatsapp.removeAccount(actor, id);
  }

  @Get('templates')
  @RequirePermissions('conversations.view')
  templates(@TenantId() tenantId: string, @Query('accountId') accountId?: string) {
    return this.whatsapp.listTemplates(tenantId, accountId && /^[0-9a-f-]{36}$/i.test(accountId) ? accountId : undefined);
  }

  @Post('templates')
  @RequirePermissions('whatsapp.manage')
  createTemplate(@CurrentActor() actor: Actor, @Body(zBody(templateSchema)) body: z.infer<typeof templateSchema>) {
    return this.whatsapp.createTemplate(actor, body);
  }

  @Post('accounts/:id/sync-templates')
  @RequirePermissions('whatsapp.manage')
  sync(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.whatsapp.syncTemplates(actor, id);
  }

  @Delete('templates/:id')
  @RequirePermissions('whatsapp.manage')
  deleteTemplate(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.whatsapp.deleteTemplate(actor, id);
  }

  @Get('contacts')
  @RequirePermissions('whatsapp.view')
  contacts(@TenantId() tenantId: string, @Query(new ZodPipe(pageQuery)) q: z.infer<typeof pageQuery>) {
    return this.whatsapp.listContacts(tenantId, q);
  }

  @Get('webhook-events')
  @RequirePermissions('whatsapp.view')
  events(@TenantId() tenantId: string, @Query(new ZodPipe(pageQuery)) q: z.infer<typeof pageQuery>) {
    return this.whatsapp.webhookEvents(tenantId, q);
  }
}

/** Public endpoint registered in the Meta developer console. */
@Controller('webhooks/whatsapp')
@Public()
@SkipCsrf()
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(private readonly webhooks: WhatsAppWebhookService) {}

  @Get()
  @RawResponse()
  async verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response) {
    if (await this.webhooks.verifySubscription(mode, token)) {
      res.status(200).type('text/plain').send(String(challenge ?? '').replace(/[^\w-]/g, '').slice(0, 200));
      return;
    }
    res.status(403).type('text/plain').send('Verification failed');
  }

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async receive(@Req() req: AppRequest, @Headers('x-hub-signature-256') signature?: string) {
    const verdict = await this.webhooks.receive(req.rawBody, signature);
    if (!verdict.ok) {
      this.logger.warn(`Rejected WhatsApp webhook: ${verdict.reason}`);
      throw new UnauthorizedException({ code: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed' });
    }
    return { received: true };
  }
}
