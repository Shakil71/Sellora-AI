import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ChannelConnection, ChannelConnectionStatus, ChannelType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { DEFAULT_WEB_CHAT_SETTINGS, type WebChatSettings } from '@sellora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { decryptSecret, encryptSecret, randomToken } from '../../common/utils/crypto.util';
import { ConflictError, ensureFound, ValidationError } from '../../common/errors';
import { env } from '../../config/env';
import type { Actor } from '../../common/auth-context';
import { MetaGraphClient } from './meta-graph.client';

const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
  .pipe(z.string().regex(/^(\*\.)?[a-z0-9.-]+(:\d+)?$/, 'Enter a domain such as example.com'));

export const webChatSettingsSchema = z.object({
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #0f766e')
    .optional(),
  position: z.enum(['right', 'left']).optional(),
  title: z.string().trim().min(1).max(60).optional(),
  greeting: z.string().trim().max(300).optional(),
  askForContact: z.boolean().optional(),
  allowedDomains: z.array(hostname).max(20).optional(),
});

const agentId = z.string().uuid().nullable().optional();

export const createWebChatSchema = z.object({
  name: z.string().trim().min(2).max(80),
  defaultAgentId: agentId,
  settings: webChatSettingsSchema.optional(),
});

export const createMetaSchema = z.object({
  type: z.enum([ChannelType.MESSENGER, ChannelType.INSTAGRAM]),
  name: z.string().trim().min(2).max(80),
  pageId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, 'The Page ID is a number from your Facebook Page settings'),
  instagramAccountId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, 'The Instagram account ID is a number')
    .optional(),
  accessToken: z.string().trim().min(20, 'Paste the Page access token'),
  appSecret: z.string().trim().min(16).max(64).optional(),
  defaultAgentId: agentId,
});

export const updateConnectionSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  defaultAgentId: agentId,
  settings: webChatSettingsSchema.optional(),
  accessToken: z.string().trim().min(20).optional(),
  appSecret: z.string().trim().min(16).max(64).optional(),
  enabled: z.boolean().optional(),
});

/** Public shape: secrets never leave the server. */
function present(c: ChannelConnection & { _count?: { contacts: number; conversations: number } }) {
  const isMeta = c.type === ChannelType.MESSENGER || c.type === ChannelType.INSTAGRAM;
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    externalId: c.externalId,
    pageId: c.pageId,
    status: c.status,
    lastError: c.lastError,
    lastVerifiedAt: c.lastVerifiedAt,
    defaultAgentId: c.defaultAgentId,
    settings:
      c.type === ChannelType.WEB_CHAT
        ? { ...DEFAULT_WEB_CHAT_SETTINGS, ...(c.settings as Partial<WebChatSettings>) }
        : c.settings,
    hasAccessToken: Boolean(c.accessTokenEnc),
    hasAppSecret: Boolean(c.appSecretEnc),
    verifyToken: isMeta ? c.verifyToken : null,
    webhookUrl: isMeta ? `${env.API_URL}/api/v1/webhooks/meta` : null,
    embedCode:
      c.type === ChannelType.WEB_CHAT
        ? `<script src="${env.APP_URL}/widget.js" data-sellora-key="${c.externalId}" async></script>`
        : null,
    counts: c._count ?? null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export type ConnectionView = ReturnType<typeof present>;

/**
 * Website chat, Facebook Messenger and Instagram connections for a workspace.
 * WhatsApp numbers keep their own dedicated model and pages.
 */
@Injectable()
export class ChannelConnectionsService {
  private readonly logger = new Logger(ChannelConnectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly graph: MetaGraphClient,
  ) {}

  async list(tenantId: string, type?: ChannelType) {
    const rows = await this.prisma.channelConnection.findMany({
      where: { tenantId, ...(type ? { type } : {}) },
      include: { _count: { select: { contacts: true, conversations: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(present);
  }

  async get(tenantId: string, id: string) {
    const row = ensureFound(
      await this.prisma.channelConnection.findFirst({
        where: { id, tenantId },
        include: { _count: { select: { contacts: true, conversations: true } } },
      }),
      'Connection',
    );
    return present(row);
  }

  private async assertAgent(tenantId: string, agent: string | null | undefined) {
    if (!agent) return;
    const found = await this.prisma.aIAgent.findFirst({
      where: { id: agent, tenantId },
      select: { id: true },
    });
    if (!found)
      throw new ValidationError('The selected AI agent does not exist in this workspace.');
  }

  async createWebChat(actor: Actor, input: z.infer<typeof createWebChatSchema>) {
    await this.assertAgent(actor.tenantId, input.defaultAgentId);
    const settings: WebChatSettings = {
      ...DEFAULT_WEB_CHAT_SETTINGS,
      ...(input.settings ?? {}),
    } as WebChatSettings;
    const row = await this.prisma.channelConnection.create({
      data: {
        tenantId: actor.tenantId,
        type: ChannelType.WEB_CHAT,
        name: input.name,
        externalId: `wc_${randomBytes(12).toString('hex')}`,
        settings: settings as unknown as Prisma.InputJsonValue,
        defaultAgentId: input.defaultAgentId ?? null,
        lastVerifiedAt: new Date(),
      },
    });
    await this.audit.log(actor, {
      action: 'integrations.webchat_created',
      entityType: 'ChannelConnection',
      entityId: row.id,
      metadata: { name: row.name },
    });
    return this.get(actor.tenantId, row.id);
  }

  /** Checks the token against the Graph API and subscribes the Page to webhooks. */
  private async probeMeta(type: ChannelType, pageId: string, igId: string | null, token: string) {
    const page = await this.graph.describe(pageId, token, 'id,name');
    let label = page.name ?? pageId;
    if (type === ChannelType.INSTAGRAM && igId) {
      const ig = await this.graph.describe(igId, token, 'id,username');
      label = ig.username ? `@${ig.username}` : igId;
    }
    let subscribeError: string | null = null;
    try {
      await this.graph.subscribePage(pageId, token);
    } catch (err) {
      subscribeError = `Connected, but subscribing the Page to webhooks failed: ${(err as Error).message}`;
    }
    return { label, subscribeError };
  }

  async createMeta(actor: Actor, input: z.infer<typeof createMetaSchema>) {
    await this.assertAgent(actor.tenantId, input.defaultAgentId);
    if (input.type === ChannelType.INSTAGRAM && !input.instagramAccountId) {
      throw new ValidationError('Enter the Instagram professional account ID linked to this Page.');
    }
    const externalId =
      input.type === ChannelType.INSTAGRAM ? input.instagramAccountId! : input.pageId;
    const clash = await this.prisma.channelConnection.findUnique({
      where: { type_externalId: { type: input.type, externalId } },
    });
    if (clash) {
      throw new ConflictError(
        clash.tenantId === actor.tenantId
          ? 'This account is already connected.'
          : 'This account is already connected to another workspace.',
      );
    }
    let probe: { label: string; subscribeError: string | null };
    try {
      probe = await this.probeMeta(
        input.type,
        input.pageId,
        input.instagramAccountId ?? null,
        input.accessToken,
      );
    } catch (err) {
      throw new ValidationError(`Meta rejected the connection: ${(err as Error).message}`);
    }
    const row = await this.prisma.channelConnection.create({
      data: {
        tenantId: actor.tenantId,
        type: input.type,
        name: input.name,
        externalId,
        pageId: input.pageId,
        accessTokenEnc: encryptSecret(input.accessToken),
        appSecretEnc: input.appSecret ? encryptSecret(input.appSecret) : null,
        verifyToken: randomToken(18),
        settings: { accountLabel: probe.label },
        status: probe.subscribeError
          ? ChannelConnectionStatus.ERROR
          : ChannelConnectionStatus.CONNECTED,
        lastError: probe.subscribeError,
        lastVerifiedAt: new Date(),
        defaultAgentId: input.defaultAgentId ?? null,
      },
    });
    await this.audit.log(actor, {
      action: 'integrations.meta_connected',
      entityType: 'ChannelConnection',
      entityId: row.id,
      metadata: { type: row.type, name: row.name, pageId: row.pageId, externalId },
    });
    return this.get(actor.tenantId, row.id);
  }

  async update(actor: Actor, id: string, input: z.infer<typeof updateConnectionSchema>) {
    const current = ensureFound(
      await this.prisma.channelConnection.findFirst({ where: { id, tenantId: actor.tenantId } }),
      'Connection',
    );
    await this.assertAgent(actor.tenantId, input.defaultAgentId);
    const data: Prisma.ChannelConnectionUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.defaultAgentId !== undefined)
      data.defaultAgent = input.defaultAgentId
        ? { connect: { id: input.defaultAgentId } }
        : { disconnect: true };
    if (input.settings && current.type === ChannelType.WEB_CHAT) {
      data.settings = {
        ...DEFAULT_WEB_CHAT_SETTINGS,
        ...(current.settings as object),
        ...input.settings,
      } as unknown as Prisma.InputJsonValue;
    }
    if (input.accessToken) data.accessTokenEnc = encryptSecret(input.accessToken);
    if (input.appSecret) data.appSecretEnc = encryptSecret(input.appSecret);
    if (input.enabled !== undefined)
      data.status = input.enabled
        ? ChannelConnectionStatus.CONNECTED
        : ChannelConnectionStatus.DISABLED;
    await this.prisma.channelConnection.update({ where: { id }, data });
    await this.audit.log(actor, {
      action: 'integrations.connection_updated',
      entityType: 'ChannelConnection',
      entityId: id,
      metadata: {
        fields: Object.keys(input).filter((k) => k !== 'accessToken' && k !== 'appSecret'),
        secretsChanged: Boolean(input.accessToken || input.appSecret),
      },
    });
    if (input.accessToken && current.type !== ChannelType.WEB_CHAT) return this.verify(actor, id);
    return this.get(actor.tenantId, id);
  }

  /** Re-tests a Messenger/Instagram token and refreshes the connection status. */
  async verify(actor: Actor, id: string) {
    const c = ensureFound(
      await this.prisma.channelConnection.findFirst({ where: { id, tenantId: actor.tenantId } }),
      'Connection',
    );
    if (c.type === ChannelType.WEB_CHAT) return this.get(actor.tenantId, id);
    if (!c.accessTokenEnc || !c.pageId)
      throw new ValidationError('Add the Page access token first.');
    try {
      const probe = await this.probeMeta(
        c.type,
        c.pageId,
        c.type === ChannelType.INSTAGRAM ? c.externalId : null,
        decryptSecret(c.accessTokenEnc),
      );
      await this.prisma.channelConnection.update({
        where: { id },
        data: {
          status:
            c.status === ChannelConnectionStatus.DISABLED
              ? c.status
              : probe.subscribeError
                ? ChannelConnectionStatus.ERROR
                : ChannelConnectionStatus.CONNECTED,
          lastError: probe.subscribeError,
          lastVerifiedAt: new Date(),
          settings: { ...(c.settings as object), accountLabel: probe.label },
        },
      });
    } catch (err) {
      await this.prisma.channelConnection.update({
        where: { id },
        data: {
          status: ChannelConnectionStatus.ERROR,
          lastError: (err as Error).message.slice(0, 500),
        },
      });
    }
    return this.get(actor.tenantId, id);
  }

  async rotateVerifyToken(actor: Actor, id: string) {
    const c = ensureFound(
      await this.prisma.channelConnection.findFirst({ where: { id, tenantId: actor.tenantId } }),
      'Connection',
    );
    if (c.type === ChannelType.WEB_CHAT)
      throw new ValidationError('Website chat has no verify token.');
    await this.prisma.channelConnection.update({
      where: { id },
      data: { verifyToken: randomToken(18) },
    });
    await this.audit.log(actor, {
      action: 'integrations.verify_token_rotated',
      entityType: 'ChannelConnection',
      entityId: id,
    });
    return this.get(actor.tenantId, id);
  }

  /** Removes the connection. Conversations and customers are kept. */
  async remove(actor: Actor, id: string) {
    const c = ensureFound(
      await this.prisma.channelConnection.findFirst({ where: { id, tenantId: actor.tenantId } }),
      'Connection',
    );
    await this.prisma.channelConnection.delete({ where: { id } });
    await this.audit.log(actor, {
      action: 'integrations.connection_removed',
      entityType: 'ChannelConnection',
      entityId: id,
      metadata: { type: c.type, name: c.name },
    });
    return { removed: true };
  }
}
