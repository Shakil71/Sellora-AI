import { Injectable } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptSecret } from '../../common/utils/crypto.util';
import { WhatsAppGraphClient } from '../whatsapp/whatsapp-graph.client';
import { MetaGraphClient } from '../integrations/meta-graph.client';
import { ChannelSendError, ChannelTarget, MessagingChannel, OutboundPayload, SendResult } from './channel.types';

const WHATSAPP_WINDOW_MS = 24 * 3600 * 1000;

/** WhatsApp Cloud API channel. */
export class WhatsAppChannel implements MessagingChannel {
  readonly type = ChannelType.WHATSAPP;
  readonly label = 'WhatsApp';
  readonly customerServiceWindowMs = WHATSAPP_WINDOW_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: WhatsAppGraphClient,
  ) {}

  private async credentials(target: ChannelTarget) {
    if (!target.whatsappAccountId) throw new ChannelSendError('Conversation has no WhatsApp account', 'NO_ACCOUNT', false);
    const account = await this.prisma.whatsAppAccount.findFirst({ where: { id: target.whatsappAccountId, tenantId: target.tenantId } });
    if (!account) throw new ChannelSendError('WhatsApp account was removed', 'NO_ACCOUNT', false);
    if (account.status === 'DISCONNECTED') throw new ChannelSendError('WhatsApp account is disconnected', 'DISCONNECTED', false);
    return { phoneNumberId: account.phoneNumberId, token: decryptSecret(account.accessTokenEnc) };
  }

  async send(target: ChannelTarget, payload: OutboundPayload): Promise<SendResult> {
    if (!target.recipient) throw new ChannelSendError('Customer has no WhatsApp number', 'NO_RECIPIENT', false);
    const { phoneNumberId, token } = await this.credentials(target);
    let body: Record<string, unknown>;
    if (payload.kind === 'template' && payload.template) {
      body = {
        to: target.recipient,
        type: 'template',
        template: { name: payload.template.name, language: { code: payload.template.language }, ...(payload.template.components?.length ? { components: payload.template.components } : {}) },
      };
    } else if (payload.kind === 'media' && payload.media) {
      const m = payload.media;
      const type = m.mimeType.startsWith('image/') ? 'image' : m.mimeType.startsWith('video/') ? 'video' : m.mimeType.startsWith('audio/') ? 'audio' : 'document';
      body = {
        to: target.recipient,
        type,
        [type]: { link: m.url, ...(type !== 'audio' && m.caption ? { caption: m.caption } : {}), ...(type === 'document' && m.fileName ? { filename: m.fileName } : {}) },
      };
    } else {
      body = { to: target.recipient, type: 'text', text: { body: (payload.text ?? '').slice(0, 4096), preview_url: true } };
    }
    const res = await this.graph.sendMessage(phoneNumberId, token, { recipient_type: 'individual', ...body });
    return { externalId: res.messages?.[0]?.id ?? null };
  }

  async markRead(target: ChannelTarget, externalMessageId: string) {
    const { phoneNumberId, token } = await this.credentials(target);
    await this.graph.markRead(phoneNumberId, token, externalMessageId);
  }
}

/**
 * Internal channel used by "test conversations" so teams can try the AI agent
 * end-to-end before connecting WhatsApp. Nothing leaves the platform.
 */
export class TestChannel implements MessagingChannel {
  readonly type = ChannelType.TEST;
  readonly label = 'Test conversation';
  readonly customerServiceWindowMs = null;

  async send(): Promise<SendResult> {
    return { externalId: null };
  }
}

/**
 * Website chat: replies are stored and the visitor's widget fetches them, so
 * "sending" only confirms the connection still exists.
 */
export class WebChatChannel implements MessagingChannel {
  readonly type = ChannelType.WEB_CHAT;
  readonly label = 'Website chat';
  readonly customerServiceWindowMs = null;

  constructor(private readonly prisma: PrismaService) {}

  async send(target: ChannelTarget): Promise<SendResult> {
    if (!target.channelConnectionId) throw new ChannelSendError('Conversation has no website chat connection', 'NO_CONNECTION', false);
    const connection = await this.prisma.channelConnection.findFirst({ where: { id: target.channelConnectionId, tenantId: target.tenantId }, select: { status: true } });
    if (!connection) throw new ChannelSendError('The website chat was removed', 'NO_CONNECTION', false);
    return { externalId: null };
  }
}

/** Splits long replies at paragraph, sentence or word boundaries. */
export function splitMessage(text: string, max: number): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const slice = rest.slice(0, max);
    const cut = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '), slice.lastIndexOf('\n'));
    const at = cut > max * 0.5 ? cut + 1 : slice.lastIndexOf(' ') > max * 0.5 ? slice.lastIndexOf(' ') : max;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Facebook Messenger and Instagram Direct, both sent through the connected Facebook Page. */
export class MetaMessagingChannel implements MessagingChannel {
  readonly customerServiceWindowMs = WHATSAPP_WINDOW_MS; // Meta's standard 24-hour messaging window

  constructor(
    readonly type: typeof ChannelType.MESSENGER | typeof ChannelType.INSTAGRAM,
    readonly label: string,
    private readonly maxLength: number,
    private readonly prisma: PrismaService,
    private readonly graph: MetaGraphClient,
  ) {}

  async send(target: ChannelTarget, payload: OutboundPayload): Promise<SendResult> {
    if (!target.recipient) throw new ChannelSendError(`Customer has no ${this.label} ID`, 'NO_RECIPIENT', false);
    if (payload.kind === 'template') throw new ChannelSendError(`${this.label} does not support WhatsApp templates`, 'UNSUPPORTED', false);
    const connection = target.channelConnectionId
      ? await this.prisma.channelConnection.findFirst({ where: { id: target.channelConnectionId, tenantId: target.tenantId } })
      : null;
    if (!connection || !connection.accessTokenEnc || !connection.pageId) throw new ChannelSendError(`${this.label} connection is missing`, 'NO_CONNECTION', false);
    if (connection.status === 'DISABLED') throw new ChannelSendError(`${this.label} connection is disabled`, 'DISCONNECTED', false);
    const token = decryptSecret(connection.accessTokenEnc);
    let lastId: string | null = null;
    if (payload.kind === 'media' && payload.media) {
      const m = payload.media;
      const type = m.mimeType.startsWith('image/') ? 'image' : m.mimeType.startsWith('video/') ? 'video' : m.mimeType.startsWith('audio/') ? 'audio' : 'file';
      const res = await this.graph.send(connection.pageId, token, target.recipient, { attachment: { type, url: m.url } });
      lastId = res.message_id ?? null;
      if (m.caption) for (const part of splitMessage(m.caption, this.maxLength)) lastId = (await this.graph.send(connection.pageId, token, target.recipient, { text: part })).message_id ?? lastId;
      return { externalId: lastId };
    }
    for (const part of splitMessage(payload.text ?? '', this.maxLength)) {
      lastId = (await this.graph.send(connection.pageId, token, target.recipient, { text: part })).message_id ?? lastId;
    }
    return { externalId: lastId };
  }
}

@Injectable()
export class ChannelsService {
  private readonly channels: Map<ChannelType, MessagingChannel>;

  constructor(prisma: PrismaService, graph: WhatsAppGraphClient, meta: MetaGraphClient) {
    this.channels = new Map<ChannelType, MessagingChannel>([
      [ChannelType.WHATSAPP, new WhatsAppChannel(prisma, graph)],
      [ChannelType.WEB_CHAT, new WebChatChannel(prisma)],
      [ChannelType.MESSENGER, new MetaMessagingChannel(ChannelType.MESSENGER, 'Messenger', 2000, prisma, meta)],
      [ChannelType.INSTAGRAM, new MetaMessagingChannel(ChannelType.INSTAGRAM, 'Instagram', 1000, prisma, meta)],
      [ChannelType.TEST, new TestChannel()],
    ]);
  }

  get(type: ChannelType): MessagingChannel {
    const channel = this.channels.get(type);
    if (!channel) throw new ChannelSendError(`Channel ${type} is not available`, 'NO_CHANNEL', false);
    return channel;
  }

  list() {
    return [...this.channels.values()].map((c) => ({ type: c.type, label: c.label }));
  }
}
