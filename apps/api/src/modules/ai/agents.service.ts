import { Injectable } from '@nestjs/common';
import { AIToolStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_TOOL_NAMES, AI_TONES } from '@sellora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UsageService } from '../billing/usage.service';
import { AIProviderService } from './ai-provider.service';
import { ensureFound, ValidationError } from '../../common/errors';
import { paginate, toPaginated } from '../../common/pagination';
import type { Actor } from '../../common/auth-context';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const dayWindow = z.object({ from: time, to: time }).nullable();

export const agentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).nullable().optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
  systemInstructions: z.string().trim().max(8000).default(''),
  personality: z.string().trim().max(500).nullable().optional(),
  language: z.string().trim().max(30).default('auto'),
  tone: z.enum(AI_TONES).default('friendly'),
  businessInfo: z.string().trim().max(5000).nullable().optional(),
  salesObjectives: z.string().trim().max(2000).nullable().optional(),
  escalationRules: z.string().trim().max(2000).nullable().optional(),
  workingHours: z
    .object({
      enabled: z.boolean(),
      timezone: z.string().max(60).default('UTC'),
      days: z.object({ mon: dayWindow, tue: dayWindow, wed: dayWindow, thu: dayWindow, fri: dayWindow, sat: dayWindow, sun: dayWindow }).partial(),
    })
    .nullable()
    .optional(),
  fallbackBehavior: z.enum(['handoff', 'message', 'silent']).default('handoff'),
  fallbackMessage: z.string().trim().max(1000).nullable().optional(),
  model: z.string().trim().max(100).nullable().optional(),
  temperature: z.number().min(0).max(1.5).default(0.3),
  enabledTools: z.array(z.enum(AI_TOOL_NAMES as [string, ...string[]])).max(20).default([...AI_TOOL_NAMES]),
  useKnowledgeBase: z.boolean().default(true),
  knowledgeBaseIds: z.array(z.string().uuid()).max(20).default([]),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});
export type AgentInput = z.infer<typeof agentSchema>;

export const SALES_ASSISTANT_TEMPLATE: Partial<AgentInput> = {
  name: 'Sales Assistant',
  description: 'Answers product questions, recommends products and takes orders on WhatsApp.',
  systemInstructions:
    'Greet customers warmly, understand what they need, recommend suitable products from the catalog, answer questions using the knowledge base, and help them place an order when they are ready.',
  personality: 'Helpful, knowledgeable and never pushy.',
  tone: 'friendly',
  salesObjectives: 'Convert interested customers into orders. Capture a lead when a customer is interested but not ready to buy.',
  escalationRules: 'Transfer to a human for complaints, refunds, bulk or custom pricing requests, or when the customer asks for a person.',
  fallbackMessage: 'Thanks for your message! A member of our team will get back to you shortly.',
};

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly usage: UsageService,
    private readonly ai: AIProviderService,
  ) {}

  async list(tenantId: string) {
    const agents = await this.prisma.aIAgent.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: {
        knowledgeBases: { include: { knowledgeBase: { select: { id: true, name: true } } } },
        _count: { select: { conversations: true, toolExecutions: true } },
      },
    });
    return {
      aiConfigured: await this.ai.isConfigured(tenantId),
      agents: agents.map(({ knowledgeBases, _count, ...a }) => ({
        ...a,
        knowledgeBases: knowledgeBases.map((k) => k.knowledgeBase),
        conversationCount: _count.conversations,
        toolCallCount: _count.toolExecutions,
      })),
    };
  }

  async get(tenantId: string, id: string) {
    const agent = ensureFound(
      await this.prisma.aIAgent.findFirst({
        where: { id, tenantId },
        include: { knowledgeBases: { include: { knowledgeBase: { select: { id: true, name: true } } } } },
      }),
      'AI agent',
    );
    const since = new Date(Date.now() - 30 * 86400_000);
    const [conversations, handoffs, usage] = await Promise.all([
      this.prisma.conversation.count({ where: { tenantId, aiAgentId: id, createdAt: { gte: since } } }),
      this.prisma.aIToolExecution.count({ where: { tenantId, agentId: id, toolName: 'transferToHuman', createdAt: { gte: since } } }),
      this.prisma.aIUsageLog.aggregate({ where: { tenantId, agentId: id, createdAt: { gte: since } }, _sum: { totalTokens: true, estimatedCost: true } }),
    ]);
    return {
      ...agent,
      knowledgeBaseIds: agent.knowledgeBases.map((k) => k.knowledgeBaseId),
      knowledgeBases: agent.knowledgeBases.map((k) => k.knowledgeBase),
      stats: { conversations30d: conversations, handoffs30d: handoffs, tokens30d: usage._sum.totalTokens ?? 0, cost30d: Number(usage._sum.estimatedCost ?? 0) },
    };
  }

  private async assertKnowledgeBases(tenantId: string, ids: string[]) {
    if (!ids.length) return;
    const count = await this.prisma.aIKnowledgeBase.count({ where: { tenantId, id: { in: ids } } });
    if (count !== ids.length) throw new ValidationError('One or more knowledge bases do not exist in this workspace.');
  }

  async create(actor: Actor, input: AgentInput) {
    await this.usage.assertWithin(actor.tenantId, 'aiAgents');
    await this.assertKnowledgeBases(actor.tenantId, input.knowledgeBaseIds);
    const { knowledgeBaseIds, workingHours, ...data } = input;
    const existing = await this.prisma.aIAgent.count({ where: { tenantId: actor.tenantId } });
    const agent = await this.prisma.$transaction(async (tx) => {
      const makeDefault = input.isDefault || existing === 0;
      if (makeDefault) await tx.aIAgent.updateMany({ where: { tenantId: actor.tenantId }, data: { isDefault: false } });
      return tx.aIAgent.create({
        data: {
          ...data,
          isDefault: makeDefault,
          workingHours: workingHours ?? Prisma.JsonNull,
          tenantId: actor.tenantId,
          knowledgeBases: { create: knowledgeBaseIds.map((knowledgeBaseId) => ({ knowledgeBaseId })) },
        },
      });
    });
    await this.audit.log(actor, { action: 'ai.agent_created', entityType: 'AIAgent', entityId: agent.id, metadata: { name: agent.name } });
    return this.get(actor.tenantId, agent.id);
  }

  async update(actor: Actor, id: string, input: Partial<AgentInput>) {
    ensureFound(await this.prisma.aIAgent.findFirst({ where: { id, tenantId: actor.tenantId } }), 'AI agent');
    if (input.knowledgeBaseIds) await this.assertKnowledgeBases(actor.tenantId, input.knowledgeBaseIds);
    const { knowledgeBaseIds, workingHours, ...data } = input;
    await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) await tx.aIAgent.updateMany({ where: { tenantId: actor.tenantId }, data: { isDefault: false } });
      await tx.aIAgent.update({
        where: { id },
        data: { ...data, ...(workingHours !== undefined ? { workingHours: workingHours ?? Prisma.JsonNull } : {}) },
      });
      if (knowledgeBaseIds) {
        await tx.aIAgentKnowledgeBase.deleteMany({ where: { agentId: id } });
        await tx.aIAgentKnowledgeBase.createMany({ data: knowledgeBaseIds.map((knowledgeBaseId) => ({ agentId: id, knowledgeBaseId })) });
      }
    });
    await this.audit.log(actor, { action: 'ai.agent_updated', entityType: 'AIAgent', entityId: id, metadata: { fields: Object.keys(input) } });
    return this.get(actor.tenantId, id);
  }

  async remove(actor: Actor, id: string) {
    const agent = ensureFound(await this.prisma.aIAgent.findFirst({ where: { id, tenantId: actor.tenantId } }), 'AI agent');
    await this.prisma.$transaction([
      this.prisma.conversation.updateMany({ where: { tenantId: actor.tenantId, aiAgentId: id, handler: 'AI' }, data: { handler: 'HUMAN', handoffReason: 'AI agent deleted' } }),
      this.prisma.aIAgent.delete({ where: { id } }),
    ]);
    await this.audit.log(actor, { action: 'ai.agent_deleted', entityType: 'AIAgent', entityId: id, metadata: { name: agent.name } });
    return { deleted: true };
  }

  // ------------------------------------------------------------------ usage

  async usageOverview(tenantId: string, days = 30) {
    const since = new Date(Date.now() - days * 86400_000);
    const [totals, byPurpose, byAgentRaw, daily, toolStats, limit] = await Promise.all([
      this.prisma.aIUsageLog.aggregate({ where: { tenantId, createdAt: { gte: since } }, _sum: { promptTokens: true, completionTokens: true, totalTokens: true, estimatedCost: true }, _count: { _all: true } }),
      this.prisma.aIUsageLog.groupBy({ by: ['purpose'], where: { tenantId, createdAt: { gte: since } }, _sum: { totalTokens: true, estimatedCost: true }, _count: { _all: true } }),
      this.prisma.aIUsageLog.groupBy({ by: ['agentId'], where: { tenantId, createdAt: { gte: since }, agentId: { not: null } }, _sum: { totalTokens: true, estimatedCost: true }, _count: { _all: true } }),
      this.prisma.$queryRaw<Array<{ day: Date; tokens: bigint; cost: Prisma.Decimal; calls: bigint }>>`
        SELECT date_trunc('day', "createdAt") AS day, SUM("totalTokens") AS tokens, SUM("estimatedCost") AS cost, COUNT(*) AS calls
        FROM "AIUsageLog" WHERE "tenantId" = ${tenantId}::uuid AND "createdAt" >= ${since}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.aIToolExecution.groupBy({ by: ['toolName', 'status'], where: { tenantId, createdAt: { gte: since } }, _count: { _all: true } }),
      this.usage.summary(tenantId),
    ]);
    const agents = await this.prisma.aIAgent.findMany({ where: { tenantId }, select: { id: true, name: true } });
    const names = new Map(agents.map((a) => [a.id, a.name]));
    return {
      days,
      totals: {
        requests: totals._count._all,
        promptTokens: totals._sum.promptTokens ?? 0,
        completionTokens: totals._sum.completionTokens ?? 0,
        totalTokens: totals._sum.totalTokens ?? 0,
        estimatedCost: Number(totals._sum.estimatedCost ?? 0),
      },
      byPurpose: byPurpose.map((p) => ({ purpose: p.purpose, requests: p._count._all, tokens: p._sum.totalTokens ?? 0, cost: Number(p._sum.estimatedCost ?? 0) })),
      byAgent: byAgentRaw.map((a) => ({ agentId: a.agentId, name: names.get(a.agentId!) ?? 'Deleted agent', requests: a._count._all, tokens: a._sum.totalTokens ?? 0, cost: Number(a._sum.estimatedCost ?? 0) })),
      daily: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), tokens: Number(d.tokens), cost: Number(d.cost), calls: Number(d.calls) })),
      tools: toolStats.map((t) => ({ tool: t.toolName, status: t.status, count: t._count._all })),
      aiMessagesQuota: limit.metrics.find((m) => m.metric === 'aiMessages'),
    };
  }

  async toolExecutions(tenantId: string, q: { page: number; pageSize: number; toolName?: string; status?: AIToolStatus; agentId?: string }) {
    const where: Prisma.AIToolExecutionWhereInput = {
      tenantId,
      ...(q.toolName ? { toolName: q.toolName } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.agentId ? { agentId: q.agentId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.aIToolExecution.findMany({
        where,
        include: { agent: { select: { id: true, name: true } }, conversation: { select: { id: true, customer: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
        ...paginate(q),
      }),
      this.prisma.aIToolExecution.count({ where }),
    ]);
    return toPaginated(items, total, q);
  }
}
