import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  ChannelConnection,
  ChannelConnectionStatus,
  ChannelType,
  MessageDirection,
  MessageSenderType,
  MessageType,
  TenantStatus,
} from '@prisma/client';
import { z } from 'zod';
import { DEFAULT_WEB_CHAT_SETTINGS, type WebChatSettings } from '@sellora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { hmacSha256Hex, safeEqual } from '../../common/utils/crypto.util';
import { env } from '../../config/env';
import { AppException, NotFoundError, ValidationError } from '../../common/errors';
import { CustomersService } from '../crm/customers.service';
import { InboundService } from '../conversations/inbound.service';

export const visitorProfileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(254).optional(),
  phone: z.string().trim().min(5).max(30).optional(),
});

export const visitorMessageSchema = z.object({
  text: z.string().trim().min(1, 'Type a message').max(2000),
});

/** Customer-visible messages: no internal notes or system events. */
const VISIBLE_TYPES = [
  MessageType.TEXT,
  MessageType.IMAGE,
  MessageType.DOCUMENT,
  MessageType.AUDIO,
  MessageType.VIDEO,
  MessageType.STICKER,
  MessageType.LOCATION,
  MessageType.INTERACTIVE,
];

class ForbiddenOrigin extends AppException {
  constructor() {
    super('ORIGIN_NOT_ALLOWED', 'This chat is not enabled for this website.', 403);
  }
}

/**
 * Public API behind the embeddable website chat widget. Visitors are
 * identified by a signed token kept in the widget; no account is needed.
 */
@Injectable()
export class WebChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly inbound: InboundService,
  ) {}

  private signingKey() {
    return `${env.JWT_SECRET}:webchat`;
  }

  private tokenFor(connectionId: string, contactId: string) {
    return `${contactId}.${hmacSha256Hex(this.signingKey(), `${connectionId}:${contactId}`)}`;
  }

  private async connection(key: string) {
    const c = await this.prisma.channelConnection.findUnique({
      where: { type_externalId: { type: ChannelType.WEB_CHAT, externalId: key } },
      include: { tenant: { select: { name: true, logoUrl: true, status: true } } },
    });
    if (
      !c ||
      c.status === ChannelConnectionStatus.DISABLED ||
      c.tenant.status === TenantStatus.SUSPENDED
    )
      throw new NotFoundError('Chat');
    return c;
  }

  private settings(c: ChannelConnection): WebChatSettings {
    return { ...DEFAULT_WEB_CHAT_SETTINGS, ...(c.settings as Partial<WebChatSettings>) };
  }

  /**
   * Optional domain allow-list. The widget reports the page it is embedded on;
   * this keeps other websites from showing your chat in normal browsers.
   */
  private assertOrigin(c: ChannelConnection, origin?: string) {
    const allowed = this.settings(c).allowedDomains;
    if (!allowed.length) return;
    let host = '';
    try {
      host = origin ? new URL(origin).host.toLowerCase() : '';
    } catch {
      host = '';
    }
    const ok =
      host &&
      allowed.some((d) =>
        d.startsWith('*.') ? host === d.slice(2) || host.endsWith(d.slice(1)) : host === d,
      );
    if (!ok) throw new ForbiddenOrigin();
  }

  private async visitor(c: ChannelConnection, token?: string) {
    const [contactId, sig] = (token ?? '').split('.');
    if (!contactId || !sig || !/^[0-9a-f-]{36}$/.test(contactId))
      throw new AppException(
        'INVALID_VISITOR',
        'Your chat session has expired. Reload the page.',
        401,
      );
    const expected = this.tokenFor(c.id, contactId).split('.')[1]!;
    if (!safeEqual(sig, expected))
      throw new AppException(
        'INVALID_VISITOR',
        'Your chat session has expired. Reload the page.',
        401,
      );
    const contact = await this.prisma.channelContact.findFirst({
      where: { id: contactId, connectionId: c.id },
    });
    if (!contact)
      throw new AppException(
        'INVALID_VISITOR',
        'Your chat session has expired. Reload the page.',
        401,
      );
    return contact;
  }

  async config(key: string, origin?: string) {
    const c = await this.connection(key);
    this.assertOrigin(c, origin);
    const s = this.settings(c);
    return {
      businessName: c.tenant.name,
      logoUrl: c.tenant.logoUrl,
      title: s.title,
      greeting: s.greeting,
      color: s.color,
      position: s.position,
      askForContact: s.askForContact,
    };
  }

  /** Starts a visitor session (on the first message or contact form). */
  async startSession(key: string, input: z.infer<typeof visitorProfileSchema>, origin?: string) {
    const c = await this.connection(key);
    this.assertOrigin(c, origin);
    if (this.settings(c).askForContact && !input.email && !input.phone)
      throw new ValidationError('Please enter your email or phone number.');
    const customer = await this.customers.createForChannel(c.tenantId, {
      name: input.name ?? `Website visitor ${randomBytes(2).toString('hex').toUpperCase()}`,
      email: input.email,
      phone: input.phone,
      source: 'web_chat',
    });
    const contact = await this.prisma.channelContact.create({
      data: {
        tenantId: c.tenantId,
        connectionId: c.id,
        externalUserId: `v_${randomBytes(12).toString('hex')}`,
        profileName: customer.name,
        customerId: customer.id,
      },
    });
    return { token: this.tokenFor(c.id, contact.id), name: customer.name };
  }

  async updateProfile(
    key: string,
    token: string | undefined,
    input: z.infer<typeof visitorProfileSchema>,
    origin?: string,
  ) {
    const c = await this.connection(key);
    this.assertOrigin(c, origin);
    const contact = await this.visitor(c, token);
    if (contact.customerId) {
      await this.prisma.customer.update({
        where: { id: contact.customerId },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.email ? { email: input.email } : {}),
          ...(input.phone ? { phone: input.phone } : {}),
        },
      });
    }
    if (input.name)
      await this.prisma.channelContact.update({
        where: { id: contact.id },
        data: { profileName: input.name },
      });
    return { updated: true };
  }

  async send(key: string, token: string | undefined, text: string, origin?: string) {
    const c = await this.connection(key);
    this.assertOrigin(c, origin);
    const contact = await this.visitor(c, token);
    const message = await this.inbound.receiveOnConnection(c, contact, {
      externalId: null,
      type: MessageType.TEXT,
      body: text,
      timestamp: new Date(),
    });
    if (!message) throw new ValidationError('Message could not be sent. Try again.');
    return this.present(message);
  }

  /** Messages newer than `after` (ISO time), oldest first. */
  async messages(key: string, token: string | undefined, after?: string, origin?: string) {
    const c = await this.connection(key);
    this.assertOrigin(c, origin);
    const contact = await this.visitor(c, token);
    const since = after && !Number.isNaN(Date.parse(after)) ? new Date(after) : undefined;
    const rows = await this.prisma.message.findMany({
      where: {
        tenantId: c.tenantId,
        conversation: { channelConnectionId: c.id, channelContactId: contact.id },
        type: { in: VISIBLE_TYPES },
        senderType: { not: MessageSenderType.SYSTEM },
        ...(since ? { createdAt: { gt: since } } : {}),
      },
      orderBy: { createdAt: since ? 'asc' : 'desc' },
      take: 100,
      include: { senderUser: { select: { name: true } } },
    });
    const ordered = since ? rows : rows.reverse();
    const conversation = await this.prisma.conversation.findFirst({
      where: { channelConnectionId: c.id, channelContactId: contact.id },
      orderBy: { lastMessageAt: 'desc' },
      select: { handler: true, status: true },
    });
    return {
      messages: ordered.map((m) => this.present(m)),
      handler: conversation?.handler ?? null,
      status: conversation?.status ?? null,
    };
  }

  private present(m: {
    id: string;
    direction: MessageDirection;
    senderType: MessageSenderType;
    body: string | null;
    type: MessageType;
    mediaUrl: string | null;
    createdAt: Date;
    senderUser?: { name: string } | null;
  }) {
    return {
      id: m.id,
      from:
        m.direction === MessageDirection.INBOUND
          ? 'visitor'
          : m.senderType === MessageSenderType.AI
            ? 'ai'
            : 'agent',
      agentName: m.senderUser?.name ?? null,
      type: m.type,
      text: m.body,
      mediaUrl: m.mediaUrl,
      createdAt: m.createdAt,
    };
  }
}
