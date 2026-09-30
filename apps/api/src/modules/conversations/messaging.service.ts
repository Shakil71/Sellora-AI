import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ChannelType,
  ConversationHandler,
  ConversationStatus,
  MessageDirection,
  MessageSenderType,
  MessageStatus,
  MessageType,
  Prisma,
} from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService, REALTIME_EVENTS } from '../realtime/realtime.service';
import { QueueService } from '../../queue/queue.module';
import { UsageService } from '../billing/usage.service';
import { ChannelsService } from '../channels/channels.service';
import { ChannelSendError, ChannelTarget, OutboundPayload } from '../channels/channel.types';
import { OrdersService } from '../commerce/orders.service';
import { AuditService } from '../audit/audit.service';
import { ensureFound, ValidationError } from '../../common/errors';
import { truncate } from '../../common/utils/text.util';
import type { Actor } from '../../common/auth-context';

export const sendMessageSchema = z
  .object({
    text: z.string().trim().max(4096).optional(),
    note: z.boolean().default(false),
    attachment: z
      .object({ url: z.string().url().max(1000), mimeType: z.string().max(100), fileName: z.string().max(200).optional() })
      .optional(),
    template: z
      .object({ name: z.string().max(512), language: z.string().max(10), components: z.array(z.unknown()).max(10).optional() })
      .optional(),
  })
  .refine((v) => v.text || v.attachment || v.template, 'Type a message, attach a file or pick a template');

const MESSAGE_TYPE_BY_MIME = (mime: string): MessageType =>
  mime.startsWith('image/') ? MessageType.IMAGE : mime.startsWith('video/') ? MessageType.VIDEO : mime.startsWith('audio/') ? MessageType.AUDIO : MessageType.DOCUMENT;

const STATUS_RANK: Record<MessageStatus, number> = { RECEIVED: 0, PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

@Injectable()
export class MessagingService implements OnModuleInit {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly queues: QueueService,
    private readonly usage: UsageService,
    private readonly channels: ChannelsService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    // Lets order status updates notify customers over their channel.
    this.orders.registerMessenger({
      sendToCustomer: async (tenantId, customerId, text, conversationId) => {
        const conversation = conversationId
          ? await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId } })
          : await this.prisma.conversation.findFirst({ where: { tenantId, customerId }, orderBy: { lastMessageAt: 'desc' } });
        if (!conversation) return false;
        await this.queueOutbound(tenantId, conversation.id, { kind: 'text', text }, { senderType: MessageSenderType.SYSTEM });
        return true;
      },
    });
  }

  emitMessage(tenantId: string, conversationId: string, message: unknown) {
    this.realtime.toConversation(conversationId, REALTIME_EVENTS.MESSAGE_NEW, message);
    this.realtime.toPermission(tenantId, 'conversations.view', REALTIME_EVENTS.MESSAGE_NEW, { conversationId, message });
  }

  /** Creates an outbound message in PENDING state and queues delivery. */
  async queueOutbound(
    tenantId: string,
    conversationId: string,
    payload: OutboundPayload,
    sender: { senderType: MessageSenderType; userId?: string | null; aiAgentId?: string | null },
  ) {
    const conversation = ensureFound(await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId } }), 'Conversation');
    if (!(await this.usage.hasCapacity(tenantId, 'whatsappMessages')) && conversation.channel === ChannelType.WHATSAPP) {
      throw new ValidationError('Your plan limit for WhatsApp messages this month has been reached. Upgrade to continue sending.');
    }
    const type = payload.kind === 'template' ? MessageType.TEMPLATE : payload.kind === 'media' && payload.media ? MESSAGE_TYPE_BY_MIME(payload.media.mimeType) : MessageType.TEXT;
    const body = payload.kind === 'template' ? `Template: ${payload.template?.name}` : (payload.text ?? payload.media?.caption ?? null);
    const message = await this.prisma.message.create({
      data: {
        tenantId,
        conversationId,
        direction: MessageDirection.OUTBOUND,
        senderType: sender.senderType,
        senderUserId: sender.userId ?? null,
        aiAgentId: sender.aiAgentId ?? null,
        type,
        body,
        mediaUrl: payload.media?.url,
        mediaMimeType: payload.media?.mimeType,
        mediaFileName: payload.media?.fileName,
        templateName: payload.template?.name,
        status: MessageStatus.PENDING,
        metadata: { payload } as unknown as Prisma.InputJsonValue,
      },
      include: { senderUser: { select: { id: true, name: true, avatarUrl: true } } },
    });
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: message.createdAt,
        lastMessagePreview: truncate(body ?? '[attachment]', 160),
        ...(sender.senderType !== MessageSenderType.SYSTEM && !conversation.firstResponseAt ? { firstResponseAt: new Date() } : {}),
        ...(conversation.status === ConversationStatus.PENDING ? { status: ConversationStatus.OPEN } : {}),
      },
    });
    this.emitMessage(tenantId, conversationId, message);
    await this.queues.sendMessage(tenantId, message.id);
    return message;
  }

  /** Agent reply or internal note from the inbox. Replying takes the conversation over from AI. */
  async sendFromAgent(actor: Actor, conversationId: string, input: z.infer<typeof sendMessageSchema>) {
    const conversation = ensureFound(await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId: actor.tenantId } }), 'Conversation');
    if (input.note) {
      if (!input.text) throw new ValidationError('Notes need text');
      const note = await this.prisma.message.create({
        data: {
          tenantId: actor.tenantId,
          conversationId,
          direction: MessageDirection.OUTBOUND,
          senderType: MessageSenderType.AGENT,
          senderUserId: actor.userId,
          type: MessageType.NOTE,
          body: input.text,
          status: MessageStatus.SENT,
        },
        include: { senderUser: { select: { id: true, name: true, avatarUrl: true } } },
      });
      this.emitMessage(actor.tenantId, conversationId, note);
      return note;
    }
    const channel = this.channels.get(conversation.channel);
    const windowOpen =
      channel.customerServiceWindowMs === null ||
      (conversation.lastInboundAt !== null && Date.now() - conversation.lastInboundAt.getTime() < channel.customerServiceWindowMs);
    if (!windowOpen && !input.template) {
      throw new ValidationError(
        conversation.channel === ChannelType.WHATSAPP
          ? 'The 24-hour customer service window has closed. Send an approved template to restart the conversation.'
          : `The 24-hour messaging window on ${channel.label} has closed. You can reply after the customer messages you again.`,
      );
    }
    if (input.template && conversation.channel !== ChannelType.WHATSAPP) throw new ValidationError('Templates are only available on WhatsApp.');
    const payload: OutboundPayload = input.template
      ? { kind: 'template', template: input.template }
      : input.attachment
        ? { kind: 'media', media: { ...input.attachment, caption: input.text } }
        : { kind: 'text', text: input.text };
    if (conversation.handler === ConversationHandler.AI) {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { handler: ConversationHandler.HUMAN, assignedUserId: conversation.assignedUserId ?? actor.userId, handoffAt: new Date(), handoffReason: 'Agent replied' },
      });
      this.realtime.toPermission(actor.tenantId, 'conversations.view', REALTIME_EVENTS.CONVERSATION_UPDATED, { id: conversationId, handler: 'HUMAN' });
    }
    return this.queueOutbound(actor.tenantId, conversationId, payload, { senderType: MessageSenderType.AGENT, userId: actor.userId });
  }

  /** Delivers a queued message through its channel (worker). Throws on retryable errors. */
  async deliver(tenantId: string, messageId: string) {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, tenantId },
      include: { conversation: { include: { contact: true, customer: true, channelContact: true } } },
    });
    if (!message || message.status !== MessageStatus.PENDING) return;
    const conv = message.conversation;
    const payload = ((message.metadata as { payload?: OutboundPayload } | null)?.payload ?? { kind: 'text', text: message.body ?? '' }) as OutboundPayload;
    const target: ChannelTarget = {
      tenantId,
      conversationId: conv.id,
      channel: conv.channel,
      whatsappAccountId: conv.whatsappAccountId,
      channelConnectionId: conv.channelConnectionId,
      recipient:
        conv.channel === ChannelType.WHATSAPP || conv.channel === ChannelType.TEST
          ? (conv.contact?.waId ?? conv.customer.whatsappNumber?.replace(/^\+/, '') ?? null)
          : (conv.channelContact?.externalUserId ?? null),
    };
    try {
      const channel = this.channels.get(conv.channel);
      if (payload.kind !== 'template' && channel.customerServiceWindowMs !== null) {
        const open = conv.lastInboundAt && Date.now() - conv.lastInboundAt.getTime() < channel.customerServiceWindowMs;
        if (!open) throw new ChannelSendError('Outside the 24-hour customer service window. Use an approved template.', 'WINDOW_CLOSED', false);
      }
      const result = await channel.send(target, payload);
      const updated = await this.prisma.message.update({
        where: { id: message.id },
        data: { status: MessageStatus.SENT, externalId: result.externalId, sentAt: new Date(), errorCode: null, errorMessage: null },
      });
      if (conv.channel === ChannelType.WHATSAPP) await this.usage.increment(tenantId, 'whatsappMessages');
      this.emitStatus(tenantId, conv.id, updated.id, updated.status, { externalId: updated.externalId });
    } catch (err) {
      const e = err instanceof ChannelSendError ? err : new ChannelSendError((err as Error).message, 'UNKNOWN', true);
      if (e.retryable) {
        this.logger.warn(`Delivery of ${message.id} failed, will retry: ${e.message}`);
        throw e;
      }
      await this.markFailed(tenantId, message.id, e.code, e.message);
    }
  }

  async markFailed(tenantId: string, messageId: string, code: string, reason: string) {
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.FAILED, failedAt: new Date(), errorCode: code.slice(0, 50), errorMessage: reason.slice(0, 500) },
    });
    this.emitStatus(tenantId, updated.conversationId, updated.id, updated.status, { errorMessage: updated.errorMessage });
  }

  emitStatus(tenantId: string, conversationId: string, messageId: string, status: MessageStatus, extra: Record<string, unknown> = {}) {
    const payload = { conversationId, messageId, status, ...extra };
    this.realtime.toConversation(conversationId, REALTIME_EVENTS.MESSAGE_STATUS, payload);
    this.realtime.toPermission(tenantId, 'conversations.view', REALTIME_EVENTS.MESSAGE_STATUS, payload);
  }

  /** Applies a delivery receipt; statuses only move forward (sent → delivered → read). */
  async applyStatus(tenantId: string, externalId: string, status: MessageStatus, at: Date, error?: { code?: string; title?: string }) {
    const message = await this.prisma.message.findUnique({ where: { tenantId_externalId: { tenantId, externalId } } });
    if (!message) return;
    if (status !== MessageStatus.FAILED && STATUS_RANK[status] <= STATUS_RANK[message.status]) return;
    const data: Prisma.MessageUpdateInput = { status };
    if (status === MessageStatus.DELIVERED) data.deliveredAt = at;
    if (status === MessageStatus.READ) {
      data.readAt = at;
      data.deliveredAt = message.deliveredAt ?? at;
    }
    if (status === MessageStatus.FAILED) {
      data.failedAt = at;
      data.errorCode = error?.code?.slice(0, 50);
      data.errorMessage = error?.title?.slice(0, 500);
    }
    await this.prisma.message.update({ where: { id: message.id }, data });
    this.emitStatus(tenantId, message.conversationId, message.id, status, status === MessageStatus.FAILED ? { errorMessage: error?.title } : {});
  }

  async retry(actor: Actor, messageId: string) {
    const message = ensureFound(await this.prisma.message.findFirst({ where: { id: messageId, tenantId: actor.tenantId } }), 'Message');
    if (message.status !== MessageStatus.FAILED) throw new ValidationError('Only failed messages can be retried.');
    await this.prisma.message.update({ where: { id: messageId }, data: { status: MessageStatus.PENDING, errorCode: null, errorMessage: null, failedAt: null } });
    await this.queues.sendMessage(actor.tenantId, messageId);
    await this.audit.log(actor, { action: 'message.retry', entityType: 'Message', entityId: messageId });
    this.emitStatus(actor.tenantId, message.conversationId, messageId, MessageStatus.PENDING);
    return { retried: true };
  }
}
