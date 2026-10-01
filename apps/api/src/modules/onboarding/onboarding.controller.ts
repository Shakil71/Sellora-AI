import { Body, Controller, Get, Injectable, Post } from '@nestjs/common';
import { MembershipStatus, TokenType } from '@prisma/client';
import { z } from 'zod';
import { CurrentActor, RequirePermissions, TenantId } from '../../common/decorators';
import type { Actor } from '../../common/auth-context';
import { zBody } from '../../common/zod.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AgentsService, SALES_ASSISTANT_TEMPLATE, AgentInput } from '../ai/agents.service';
import { decryptJson } from '../../common/utils/crypto.util';
import { env } from '../../config/env';

export const ONBOARDING_STEPS = ['business', 'workspace', 'whatsapp', 'products', 'ai', 'team', 'complete'] as const;

const progressSchema = z.object({ step: z.number().int().min(0).max(ONBOARDING_STEPS.length - 1), complete: z.boolean().optional() });
const agentSchema = z.object({
  name: z.string().trim().min(2).max(80).default('Sales Assistant'),
  tone: z.enum(['friendly', 'professional', 'enthusiastic', 'concise', 'empathetic']).default('friendly'),
  businessInfo: z.string().trim().max(3000).optional(),
  language: z.string().trim().max(30).default('auto'),
});

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly agents: AgentsService,
  ) {}

  async status(tenantId: string) {
    const [tenant, whatsapp, products, agents, members, invites] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { onboardingStep: true, onboardingCompletedAt: true, businessName: true, industry: true, country: true, currency: true, timezone: true } }),
      this.prisma.whatsAppAccount.count({ where: { tenantId } }),
      this.prisma.product.count({ where: { tenantId } }),
      this.prisma.aIAgent.count({ where: { tenantId } }),
      this.prisma.userRole.count({ where: { tenantId, status: MembershipStatus.ACTIVE } }),
      this.prisma.verificationToken.count({ where: { tenantId, type: TokenType.INVITATION, usedAt: null } }),
    ]);
    return {
      step: tenant.onboardingStep,
      completed: Boolean(tenant.onboardingCompletedAt),
      steps: ONBOARDING_STEPS,
      checklist: {
        business: Boolean(tenant.industry || tenant.country),
        workspace: Boolean(tenant.currency && tenant.timezone),
        whatsapp: whatsapp > 0,
        products: products > 0,
        ai: agents > 0,
        team: members > 1 || invites > 0,
      },
    };
  }

  /**
   * "Get ready to sell" checklist shown on the dashboard until everything is done.
   * Each item says where to fix it; nothing here changes data.
   */
  async launchChecklist(tenantId: string) {
    const [tenant, documents, agents, products, whatsapp, channels, payments] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { aiConfigEnc: true } }),
      this.prisma.aIDocument.count({ where: { tenantId } }),
      this.prisma.aIAgent.findMany({ where: { tenantId, isActive: true }, select: { enabledTools: true } }),
      this.prisma.product.count({ where: { tenantId } }),
      this.prisma.whatsAppAccount.count({ where: { tenantId } }),
      this.prisma.channelConnection.count({ where: { tenantId, status: 'CONNECTED' } }),
      this.prisma.paymentMethod.count({ where: { tenantId, isActive: true } }),
    ]);
    const ownKey = Boolean(decryptJson<{ apiKey?: string }>(tenant.aiConfigEnc)?.apiKey);
    const items = [
      { key: 'ai-key', title: 'Connect your AI', description: 'Add an OpenAI key so the agent can reply.', href: '/settings/ai', done: ownKey || Boolean(env.OPENAI_API_KEY) },
      { key: 'products', title: 'Add your products', description: 'Add them one by one, or import your whole store automatically.', href: '/products', done: products > 0 },
      { key: 'knowledge', title: 'Teach the AI your policies', description: 'Upload delivery, returns and FAQ documents.', href: '/ai/knowledge', done: documents > 0 },
      { key: 'agent', title: 'Set up your AI agent', description: 'Choose its tone, rules and what it may do.', href: '/ai/agents', done: agents.length > 0 },
      { key: 'channel', title: 'Connect a channel', description: 'WhatsApp, website chat, Messenger or Instagram.', href: '/integrations', done: whatsapp + channels > 0 },
      { key: 'payments', title: 'Choose how customers pay', description: 'Add a gateway, bKash, bank transfer or cash on delivery.', href: '/integrations/payments', done: payments > 0 },
    ];
    if (agents.length && payments > 0 && !agents.some((a) => a.enabledTools.includes('requestPayment'))) {
      items.push({ key: 'agent-payments', title: 'Let your AI send payment links', description: 'Turn on the payment tools in your agent settings.', href: '/ai/agents', done: false });
    }
    return { items, done: items.filter((i) => i.done).length, total: items.length };
  }

  async progress(actor: Actor, input: z.infer<typeof progressSchema>) {
    await this.prisma.tenant.update({
      where: { id: actor.tenantId },
      data: { onboardingStep: input.step, ...(input.complete ? { onboardingCompletedAt: new Date() } : {}) },
    });
    if (input.complete) await this.audit.log(actor, { action: 'workspace.onboarding_completed', entityType: 'Tenant', entityId: actor.tenantId });
    return this.status(actor.tenantId);
  }

  /** Creates the first AI Sales Agent from the template, or updates it when it exists. */
  async setupAgent(actor: Actor, input: z.infer<typeof agentSchema>) {
    const existing = await this.prisma.aIAgent.findFirst({ where: { tenantId: actor.tenantId }, orderBy: { createdAt: 'asc' } });
    const kbs = await this.prisma.aIKnowledgeBase.findMany({ where: { tenantId: actor.tenantId }, select: { id: true } });
    if (existing) return this.agents.update(actor, existing.id, { name: input.name, tone: input.tone, language: input.language, businessInfo: input.businessInfo ?? null });
    return this.agents.create(actor, {
      ...(SALES_ASSISTANT_TEMPLATE as AgentInput),
      ...input,
      businessInfo: input.businessInfo ?? null,
      knowledgeBaseIds: kbs.map((k) => k.id),
      isActive: true,
      isDefault: true,
      useKnowledgeBase: true,
      temperature: 0.3,
      fallbackBehavior: 'handoff',
      enabledTools: [
        'searchProducts', 'getProductDetails', 'checkInventory', 'calculateOrderTotal', 'checkDeliveryAvailability', 'getOrderStatus',
        'getCustomerHistory', 'createLead', 'updateCustomer', 'createOrder', 'getPaymentOptions', 'requestPayment', 'createTask', 'transferToHuman',
      ],
    } as AgentInput);
  }
}

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  status(@TenantId() tenantId: string) {
    return this.onboarding.status(tenantId);
  }

  @Get('launch-checklist')
  launchChecklist(@TenantId() tenantId: string) {
    return this.onboarding.launchChecklist(tenantId);
  }

  @Post('progress')
  @RequirePermissions('settings.update')
  progress(@CurrentActor() actor: Actor, @Body(zBody(progressSchema)) body: z.infer<typeof progressSchema>) {
    return this.onboarding.progress(actor, body);
  }

  @Post('ai-agent')
  @RequirePermissions('ai.agents.create', 'ai.agents.update')
  agent(@CurrentActor() actor: Actor, @Body(zBody(agentSchema)) body: z.infer<typeof agentSchema>) {
    return this.onboarding.setupAgent(actor, body);
  }
}
