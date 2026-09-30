import { Injectable, Logger } from '@nestjs/common';
import {
  ChannelType,
  Conversation,
  ConversationHandler,
  ConversationStatus,
  MessageDirection,
  MessageSenderType,
  MessageStatus,
  MessageType,
  NotificationType,
  Prisma,
  WebhookEventStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomersService } from '../crm/customers.service';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService, REALTIME_EVENTS } from '../realtime/realtime.service';
import { QueueService } from '../../queue/queue.module';
import { MessagingService } from './messaging.service';
import { truncate } from '../../common/utils/text.util';
import { ensureFound, ValidationError } from '../../common/errors';
import type { Actor } from '../../common/auth-context';

/** Shape of the WhatsApp Cloud API webhook payload (subset we use). */
interface WaWebhook {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
        messages?: WaMessage[];
        statuses?: Array<{ id: string; status: string; timestamp?: string; recipient_id?: string; errors?: Array<{ code?: number; title?: string; message?: string }> }>;
      };
    }>;
  }>;
}

interface WaMessage {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  video?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
  sticker?: { id?: string; mime_type?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  interactive?: { type?: string; button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string; description?: string } };
  button?: { text?: string; payload?: string };
  reaction?: { emoji?: string; message_id?: string };
  context?: { id?: string };
}

export interface NormalizedInbound {
  externalId: string | null;
  type: MessageType;
  body: string | null;
  mediaId?: string;
  mediaMimeType?: string;
  mediaFileName?: string;
  /** Direct media URL (Messenger/Instagram attachments). */
  mediaUrl?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

/** Converts a WhatsApp message into Sellora's channel-neutral format. */
export function normalizeWhatsAppMessage(m: WaMessage): NormalizedInbound {
  const timestamp = m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date();
  const base = { externalId: m.id, timestamp };
  switch (m.type) {
    case 'text':
      return { ...base, type: MessageType.TEXT, body: m.text?.body ?? '' };
    case 'image':
      return { ...base, type: MessageType.IMAGE, body: m.image?.caption ?? null, mediaId: m.image?.id, mediaMimeType: m.image?.mime_type };
    case 'video':
      return { ...base, type: MessageType.VIDEO, body: m.video?.caption ?? null, mediaId: m.video?.id, mediaMimeType: m.video?.mime_type };
    case 'audio':
      return { ...base, type: MessageType.AUDIO, body: null, mediaId: m.audio?.id, mediaMimeType: m.audio?.mime_type };
    case 'document':
      return { ...base, type: MessageType.DOCUMENT, body: m.document?.caption ?? null, mediaId: m.document?.id, mediaMimeType: m.document?.mime_type, mediaFileName: m.document?.filename };
    case 'sticker':
      return { ...base, type: MessageType.STICKER, body: null, mediaId: m.sticker?.id, mediaMimeType: m.sticker?.mime_type };
    case 'location':
      return {
        ...base,
        type: MessageType.LOCATION,
        body: [m.location?.name, m.location?.address].filter(Boolean).join(' — ') || `Location ${m.location?.latitude}, ${m.location?.longitude}`,
        metadata: { location: m.location },
      };
    case 'interactive': {
      const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
      return { ...base, type: MessageType.INTERACTIVE, body: reply?.title ?? '', metadata: { interactive: m.interactive } };
    }
    case 'button':
      return { ...base, type: MessageType.INTERACTIVE, body: m.button?.text ?? '', metadata: { button: m.button } };
    case 'reaction':
      return { ...base, type: MessageType.TEXT, body: m.reaction?.emoji ? `Reacted ${m.reaction.emoji}` : 'Removed a reaction', metadata: { reaction: m.reaction } };
    default:
      return { ...base, type: MessageType.UNSUPPORTED, body: `Unsupported message type: ${m.type}` };
  }
}

const WA_STATUS: Record<string, MessageStatus> = {
  sent: MessageStatus.SENT,
  delivered: MessageStatus.DELIVERED,
  read: MessageStatus.READ,
  failed: MessageStatus.FAILED,
};

@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly queues: QueueService,
    private readonly messaging: MessagingService,
  ) {}

  /** Processes a stored webhook event (called by the WhatsApp queue worker). */
  async processWebhookEvent(eventId: string) {
    const event = await this.prisma.webhookEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status === WebhookEventStatus.PROCESSED) return;
    const payload = event.payload as WaWebhook;
    let handled = 0;
    try {
      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change.value;
          const phoneNumberId = value?.metadata?.phone_number_id;
          if (!value || !phoneNumberId) continue;
          const account = await this.prisma.whatsAppAccount.findUnique({ where: { phoneNumberId } });
          if (!account) continue;
          const profiles = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
          for (const message of value.messages ?? []) {
            await this.handleWhatsAppMessage(account, message, profiles.get(message.from));
            handled++;
          }
          for (const status of value.statuses ?? []) {
            const mapped = WA_STATUS[status.status];
            if (!mapped) continue;
            const err = status.errors?.[0];
            await this.messaging.applyStatus(
              account.tenantId,
              status.id,
              mapped,
              status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date(),
              err ? { code: String(err.code ?? ''), title: err.title ?? err.message } : undefined,
            );
            handled++;
          }
        }
      }
      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: { status: handled ? WebhookEventStatus.PROCESSED : WebhookEventStatus.IGNORED, processedAt: new Date(), error: null },
      });
    } catch (err) {
      await this.prisma.webhookEvent.update({ where: { id: eventId }, data: { status: WebhookEventStatus.FAILED, error: (err as Error).message.slice(0, 1000) } });
      throw err;
    }
  }

  private async handleWhatsAppMessage(
    account: { id: string; tenantId: string; defaultAgentId: string | null },
    raw: WaMessage,
    profileName?: string,
  ) {
    const tenantId = account.tenantId;
    const duplicate = await this.prisma.message.findUnique({ where: { tenantId_externalId: { tenantId, externalId: raw.id } } });
    if (duplicate) return;

    const customer = await this.customers.findOrCreateByWhatsApp(tenantId, raw.from, profileName);
    const contact = await this.prisma.whatsAppContact.upsert({
      where: { accountId_waId: { accountId: account.id, waId: raw.from } },
      create: { tenantId, accountId: account.id, waId: raw.from, profileName, customerId: customer.id, lastMessageAt: new Date() },
      update: { profileName: profileName ?? undefined, customerId: customer.id, lastMessageAt: new Date() },
    });

    let conversation = await this.prisma.conversation.findFirst({
      where: { tenantId, whatsappAccountId: account.id, contactId: contact.id },
      orderBy: { lastMessageAt: 'desc' },
    });
    let opened = false;
    if (!conversation) {
      const agentId = await this.resolveAgent(tenantId, account.defaultAgentId);
      conversation = await this.prisma.conversation.create({
        data: {
          tenantId,
          channel: ChannelType.WHATSAPP,
          whatsappAccountId: account.id,
          contactId: contact.id,
          customerId: customer.id,
          handler: agentId ? ConversationHandler.AI : ConversationHandler.HUMAN,
          aiAgentId: agentId,
        },
      });
      opened = true;
    } else if (conversation.status === ConversationStatus.RESOLVED || conversation.status === ConversationStatus.CLOSED) {
      const agentId = conversation.aiAgentId ?? (await this.resolveAgent(tenantId, account.defaultAgentId));
      conversation = await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          status: ConversationStatus.OPEN,
          resolvedAt: null,
          closedAt: null,
          // A reopened conversation goes back to the AI when one is available.
          handler: agentId ? ConversationHandler.AI : ConversationHandler.HUMAN,
          aiAgentId: agentId,
        },
      });
      opened = true;
    }

    const normalized = normalizeWhatsAppMessage(raw);
    await this.storeInbound(tenantId, conversation, normalized, opened);
  }

  /**
   * Channel-neutral entry point for website chat, Messenger and Instagram:
   * finds (or reopens) the contact's conversation and runs the normal
   * inbound pipeline — realtime inbox, CRM, automation and the AI agent.
   */
  async receiveOnConnection(
    connection: { id: string; tenantId: string; type: ChannelType; defaultAgentId: string | null },
    contact: { id: string; customerId: string | null },
    msg: NormalizedInbound,
  ) {
    const tenantId = connection.tenantId;
    if (!contact.customerId) throw new ValidationError('Channel contact is not linked to a customer');
    if (msg.externalId) {
      const duplicate = await this.prisma.message.findUnique({ where: { tenantId_externalId: { tenantId, externalId: msg.externalId } } });
      if (duplicate) return duplicate;
    }
    let conversation = await this.prisma.conversation.findFirst({
      where: { tenantId, channelConnectionId: connection.id, channelContactId: contact.id },
      orderBy: { lastMessageAt: 'desc' },
    });
    let opened = false;
    if (!conversation) {
      const agentId = await this.resolveAgent(tenantId, connection.defaultAgentId);
      conversation = await this.prisma.conversation.create({
        data: {
          tenantId,
          channel: connection.type,
          channelConnectionId: connection.id,
          channelContactId: contact.id,
          customerId: contact.customerId,
          handler: agentId ? ConversationHandler.AI : ConversationHandler.HUMAN,
          aiAgentId: agentId,
        },
      });
      opened = true;
    } else if (conversation.status === ConversationStatus.RESOLVED || conversation.status === ConversationStatus.CLOSED) {
      const agentId = conversation.aiAgentId ?? (await this.resolveAgent(tenantId, connection.defaultAgentId));
      conversation = await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          status: ConversationStatus.OPEN,
          resolvedAt: null,
          closedAt: null,
          handler: agentId ? ConversationHandler.AI : ConversationHandler.HUMAN,
          aiAgentId: agentId,
        },
      });
      opened = true;
    }
    await this.prisma.channelContact.update({ where: { id: contact.id }, data: { lastMessageAt: new Date() } });
    return this.storeInbound(tenantId, conversation, msg, opened);
  }

  private async resolveAgent(tenantId: string, preferred: string | null): Promise<string | null> {
    if (preferred) {
      const agent = await this.prisma.aIAgent.findFirst({ where: { id: preferred, tenantId, isActive: true }, select: { id: true } });
      if (agent) return agent.id;
    }
    const fallback = await this.prisma.aIAgent.findFirst({
      where: { tenantId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    return fallback?.id ?? null;
  }

  /** Stores an inbound message and runs the post-receive pipeline (realtime, CRM, automation, AI). */
  async storeInbound(tenantId: string, conversation: Conversation, msg: NormalizedInbound, opened: boolean) {
    let message;
    try {
      message = await this.prisma.message.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          direction: MessageDirection.INBOUND,
          senderType: MessageSenderType.CUSTOMER,
          type: msg.type,
          body: msg.body,
          mediaId: msg.mediaId,
          mediaMimeType: msg.mediaMimeType,
          mediaFileName: msg.mediaFileName,
          mediaUrl: msg.mediaUrl,
          externalId: msg.externalId,
          status: MessageStatus.RECEIVED,
          metadata: msg.metadata as Prisma.InputJsonValue | undefined,
          createdAt: msg.timestamp > new Date() ? new Date() : msg.timestamp,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return; // duplicate delivery
      throw err;
    }
    const preview = truncate(msg.body || `[${msg.type.toLowerCase()}]`, 160);
    const updated = await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), lastInboundAt: new Date(), lastMessagePreview: preview, unreadCount: { increment: 1 } },
    });
    await this.customers.touch(tenantId, conversation.customerId);

    this.messaging.emitMessage(tenantId, conversation.id, message);
    this.realtime.toPermission(tenantId, 'conversations.view', REALTIME_EVENTS.CONVERSATION_UPDATED, {
      id: conversation.id,
      lastMessagePreview: preview,
      lastMessageAt: updated.lastMessageAt,
      unreadCount: updated.unreadCount,
      created: opened,
    });

    const eventPayload = { conversationId: conversation.id, customerId: conversation.customerId, messageId: message.id, text: msg.body ?? '', channel: conversation.channel };
    if (opened) await this.events.emit(tenantId, 'conversation.opened', eventPayload);
    await this.events.emit(tenantId, 'message.received', eventPayload);

    if (updated.handler === ConversationHandler.HUMAN && updated.assignedUserId) {
      const customer = await this.prisma.customer.findUnique({ where: { id: conversation.customerId }, select: { name: true } });
      await this.notifications.notify(tenantId, { userIds: [updated.assignedUserId] }, {
        type: NotificationType.NEW_MESSAGE,
        title: `New message from ${customer?.name ?? 'customer'}`,
        body: preview,
        link: `/inbox?conversation=${conversation.id}`,
      });
    }
    if (updated.handler === ConversationHandler.AI && updated.aiAgentId && updated.status !== ConversationStatus.CLOSED) {
      await this.queues.aiReply(tenantId, conversation.id, message.id, updated.aiAgentId);
    }
    return message;
  }

  /** Simulates a customer message in a test conversation (no WhatsApp required). */
  async simulateInbound(actor: Actor, conversationId: string, text: string) {
    const conversation = ensureFound(await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId: actor.tenantId } }), 'Conversation');
    if (conversation.channel !== ChannelType.TEST) throw new ValidationError('Only test conversations accept simulated messages.');
    return this.storeInbound(actor.tenantId, conversation, { externalId: null, type: MessageType.TEXT, body: text, timestamp: new Date() }, false);
  }
}
