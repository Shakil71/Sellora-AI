import { Body, Controller, Get, Injectable, Post } from '@nestjs/common';
import { MembershipStatus, TokenType } from '@prisma/client';
import { z } from 'zod';
import { CurrentActor, RequirePermissions, TenantId } from '../../common/decorators';
import type { Actor } from '../../common/auth-context';
import { zBody } from '../../common/zod.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AgentsService, SALES_ASSISTANT_TEMPLATE, AgentInput } from '../ai/agents.service';

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
        'getCustomerHistory', 'createLead', 'updateCustomer', 'createOrder', 'createTask', 'transferToHuman',
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
