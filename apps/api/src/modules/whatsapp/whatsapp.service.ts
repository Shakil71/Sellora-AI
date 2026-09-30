import { Injectable, Logger } from '@nestjs/common';
import { Prisma, TemplateStatus, WhatsAppAccountStatus } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WhatsAppGraphClient } from './whatsapp-graph.client';
import { decryptSecret, encryptSecret, maskSecret, randomToken } from '../../common/utils/crypto.util';
import { AppException, ConflictError, ensureFound, ValidationError } from '../../common/errors';
import { paginate, toPaginated } from '../../common/pagination';
import { env } from '../../config/env';
import type { Actor } from '../../common/auth-context';

export const accountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, 'Phone number ID must be numeric'),
  wabaId: z.string().trim().regex(/^\d{5,30}$/, 'WhatsApp Business Account ID must be numeric'),
  accessToken: z.string().trim().min(20).max(1000),
  appSecret: z.string().trim().min(8).max(200).optional(),
  verifyToken: z.string().trim().min(8).max(100).optional(),
  defaultAgentId: z.string().uuid().nullable().optional(),
  isDefault: z.boolean().optional(),
});

export const accountUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  accessToken: z.string().trim().min(20).max(1000).optional(),
  appSecret: z.string().trim().min(8).max(200).optional(),
  defaultAgentId: z.string().uuid().nullable().optional(),
  isDefault: z.boolean().optional(),
  status: z.enum(['DISCONNECTED']).optional(),
});

export const templateSchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, 'Use lowercase letters, numbers and underscores'),
  language: z.string().trim().min(2).max(10),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
  body: z.string().trim().min(1).max(1024),
  header: z.string().trim().max(60).optional(),
  footer: z.string().trim().max(60).optional(),
});

const safeAccountSelect = {
  id: true,
  name: true,
  phoneNumberId: true,
  wabaId: true,
  displayPhoneNumber: true,
  verifiedName: true,
  verifyToken: true,
  status: true,
  qualityRating: true,
  lastError: true,
  lastVerifiedAt: true,
  isDefault: true,
  defaultAgentId: true,
  defaultAgent: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
  accessTokenEnc: true,
  appSecretEnc: true,
} satisfies Prisma.WhatsAppAccountSelect;

type SafeAccount = Prisma.WhatsAppAccountGetPayload<{ select: typeof safeAccountSelect }>;

function present(a: SafeAccount) {
  const { accessTokenEnc, appSecretEnc, ...rest } = a;
  let tokenHint: string | null = null;
  try {
    tokenHint = maskSecret(decryptSecret(accessTokenEnc));
  } catch {
    tokenHint = '••••';
  }
  return { ...rest, accessTokenHint: tokenHint, hasAppSecret: Boolean(appSecretEnc) || Boolean(env.WHATSAPP_APP_SECRET) };
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly graph: WhatsAppGraphClient,
  ) {}

  webhookUrl() {
    return `${env.API_URL}/api/v1/webhooks/whatsapp`;
  }

  environmentDefaults() {
    return {
      hasPhoneNumberId: Boolean(env.WHATSAPP_PHONE_NUMBER_ID),
      hasBusinessAccountId: Boolean(env.WHATSAPP_BUSINESS_ACCOUNT_ID),
      hasAccessToken: Boolean(env.WHATSAPP_ACCESS_TOKEN),
      hasAppSecret: Boolean(env.WHATSAPP_APP_SECRET),
      hasVerifyToken: Boolean(env.WHATSAPP_VERIFY_TOKEN),
    };
  }

  async listAccounts(tenantId: string) {
    const accounts = await this.prisma.whatsAppAccount.findMany({ where: { tenantId }, select: safeAccountSelect, orderBy: { createdAt: 'asc' } });
    return { accounts: accounts.map(present), webhookUrl: this.webhookUrl(), environment: this.environmentDefaults() };
  }

  private async assertAgent(tenantId: string, agentId?: string | null) {
    if (!agentId) return;
    ensureFound(await this.prisma.aIAgent.findFirst({ where: { id: agentId, tenantId } }), 'AI agent');
  }

  async createAccount(actor: Actor, input: z.infer<typeof accountSchema>) {
    await this.assertAgent(actor.tenantId, input.defaultAgentId);
    const exists = await this.prisma.whatsAppAccount.findUnique({ where: { phoneNumberId: input.phoneNumberId } });
    if (exists) throw new ConflictError('This phone number is already connected to a workspace.');
    const count = await this.prisma.whatsAppAccount.count({ where: { tenantId: actor.tenantId } });
    const account = await this.prisma.whatsAppAccount.create({
      data: {
        tenantId: actor.tenantId,
        name: input.name,
        phoneNumberId: input.phoneNumberId,
        wabaId: input.wabaId,
        accessTokenEnc: encryptSecret(input.accessToken),
        appSecretEnc: input.appSecret ? encryptSecret(input.appSecret) : null,
        verifyToken: input.verifyToken ?? randomToken(18),
        defaultAgentId: input.defaultAgentId ?? null,
        isDefault: input.isDefault ?? count === 0,
      },
    });
    await this.audit.log(actor, { action: 'whatsapp.account_connected', entityType: 'WhatsAppAccount', entityId: account.id, metadata: { name: input.name, phoneNumberId: input.phoneNumberId } });
    await this.verify(actor, account.id).catch(() => undefined);
    return this.getAccount(actor.tenantId, account.id);
  }

  /** Creates an account from the WHATSAPP_* environment variables (single-tenant installs). */
  async importFromEnvironment(actor: Actor) {
    if (!env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_BUSINESS_ACCOUNT_ID) {
      throw new AppException(
        'NOT_CONFIGURED',
        'WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID and WHATSAPP_ACCESS_TOKEN must be set on the server.',
        412,
      );
    }
    return this.createAccount(actor, {
      name: 'WhatsApp (server config)',
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      wabaId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    });
  }

  async getAccount(tenantId: string, id: string) {
    return present(ensureFound(await this.prisma.whatsAppAccount.findFirst({ where: { id, tenantId }, select: safeAccountSelect }), 'WhatsApp account'));
  }

  async updateAccount(actor: Actor, id: string, input: z.infer<typeof accountUpdateSchema>) {
    ensureFound(await this.prisma.whatsAppAccount.findFirst({ where: { id, tenantId: actor.tenantId } }), 'WhatsApp account');
    await this.assertAgent(actor.tenantId, input.defaultAgentId);
    await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) await tx.whatsAppAccount.updateMany({ where: { tenantId: actor.tenantId }, data: { isDefault: false } });
      await tx.whatsAppAccount.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.accessToken ? { accessTokenEnc: encryptSecret(input.accessToken), status: WhatsAppAccountStatus.PENDING } : {}),
          ...(input.appSecret ? { appSecretEnc: encryptSecret(input.appSecret) } : {}),
          ...(input.defaultAgentId !== undefined ? { defaultAgentId: input.defaultAgentId } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
      });
    });
    await this.audit.log(actor, {
      action: 'whatsapp.account_updated',
      entityType: 'WhatsAppAccount',
      entityId: id,
      metadata: { fields: Object.keys(input).map((k) => (k === 'accessToken' || k === 'appSecret' ? `${k} (changed)` : k)) },
    });
    if (input.accessToken) await this.verify(actor, id).catch(() => undefined);
    return this.getAccount(actor.tenantId, id);
  }

  async regenerateVerifyToken(actor: Actor, id: string) {
    ensureFound(await this.prisma.whatsAppAccount.findFirst({ where: { id, tenantId: actor.tenantId } }), 'WhatsApp account');
    await this.prisma.whatsAppAccount.update({ where: { id }, data: { verifyToken: randomToken(18) } });
    await this.audit.log(actor, { action: 'whatsapp.verify_token_rotated', entityType: 'WhatsAppAccount', entityId: id });
    return this.getAccount(actor.tenantId, id);
  }

  /** Calls the Graph API to confirm the token and phone number are valid. */
  async verify(actor: Actor, id: string) {
    const account = ensureFound(await this.prisma.whatsAppAccount.findFirst({ where: { id, tenantId: actor.tenantId } }), 'WhatsApp account');
    try {
      const info = await this.graph.getPhoneNumber(account.phoneNumberId, decryptSecret(account.accessTokenEnc));
      await this.prisma.whatsAppAccount.update({
        where: { id },
        data: {
          status: WhatsAppAccountStatus.CONNECTED,
          displayPhoneNumber: info.display_phone_number ?? account.displayPhoneNumber,
          verifiedName: info.verified_name ?? account.verifiedName,
          qualityRating: info.quality_rating ?? null,
          lastError: null,
          lastVerifiedAt: new Date(),
        },
      });
    } catch (err) {
      await this.prisma.whatsAppAccount.update({ where: { id }, data: { status: WhatsAppAccountStatus.ERROR, lastError: (err as Error).message.slice(0, 500) } });
    }
    return this.getAccount(actor.tenantId, id);
  }

  async removeAccount(actor: Actor, id: string) {
    const account = ensureFound(await this.prisma.whatsAppAccount.findFirst({ where: { id, tenantId: actor.tenantId } }), 'WhatsApp account');
    await this.prisma.whatsAppAccount.delete({ where: { id } });
    await this.audit.log(actor, { action: 'whatsapp.account_removed', entityType: 'WhatsAppAccount', entityId: id, metadata: { name: account.name } });
    return { deleted: true };
  }

  // -------------------------------------------------------------- templates

  listTemplates(tenantId: string, accountId?: string) {
    return this.prisma.messageTemplate.findMany({
      where: { tenantId, ...(accountId ? { accountId } : {}) },
      include: { account: { select: { id: true, name: true } } },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
  }

  async syncTemplates(actor: Actor, accountId: string) {
    const account = ensureFound(await this.prisma.whatsAppAccount.findFirst({ where: { id: accountId, tenantId: actor.tenantId } }), 'WhatsApp account');
    const res = await this.graph.listTemplates(account.wabaId, decryptSecret(account.accessTokenEnc));
    let synced = 0;
    for (const t of res.data ?? []) {
      const status = (Object.values(TemplateStatus) as string[]).includes(t.status) ? (t.status as TemplateStatus) : TemplateStatus.PENDING;
      await this.prisma.messageTemplate.upsert({
        where: { accountId_name_language: { accountId, name: t.name, language: t.language } },
        create: { tenantId: actor.tenantId, accountId, name: t.name, language: t.language, category: t.category, status, components: t.components as Prisma.InputJsonValue, externalId: t.id, rejectedReason: t.rejected_reason },
        update: { category: t.category, status, components: t.components as Prisma.InputJsonValue, externalId: t.id, rejectedReason: t.rejected_reason },
      });
      synced++;
    }
    await this.audit.log(actor, { action: 'whatsapp.templates_synced', entityType: 'WhatsAppAccount', entityId: accountId, metadata: { count: synced } });
    return { synced };
  }

  async createTemplate(actor: Actor, input: z.infer<typeof templateSchema>) {
    const account = ensureFound(await this.prisma.whatsAppAccount.findFirst({ where: { id: input.accountId, tenantId: actor.tenantId } }), 'WhatsApp account');
    const components: Array<Record<string, unknown>> = [];
    if (input.header) components.push({ type: 'HEADER', format: 'TEXT', text: input.header });
    components.push({ type: 'BODY', text: input.body });
    if (input.footer) components.push({ type: 'FOOTER', text: input.footer });
    const res = await this.graph.createTemplate(account.wabaId, decryptSecret(account.accessTokenEnc), {
      name: input.name,
      language: input.language,
      category: input.category,
      components,
    });
    const template = await this.prisma.messageTemplate.upsert({
      where: { accountId_name_language: { accountId: account.id, name: input.name, language: input.language } },
      create: {
        tenantId: actor.tenantId,
        accountId: account.id,
        name: input.name,
        language: input.language,
        category: res.category ?? input.category,
        status: (res.status as TemplateStatus) ?? TemplateStatus.PENDING,
        components: components as Prisma.InputJsonValue,
        externalId: res.id,
      },
      update: { status: (res.status as TemplateStatus) ?? TemplateStatus.PENDING, components: components as Prisma.InputJsonValue, externalId: res.id },
    });
    await this.audit.log(actor, { action: 'whatsapp.template_created', entityType: 'MessageTemplate', entityId: template.id, metadata: { name: input.name } });
    return template;
  }

  async deleteTemplate(actor: Actor, id: string) {
    const template = ensureFound(await this.prisma.messageTemplate.findFirst({ where: { id, tenantId: actor.tenantId }, include: { account: true } }), 'Template');
    try {
      await this.graph.deleteTemplate(template.account.wabaId, decryptSecret(template.account.accessTokenEnc), template.name);
    } catch (err) {
      this.logger.warn(`Template delete on Meta failed: ${(err as Error).message}`);
      throw new ValidationError(`WhatsApp rejected the deletion: ${(err as Error).message}`);
    }
    await this.prisma.messageTemplate.delete({ where: { id } });
    await this.audit.log(actor, { action: 'whatsapp.template_deleted', entityType: 'MessageTemplate', entityId: id, metadata: { name: template.name } });
    return { deleted: true };
  }

  // -------------------------------------------------------------- contacts

  async listContacts(tenantId: string, q: { page: number; pageSize: number; search?: string; accountId?: string }) {
    const where: Prisma.WhatsAppContactWhereInput = {
      tenantId,
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.search ? { OR: [{ waId: { contains: q.search } }, { profileName: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.whatsAppContact.findMany({
        where,
        include: { customer: { select: { id: true, name: true } }, account: { select: { id: true, name: true } } },
        orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        ...paginate(q),
      }),
      this.prisma.whatsAppContact.count({ where }),
    ]);
    return toPaginated(items, total, q);
  }

  async webhookEvents(tenantId: string, q: { page: number; pageSize: number; status?: string }) {
    const where: Prisma.WebhookEventWhereInput = { tenantId, provider: 'whatsapp', ...(q.status ? { status: q.status as never } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.webhookEvent.findMany({ where, orderBy: { createdAt: 'desc' }, ...paginate(q) }),
      this.prisma.webhookEvent.count({ where }),
    ]);
    return toPaginated(items, total, q);
  }
}
