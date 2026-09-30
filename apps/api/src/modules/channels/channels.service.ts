import { Injectable } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptSecret } from '../../common/utils/crypto.util';
import { WhatsAppGraphClient } from '../whatsapp/whatsapp-graph.client';
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

@Injectable()
export class ChannelsService {
  private readonly channels: Map<ChannelType, MessagingChannel>;

  constructor(prisma: PrismaService, graph: WhatsAppGraphClient) {
    this.channels = new Map<ChannelType, MessagingChannel>([
      [ChannelType.WHATSAPP, new WhatsAppChannel(prisma, graph)],
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
