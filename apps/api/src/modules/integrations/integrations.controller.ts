import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ChannelType } from '@prisma/client';
import { z } from 'zod';
import {
  CurrentActor,
  Public,
  RawResponse,
  RequirePermissions,
  SkipCsrf,
  TenantId,
} from '../../common/decorators';
import type { Actor, AppRequest } from '../../common/auth-context';
import { zBody, ZodPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { env } from '../../config/env';
import {
  ChannelConnectionsService,
  createMetaSchema,
  createWebChatSchema,
  updateConnectionSchema,
} from './channel-connections.service';
import {
  deliveryListSchema,
  endpointSchema,
  endpointUpdateSchema,
  WebhooksService,
} from './webhooks.service';
import { visitorMessageSchema, visitorProfileSchema, WebChatService } from './webchat.service';
import { MetaWebhookService } from './meta-webhook.service';

const uuid = new ParseUUIDPipe();
const channelQuery = z.object({
  type: z.enum([ChannelType.WEB_CHAT, ChannelType.MESSENGER, ChannelType.INSTAGRAM]).optional(),
});
const widgetKey = (key: string) => (/^wc_[0-9a-f]{24}$/.test(key) ? key : 'invalid');

/** Channels, webhooks and API overview for the Integrations area. */
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly channels: ChannelConnectionsService,
    private readonly webhooks: WebhooksService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('overview')
  @RequirePermissions('integrations.view')
  async overview(@TenantId() tenantId: string) {
    const [whatsapp, connections, webhooks, apiKeys] = await Promise.all([
      this.prisma.whatsAppAccount.count({ where: { tenantId } }),
      this.prisma.channelConnection.groupBy({
        by: ['type'],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.webhookEndpoint.count({ where: { tenantId } }),
      this.prisma.apiKey.count({ where: { tenantId, revokedAt: null } }),
    ]);
    const byType = Object.fromEntries(connections.map((c) => [c.type, c._count._all]));
    return {
      counts: {
        whatsapp,
        webChat: byType.WEB_CHAT ?? 0,
        messenger: byType.MESSENGER ?? 0,
        instagram: byType.INSTAGRAM ?? 0,
        webhooks,
        apiKeys,
      },
      apiBaseUrl: `${env.API_URL}/api/v1`,
      metaWebhookUrl: `${env.API_URL}/api/v1/webhooks/meta`,
      widgetScriptUrl: `${env.APP_URL}/widget.js`,
    };
  }

  // Channels -------------------------------------------------------------------

  @Get('channels')
  @RequirePermissions('integrations.view')
  list(
    @TenantId() tenantId: string,
    @Query(new ZodPipe(channelQuery)) q: z.infer<typeof channelQuery>,
  ) {
    return this.channels.list(tenantId, q.type);
  }

  @Get('channels/:id')
  @RequirePermissions('integrations.view')
  get(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.channels.get(tenantId, id);
  }

  @Post('channels/web-chat')
  @RequirePermissions('integrations.manage')
  createWebChat(
    @CurrentActor() actor: Actor,
    @Body(zBody(createWebChatSchema)) body: z.infer<typeof createWebChatSchema>,
  ) {
    return this.channels.createWebChat(actor, body);
  }

  @Post('channels/meta')
  @RequirePermissions('integrations.manage')
  createMeta(
    @CurrentActor() actor: Actor,
    @Body(zBody(createMetaSchema)) body: z.infer<typeof createMetaSchema>,
  ) {
    return this.channels.createMeta(actor, body);
  }

  @Patch('channels/:id')
  @RequirePermissions('integrations.manage')
  update(
    @CurrentActor() actor: Actor,
    @Param('id', uuid) id: string,
    @Body(zBody(updateConnectionSchema)) body: z.infer<typeof updateConnectionSchema>,
  ) {
    return this.channels.update(actor, id, body);
  }

  @Post('channels/:id/verify')
  @RequirePermissions('integrations.manage')
  verify(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.channels.verify(actor, id);
  }

  @Post('channels/:id/rotate-verify-token')
  @RequirePermissions('integrations.manage')
  rotate(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.channels.rotateVerifyToken(actor, id);
  }

  @Delete('channels/:id')
  @RequirePermissions('integrations.manage')
  remove(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.channels.remove(actor, id);
  }

  // Outgoing webhooks -------------------------------------------------------------

  @Get('webhooks')
  @RequirePermissions('integrations.view')
  webhookList(@TenantId() tenantId: string) {
    return this.webhooks.list(tenantId);
  }

  @Post('webhooks')
  @RequirePermissions('integrations.manage')
  webhookCreate(
    @CurrentActor() actor: Actor,
    @Body(zBody(endpointSchema)) body: z.infer<typeof endpointSchema>,
  ) {
    return this.webhooks.create(actor, body);
  }

  @Get('webhooks/:id')
  @RequirePermissions('integrations.view')
  webhookGet(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.webhooks.get(tenantId, id);
  }

  @Patch('webhooks/:id')
  @RequirePermissions('integrations.manage')
  webhookUpdate(
    @CurrentActor() actor: Actor,
    @Param('id', uuid) id: string,
    @Body(zBody(endpointUpdateSchema)) body: z.infer<typeof endpointUpdateSchema>,
  ) {
    return this.webhooks.update(actor, id, body);
  }

  @Delete('webhooks/:id')
  @RequirePermissions('integrations.manage')
  webhookRemove(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.webhooks.remove(actor, id);
  }

  @Post('webhooks/:id/secret')
  @RequirePermissions('integrations.manage')
  webhookSecret(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.webhooks.revealSecret(actor, id);
  }

  @Post('webhooks/:id/roll-secret')
  @RequirePermissions('integrations.manage')
  webhookRoll(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.webhooks.rollSecret(actor, id);
  }

  @Post('webhooks/:id/test')
  @RequirePermissions('integrations.manage')
  webhookTest(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.webhooks.sendTest(actor, id);
  }

  @Get('webhooks/:id/deliveries')
  @RequirePermissions('integrations.view')
  webhookDeliveries(
    @TenantId() tenantId: string,
    @Param('id', uuid) id: string,
    @Query(new ZodPipe(deliveryListSchema)) q: z.infer<typeof deliveryListSchema>,
  ) {
    return this.webhooks.deliveries(tenantId, id, q);
  }

  @Post('webhooks/deliveries/:deliveryId/redeliver')
  @RequirePermissions('integrations.manage')
  webhookRedeliver(@CurrentActor() actor: Actor, @Param('deliveryId', uuid) deliveryId: string) {
    return this.webhooks.redeliver(actor, deliveryId);
  }
}

/**
 * Public endpoints used by the website chat widget. Visitors authenticate
 * with the signed token returned when their session starts.
 */
@Controller('public/webchat')
@Public()
@SkipCsrf()
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class WebChatPublicController {
  constructor(private readonly webchat: WebChatService) {}

  @Get(':key/config')
  config(@Param('key') key: string, @Headers('x-embed-origin') origin?: string) {
    return this.webchat.config(widgetKey(key), origin);
  }

  @Post(':key/sessions')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  start(
    @Param('key') key: string,
    @Body(zBody(visitorProfileSchema)) body: z.infer<typeof visitorProfileSchema>,
    @Headers('x-embed-origin') origin?: string,
  ) {
    return this.webchat.startSession(widgetKey(key), body, origin);
  }

  @Patch(':key/profile')
  profile(
    @Param('key') key: string,
    @Body(zBody(visitorProfileSchema)) body: z.infer<typeof visitorProfileSchema>,
    @Headers('x-visitor-token') token?: string,
    @Headers('x-embed-origin') origin?: string,
  ) {
    return this.webchat.updateProfile(widgetKey(key), token, body, origin);
  }

  @Get(':key/messages')
  messages(
    @Param('key') key: string,
    @Query('after') after?: string,
    @Headers('x-visitor-token') token?: string,
    @Headers('x-embed-origin') origin?: string,
  ) {
    return this.webchat.messages(widgetKey(key), token, after, origin);
  }

  @Post(':key/messages')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  send(
    @Param('key') key: string,
    @Body(zBody(visitorMessageSchema)) body: z.infer<typeof visitorMessageSchema>,
    @Headers('x-visitor-token') token?: string,
    @Headers('x-embed-origin') origin?: string,
  ) {
    return this.webchat.send(widgetKey(key), token, body.text, origin);
  }
}

/** Callback URL registered in the Meta app for Messenger and Instagram. */
@Controller('webhooks/meta')
@Public()
@SkipCsrf()
export class MetaWebhookController {
  private readonly logger = new Logger(MetaWebhookController.name);

  constructor(private readonly meta: MetaWebhookService) {}

  @Get()
  @RawResponse()
  async verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    if (await this.meta.verifySubscription(mode, token)) {
      res
        .status(200)
        .type('text/plain')
        .send(
          String(challenge ?? '')
            .replace(/[^\w-]/g, '')
            .slice(0, 200),
        );
      return;
    }
    res.status(403).type('text/plain').send('Verification failed');
  }

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async receive(@Req() req: AppRequest, @Headers('x-hub-signature-256') signature?: string) {
    const verdict = await this.meta.receive(req.rawBody, signature);
    if (!verdict.ok) {
      this.logger.warn(`Rejected Meta webhook: ${verdict.reason}`);
      throw new UnauthorizedException({
        code: 'INVALID_SIGNATURE',
        message: 'Webhook signature verification failed',
      });
    }
    return { received: true };
  }
}
