import { Injectable, Logger } from '@nestjs/common';
import {
  ChannelConnection,
  ChannelConnectionStatus,
  ChannelType,
  MessageDirection,
  MessageStatus,
  MessageType,
  Prisma,
  WebhookEventStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.module';
import { decryptSecret, hmacSha256Hex, safeEqual } from '../../common/utils/crypto.util';
import { env } from '../../config/env';
import { CustomersService } from '../crm/customers.service';
import { InboundService, type NormalizedInbound } from '../conversations/inbound.service';
import { MessagingService } from '../conversations/messaging.service';
import { MetaGraphClient } from './meta-graph.client';

interface MetaAttachment {
  type?: string;
  payload?: { url?: string; title?: string };
}

interface MetaMessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: MetaAttachment[];
    quick_reply?: { payload?: string };
  };
  postback?: { mid?: string; title?: string; payload?: string };
  delivery?: { mids?: string[]; watermark?: number };
  read?: { mid?: string; watermark?: number };
}

interface MetaWebhook {
  object?: string;
  entry?: Array<{ id?: string; time?: number; messaging?: MetaMessagingEvent[] }>;
}

export type MetaVerdict = { ok: true; eventId: string | null } | { ok: false; reason: string };

const TYPE_BY_OBJECT: Record<string, ChannelType> = {
  page: ChannelType.MESSENGER,
  instagram: ChannelType.INSTAGRAM,
};

const ATTACHMENT_TYPES: Record<string, MessageType> = {
  image: MessageType.IMAGE,
  video: MessageType.VIDEO,
  audio: MessageType.AUDIO,
  file: MessageType.DOCUMENT,
  sticker: MessageType.STICKER,
  location: MessageType.LOCATION,
};

/** Converts a Messenger/Instagram event into Sellora's channel-neutral format. */
export function normalizeMetaMessage(e: MetaMessagingEvent): NormalizedInbound | null {
  const timestamp = e.timestamp ? new Date(e.timestamp) : new Date();
  if (e.postback) {
    return {
      externalId: e.postback.mid ?? null,
      type: MessageType.INTERACTIVE,
      body: e.postback.title ?? e.postback.payload ?? '',
      metadata: { postback: e.postback },
      timestamp,
    };
  }
  const m = e.message;
  if (!m || m.is_echo) return null;
  const attachment = m.attachments?.[0];
  if (attachment && !m.text) {
    const type = ATTACHMENT_TYPES[attachment.type ?? ''] ?? MessageType.UNSUPPORTED;
    return {
      externalId: m.mid ?? null,
      type,
      body:
        type === MessageType.UNSUPPORTED
          ? `Unsupported attachment: ${attachment.type}`
          : (attachment.payload?.title ?? null),
      mediaUrl: attachment.payload?.url,
      metadata: { attachments: m.attachments },
      timestamp,
    };
  }
  return {
    externalId: m.mid ?? null,
    type: MessageType.TEXT,
    body: m.text ?? '',
    metadata: m.quick_reply ? { quickReply: m.quick_reply } : undefined,
    timestamp,
  };
}

/**
 * Receives Facebook Messenger and Instagram webhooks (one callback URL for
 * both), verifies X-Hub-Signature-256 and processes events in the worker.
 */
@Injectable()
export class MetaWebhookService {
  private readonly logger = new Logger(MetaWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly customers: CustomersService,
    private readonly inbound: InboundService,
    private readonly messaging: MessagingService,
    private readonly graph: MetaGraphClient,
  ) {}

  async verifySubscription(mode?: string, token?: string): Promise<boolean> {
    if (mode !== 'subscribe' || !token) return false;
    if (env.META_VERIFY_TOKEN && safeEqual(token, env.META_VERIFY_TOKEN)) return true;
    const found = await this.prisma.channelConnection.findFirst({
      where: { verifyToken: token, type: { in: [ChannelType.MESSENGER, ChannelType.INSTAGRAM] } },
      select: { id: true },
    });
    return Boolean(found);
  }

  async receive(
    rawBody: Buffer | undefined,
    signatureHeader: string | undefined,
  ): Promise<MetaVerdict> {
    if (!rawBody?.length) return { ok: false, reason: 'empty body' };
    let payload: MetaWebhook;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as MetaWebhook;
    } catch {
      return { ok: false, reason: 'invalid json' };
    }
    const type = TYPE_BY_OBJECT[payload.object ?? ''];
    if (!type) return { ok: true, eventId: null }; // not a messaging object: acknowledge and ignore
    const ids = [
      ...new Set((payload.entry ?? []).map((e) => e.id).filter((id): id is string => Boolean(id))),
    ];
    const connections = ids.length
      ? await this.prisma.channelConnection.findMany({ where: { type, externalId: { in: ids } } })
      : [];

    const secrets = new Set<string>();
    for (const c of connections) {
      if (!c.appSecretEnc) continue;
      try {
        secrets.add(decryptSecret(c.appSecretEnc));
      } catch {
        /* undecryptable secret */
      }
    }
    if (env.META_APP_SECRET) secrets.add(env.META_APP_SECRET);
    if (env.WHATSAPP_APP_SECRET) secrets.add(env.WHATSAPP_APP_SECRET); // same Meta app is common
    if (!secrets.size) return { ok: false, reason: 'no app secret configured' };
    const provided = signatureHeader?.startsWith('sha256=') ? signatureHeader.slice(7) : undefined;
    if (!provided) return { ok: false, reason: 'missing signature' };
    if (![...secrets].some((s) => safeEqual(hmacSha256Hex(s, rawBody), provided)))
      return { ok: false, reason: 'invalid signature' };

    const event = await this.prisma.webhookEvent.create({
      data: {
        tenantId: connections[0]?.tenantId ?? null,
        provider: type === ChannelType.INSTAGRAM ? 'instagram' : 'messenger',
        eventType: rawBody.includes('"message"')
          ? 'messages'
          : rawBody.includes('"delivery"') || rawBody.includes('"read"')
            ? 'statuses'
            : 'other',
        payload: payload as unknown as Prisma.InputJsonValue,
        signatureValid: true,
        status: connections.length ? WebhookEventStatus.RECEIVED : WebhookEventStatus.IGNORED,
      },
    });
    if (connections.length) await this.queues.processMetaWebhook(event.id);
    return { ok: true, eventId: event.id };
  }

  /** Worker: turns stored events into conversations and delivery receipts. */
  async process(eventId: string) {
    const event = await this.prisma.webhookEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status === WebhookEventStatus.PROCESSED) return;
    const payload = event.payload as unknown as MetaWebhook;
    const type = TYPE_BY_OBJECT[payload.object ?? ''];
    let handled = 0;
    try {
      for (const entry of payload.entry ?? []) {
        if (!type || !entry.id) continue;
        const connection = await this.prisma.channelConnection.findUnique({
          where: { type_externalId: { type, externalId: entry.id } },
        });
        if (!connection || connection.status === ChannelConnectionStatus.DISABLED) continue;
        for (const e of entry.messaging ?? []) {
          if (await this.handleEvent(connection, e)) handled++;
        }
      }
      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: {
          status: handled ? WebhookEventStatus.PROCESSED : WebhookEventStatus.IGNORED,
          processedAt: new Date(),
          error: null,
        },
      });
    } catch (err) {
      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: { status: WebhookEventStatus.FAILED, error: (err as Error).message.slice(0, 1000) },
      });
      throw err;
    }
  }

  private async handleEvent(
    connection: ChannelConnection,
    e: MetaMessagingEvent,
  ): Promise<boolean> {
    const tenantId = connection.tenantId;
    if (e.delivery?.mids?.length) {
      for (const mid of e.delivery.mids)
        await this.messaging.applyStatus(
          tenantId,
          mid,
          MessageStatus.DELIVERED,
          new Date(e.timestamp ?? Date.now()),
        );
      return true;
    }
    if (e.read) {
      if (e.read.mid) {
        await this.messaging.applyStatus(
          tenantId,
          e.read.mid,
          MessageStatus.READ,
          new Date(e.timestamp ?? Date.now()),
        );
      } else if (e.read.watermark && e.sender?.id) {
        // Messenger reports reads as a watermark: everything sent before it was seen.
        const contact = await this.prisma.channelContact.findUnique({
          where: {
            connectionId_externalUserId: {
              connectionId: connection.id,
              externalUserId: e.sender.id,
            },
          },
        });
        if (contact) {
          await this.prisma.message.updateMany({
            where: {
              tenantId,
              direction: MessageDirection.OUTBOUND,
              status: { in: [MessageStatus.SENT, MessageStatus.DELIVERED] },
              sentAt: { lte: new Date(e.read.watermark) },
              conversation: { channelContactId: contact.id },
            },
            data: { status: MessageStatus.READ, readAt: new Date(e.read.watermark) },
          });
        }
      }
      return true;
    }
    const normalized = normalizeMetaMessage(e);
    const senderId = e.sender?.id;
    if (
      !normalized ||
      !senderId ||
      senderId === connection.externalId ||
      senderId === connection.pageId
    )
      return false;

    let contact = await this.prisma.channelContact.findUnique({
      where: {
        connectionId_externalUserId: { connectionId: connection.id, externalUserId: senderId },
      },
    });
    if (!contact) {
      const token = connection.accessTokenEnc ? decryptSecret(connection.accessTokenEnc) : null;
      const kind = connection.type === ChannelType.INSTAGRAM ? 'INSTAGRAM' : 'MESSENGER';
      const name = token ? await this.graph.profileName(senderId, token, kind) : undefined;
      const customer = await this.customers.createForChannel(tenantId, {
        name: name ?? `${kind === 'INSTAGRAM' ? 'Instagram' : 'Messenger'} user`,
        source: kind.toLowerCase(),
      });
      contact = await this.prisma.channelContact.upsert({
        where: {
          connectionId_externalUserId: { connectionId: connection.id, externalUserId: senderId },
        },
        create: {
          tenantId,
          connectionId: connection.id,
          externalUserId: senderId,
          profileName: name,
          customerId: customer.id,
        },
        update: {},
      });
    }
    await this.inbound.receiveOnConnection(connection, contact, normalized);
    return true;
  }
}
