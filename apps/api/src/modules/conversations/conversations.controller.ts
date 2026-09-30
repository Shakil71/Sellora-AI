import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Auth, CurrentActor, RawResponse, RequirePermissions, TenantId } from '../../common/decorators';
import type { Actor, AuthContext } from '../../common/auth-context';
import { zBody, ZodPipe } from '../../common/zod.pipe';
import {
  assignSchema,
  conversationListSchema,
  ConversationsService,
  conversationUpdateSchema,
  handlerSchema,
  statusSchema,
} from './conversations.service';
import { MessagingService, sendMessageSchema } from './messaging.service';
import { InboundService } from './inbound.service';
import { MediaService } from './media.service';

const uuid = new ParseUUIDPipe();
const messagesQuery = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const testSchema = z.object({ customerName: z.string().trim().min(1).max(80).default('Test customer'), agentId: z.string().uuid().optional() });
const simulateSchema = z.object({ text: z.string().trim().min(1).max(2000) });

@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly messaging: MessagingService,
    private readonly inbound: InboundService,
    private readonly media: MediaService,
  ) {}

  @Get()
  @RequirePermissions('conversations.view')
  list(@TenantId() tenantId: string, @Auth() auth: AuthContext, @Query(new ZodPipe(conversationListSchema)) q: z.infer<typeof conversationListSchema>) {
    return this.conversations.list(tenantId, auth.userId, q);
  }

  @Get('counts')
  @RequirePermissions('conversations.view')
  counts(@TenantId() tenantId: string, @Auth() auth: AuthContext) {
    return this.conversations.counts(tenantId, auth.userId);
  }

  @Post('test')
  @RequirePermissions('conversations.reply', 'contacts.create')
  createTest(@CurrentActor() actor: Actor, @Body(zBody(testSchema)) body: z.infer<typeof testSchema>) {
    return this.conversations.createTestConversation(actor, body);
  }

  @Get(':id')
  @RequirePermissions('conversations.view')
  get(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.conversations.get(tenantId, id);
  }

  @Get(':id/messages')
  @RequirePermissions('conversations.view')
  messages(@TenantId() tenantId: string, @Param('id', uuid) id: string, @Query(new ZodPipe(messagesQuery)) q: z.infer<typeof messagesQuery>) {
    return this.conversations.messages(tenantId, id, q);
  }

  @Get(':id/messages/:messageId/media')
  @RequirePermissions('conversations.view')
  @RawResponse()
  async mediaFile(@TenantId() tenantId: string, @Param('id', uuid) id: string, @Param('messageId', uuid) messageId: string, @Res() res: Response) {
    const file = await this.media.resolve(tenantId, id, messageId);
    if (file.redirect) {
      res.redirect(302, file.redirect);
      return;
    }
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`);
    res.send(file.buffer);
  }

  @Post(':id/messages')
  @RequirePermissions('conversations.reply')
  send(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(sendMessageSchema)) body: z.infer<typeof sendMessageSchema>) {
    return this.messaging.sendFromAgent(actor, id, body);
  }

  @Post(':id/messages/:messageId/retry')
  @RequirePermissions('conversations.reply')
  retry(@CurrentActor() actor: Actor, @Param('messageId', uuid) messageId: string) {
    return this.messaging.retry(actor, messageId);
  }

  @Post(':id/simulate')
  @RequirePermissions('conversations.reply')
  simulate(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(simulateSchema)) body: z.infer<typeof simulateSchema>) {
    return this.inbound.simulateInbound(actor, id, body.text);
  }

  @Post(':id/read')
  @RequirePermissions('conversations.view')
  read(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.conversations.markRead(tenantId, id);
  }

  @Post(':id/assign')
  @RequirePermissions('conversations.assign')
  assign(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(assignSchema)) body: z.infer<typeof assignSchema>) {
    return this.conversations.assign(actor, id, body);
  }

  @Post(':id/handler')
  @RequirePermissions('conversations.reply')
  handler(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(handlerSchema)) body: z.infer<typeof handlerSchema>) {
    return this.conversations.setHandler(actor, id, body);
  }

  @Post(':id/status')
  @RequirePermissions('conversations.close')
  status(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(statusSchema)) body: z.infer<typeof statusSchema>) {
    return this.conversations.setStatus(actor, id, body.status);
  }

  @Patch(':id')
  @RequirePermissions('conversations.reply')
  update(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(conversationUpdateSchema)) body: z.infer<typeof conversationUpdateSchema>) {
    return this.conversations.update(actor, id, body);
  }
}
