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

  /**
   * Verifies X-Hub-Signature-256. A connection's own app secret only vouches
   * for that connection's entries; the server-wide secrets vouch for every
   * entry. Entries the signing secret does not cover are dropped before
   * storage, so one workspace can never inject messages into another.
   */
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
    if (!payload || typeof payload !== 'object') return { ok: false, reason: 'invalid json' };
    const type = TYPE_BY_OBJECT[payload.object ?? ''];
    if (!type) return { ok: true, eventId: null }; // not a messaging object: acknowledge and ignore
    const ids = [
      ...new Set((payload.entry ?? []).map((e) => e.id).filter((id): id is string => Boolean(id))),
    ];
    const connections = ids.length
      ? await this.prisma.channelConnection.findMany({ where: { type, externalId: { in: ids } } })
      : [];

    const connectionSecrets = connections.map((c) => {
      if (!c.appSecretEnc) return undefined;
      try {
        return decryptSecret(c.appSecretEnc);
      } catch {
        return undefined; // undecryptable secret
      }
    });
    // The WhatsApp app secret is accepted too: one Meta app for every channel is common.
    const platformSecrets = [env.META_APP_SECRET, env.WHATSAPP_APP_SECRET].filter(
      (s): s is string => Boolean(s),
    );
    if (!platformSecrets.length && !connectionSecrets.some(Boolean))
      return { ok: false, reason: 'no app secret configured' };
    const provided = signatureHeader?.startsWith('sha256=') ? signatureHeader.slice(7) : undefined;
    if (!provided) return { ok: false, reason: 'missing signature' };
    const signedBy = (secret: string | undefined) =>
      Boolean(secret) && safeEqual(hmacSha256Hex(secret!, rawBody), provided);

    const platformSigned = platformSecrets.some(signedBy);
    const trusted = connections.filter((_c, i) => platformSigned || signedBy(connectionSecrets[i]));
    if (!platformSigned && !trusted.length) return { ok: false, reason: 'invalid signature' };

    const provider = type === ChannelType.INSTAGRAM ? 'instagram' : 'messenger';
    const dropped = ids.filter((id) => !trusted.some((c) => c.externalId === id));
    if (dropped.length && !platformSigned)
      this.logger.warn(
        `Dropped ${type} webhook entries not covered by the signing secret: ${dropped.join(', ')}`,
      );
    if (!trusted.length) {
      // Authentic (server-wide secret) but for no connected page: keep it for the platform log only.
      const event = await this.prisma.webhookEvent.create({
        data: {
          tenantId: null,
          provider,
          eventType: 'other',
          payload: payload as unknown as Prisma.InputJsonValue,
          signatureValid: true,
          status: WebhookEventStatus.IGNORED,
        },
      });
      return { ok: true, eventId: event.id };
    }

    // One event per workspace, holding only that workspace's entries.
    const eventIds: string[] = [];
    for (const tenantId of [...new Set(trusted.map((c) => c.tenantId))]) {
      const tenantIds = new Set(
        trusted.filter((c) => c.tenantId === tenantId).map((c) => c.externalId),
      );
      const scoped: MetaWebhook = {
        ...payload,
        entry: (payload.entry ?? []).filter((e) => e.id && tenantIds.has(e.id)),
      };
      const scopedBody = JSON.stringify(scoped);
      const event = await this.prisma.webhookEvent.create({
        data: {
          tenantId,
          provider,
          eventType: scopedBody.includes('"message"')
            ? 'messages'
            : scopedBody.includes('"delivery"') || scopedBody.includes('"read"')
              ? 'statuses'
              : 'other',
          payload: scoped as unknown as Prisma.InputJsonValue,
          signatureValid: true,
          status: WebhookEventStatus.RECEIVED,
        },
      });
      await this.queues.processMetaWebhook(event.id);
      eventIds.push(event.id);
    }
    return { ok: true, eventId: eventIds[0]! };
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
