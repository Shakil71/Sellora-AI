import { Injectable } from '@nestjs/common';
import { DealStatus, Prisma, Priority, StageType } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ActivityService } from '../events/events.service';
import { ensureFound, ValidationError } from '../../common/errors';
import type { Actor } from '../../common/auth-context';

export const pipelineSchema = z.object({
  name: z.string().trim().min(1).max(80),
  isDefault: z.boolean().optional(),
  stages: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(60),
        probability: z.number().int().min(0).max(100).default(0),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        type: z.nativeEnum(StageType).default(StageType.OPEN),
      }),
    )
    .min(2, 'A pipeline needs at least two stages')
    .max(20),
});

export const dealSchema = z.object({
  name: z.string().trim().min(1).max(150),
  pipelineId: z.string().uuid(),
  stageId: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional(),
  leadId: z.string().uuid().nullable().optional(),
  amount: z.number().min(0).max(1e12).default(0),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.coerce.date().nullable().optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  priority: z.nativeEnum(Priority).default(Priority.MEDIUM),
  notes: z.string().trim().max(5000).nullable().optional(),
});

export const dealListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  pipelineId: z.string().uuid().optional(),
  status: z.nativeEnum(DealStatus).optional(),
  assignedUserId: z.string().uuid().optional(),
});

export const moveDealSchema = z.object({
  stageId: z.string().uuid(),
  /** Index within the target stage after the move */
  index: z.number().int().min(0).max(100000),
});

const dealInclude = {
  customer: { select: { id: true, name: true, avatarUrl: true } },
  assignedUser: { select: { id: true, name: true, avatarUrl: true } },
  stage: { select: { id: true, name: true, color: true, type: true } },
} satisfies Prisma.DealInclude;

@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
  ) {}

  // -------------------------------------------------------------- pipelines

  listPipelines(tenantId: string) {
    return this.prisma.pipeline.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: { stages: { orderBy: { position: 'asc' } }, _count: { select: { deals: true } } },
    });
  }

  async createPipeline(actor: Actor, input: z.infer<typeof pipelineSchema>) {
    const pipeline = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) await tx.pipeline.updateMany({ where: { tenantId: actor.tenantId }, data: { isDefault: false } });
      return tx.pipeline.create({
        data: {
          tenantId: actor.tenantId,
          name: input.name,
          isDefault: input.isDefault ?? false,
          stages: {
            create: input.stages.map((s, i) => ({ tenantId: actor.tenantId, name: s.name, probability: s.probability, color: s.color, type: s.type, position: i })),
          },
        },
        include: { stages: { orderBy: { position: 'asc' } } },
      });
    });
    await this.audit.log(actor, { action: 'pipeline.created', entityType: 'Pipeline', entityId: pipeline.id });
    return pipeline;
  }

  /** Updates a pipeline and reconciles its stages (create / update / delete unused). */
  async updatePipeline(actor: Actor, id: string, input: z.infer<typeof pipelineSchema>) {
    const pipeline = ensureFound(
      await this.prisma.pipeline.findFirst({ where: { id, tenantId: actor.tenantId }, include: { stages: true } }),
      'Pipeline',
    );
    const keepIds = new Set(input.stages.map((s) => s.id).filter(Boolean) as string[]);
    const removed = pipeline.stages.filter((s) => !keepIds.has(s.id));
    if (removed.length) {
      const inUse = await this.prisma.deal.count({ where: { stageId: { in: removed.map((s) => s.id) } } });
      if (inUse) throw new ValidationError('Move deals out of the stages you are removing first.');
    }
    await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) await tx.pipeline.updateMany({ where: { tenantId: actor.tenantId }, data: { isDefault: false } });
      await tx.pipeline.update({ where: { id }, data: { name: input.name, ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}) } });
      if (removed.length) await tx.pipelineStage.deleteMany({ where: { id: { in: removed.map((s) => s.id) } } });
      for (const [i, s] of input.stages.entries()) {
        if (s.id && pipeline.stages.some((x) => x.id === s.id)) {
          await tx.pipelineStage.update({ where: { id: s.id }, data: { name: s.name, probability: s.probability, color: s.color, type: s.type, position: i } });
        } else {
          await tx.pipelineStage.create({ data: { tenantId: actor.tenantId, pipelineId: id, name: s.name, probability: s.probability, color: s.color, type: s.type, position: i } });
        }
      }
    });
    await this.audit.log(actor, { action: 'pipeline.updated', entityType: 'Pipeline', entityId: id });
    return this.prisma.pipeline.findUnique({ where: { id }, include: { stages: { orderBy: { position: 'asc' } } } });
  }

  async deletePipeline(actor: Actor, id: string) {
    const pipeline = ensureFound(
      await this.prisma.pipeline.findFirst({ where: { id, tenantId: actor.tenantId }, include: { _count: { select: { deals: true } } } }),
      'Pipeline',
    );
    if (pipeline._count.deals) throw new ValidationError('Delete or move the deals in this pipeline first.');
    const count = await this.prisma.pipeline.count({ where: { tenantId: actor.tenantId } });
    if (count <= 1) throw new ValidationError('A workspace needs at least one pipeline.');
    await this.prisma.pipeline.delete({ where: { id } });
    await this.audit.log(actor, { action: 'pipeline.deleted', entityType: 'Pipeline', entityId: id });
    return { deleted: true };
  }

  // ------------------------------------------------------------------ board

  async board(tenantId: string, pipelineId: string, filters: { assignedUserId?: string; search?: string }) {
    const pipeline = ensureFound(
      await this.prisma.pipeline.findFirst({ where: { id: pipelineId, tenantId }, include: { stages: { orderBy: { position: 'asc' } } } }),
      'Pipeline',
    );
    const deals = await this.prisma.deal.findMany({
      where: {
        tenantId,
        pipelineId,
        ...(filters.assignedUserId ? { assignedUserId: filters.assignedUserId } : {}),
        ...(filters.search ? { name: { contains: filters.search, mode: 'insensitive' } } : {}),
      },
      include: dealInclude,
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      take: 1000,
    });
    return {
      pipeline,
      stages: pipeline.stages.map((stage) => {
        const stageDeals = deals.filter((d) => d.stageId === stage.id);
        return {
          ...stage,
          deals: stageDeals,
          totalAmount: stageDeals.reduce((sum, d) => sum + Number(d.amount), 0),
          count: stageDeals.length,
        };
      }),
    };
  }

  private async validateRefs(tenantId: string, input: Partial<z.infer<typeof dealSchema>>) {
    if (input.pipelineId && input.stageId) {
      ensureFound(
        await this.prisma.pipelineStage.findFirst({ where: { id: input.stageId, pipelineId: input.pipelineId, tenantId } }),
        'Pipeline stage',
      );
    }
    if (input.customerId) ensureFound(await this.prisma.customer.findFirst({ where: { id: input.customerId, tenantId } }), 'Customer');
    if (input.leadId) ensureFound(await this.prisma.lead.findFirst({ where: { id: input.leadId, tenantId } }), 'Lead');
    if (input.assignedUserId) {
      ensureFound(await this.prisma.userRole.findUnique({ where: { tenantId_userId: { tenantId, userId: input.assignedUserId } } }), 'Team member');
    }
  }

  async list(tenantId: string, q: z.infer<typeof dealListSchema>) {
    const where: Prisma.DealWhereInput = {
      tenantId,
      ...(q.pipelineId ? { pipelineId: q.pipelineId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.assignedUserId ? { assignedUserId: q.assignedUserId } : {}),
      ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { customer: { name: { contains: q.search, mode: 'insensitive' } } }] } : {}),
    };
    const [items, total, sums] = await Promise.all([
      this.prisma.deal.findMany({ where, include: { ...dealInclude, pipeline: { select: { id: true, name: true } } }, orderBy: { updatedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.deal.count({ where }),
      this.prisma.deal.groupBy({ by: ['status'], where: { tenantId }, _sum: { amount: true }, _count: { _all: true } }),
    ]);
    return {
      items,
      meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
      summary: sums.map((x) => ({ status: x.status, count: x._count._all, amount: Number(x._sum.amount ?? 0) })),
    };
  }

  async get(tenantId: string, id: string) {
    const deal = ensureFound(
      await this.prisma.deal.findFirst({ where: { id, tenantId }, include: { ...dealInclude, lead: { select: { id: true, name: true } }, tasks: { orderBy: { createdAt: 'desc' } } } }),
      'Deal',
    );
    return { ...deal, activity: await this.activity.list(tenantId, 'DEAL', id) };
  }

  async create(actor: Actor, input: z.infer<typeof dealSchema>) {
    await this.validateRefs(actor.tenantId, input);
    const stage = await this.prisma.pipelineStage.findUniqueOrThrow({ where: { id: input.stageId } });
    const last = await this.prisma.deal.findFirst({ where: { stageId: stage.id }, orderBy: { position: 'desc' }, select: { position: true } });
    const deal = await this.prisma.deal.create({
      data: {
        ...input,
        tenantId: actor.tenantId,
        probability: input.probability ?? stage.probability,
        status: stage.type === StageType.WON ? DealStatus.WON : stage.type === StageType.LOST ? DealStatus.LOST : DealStatus.OPEN,
        position: (last?.position ?? 0) + 1000,
      },
      include: dealInclude,
    });
    await this.activity.record(actor.tenantId, 'DEAL', deal.id, 'created', `Deal created in ${stage.name}`, actor);
    await this.audit.log(actor, { action: 'deal.created', entityType: 'Deal', entityId: deal.id });
    return deal;
  }

  async update(actor: Actor, id: string, input: Partial<z.infer<typeof dealSchema>>) {
    const current = ensureFound(await this.prisma.deal.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Deal');
    await this.validateRefs(actor.tenantId, { ...input, pipelineId: input.pipelineId ?? current.pipelineId, stageId: input.stageId ?? current.stageId });
    const deal = await this.prisma.deal.update({ where: { id }, data: { ...input, lastActivityAt: new Date() }, include: dealInclude });
    await this.audit.log(actor, { action: 'deal.updated', entityType: 'Deal', entityId: id, metadata: { fields: Object.keys(input) } });
    return deal;
  }

  /** Moves a deal to a stage/position (drag & drop). Positions use fractional ordering. */
  async move(actor: Actor, id: string, input: z.infer<typeof moveDealSchema>) {
    const deal = ensureFound(await this.prisma.deal.findFirst({ where: { id, tenantId: actor.tenantId }, include: { stage: true } }), 'Deal');
    const stage = ensureFound(
      await this.prisma.pipelineStage.findFirst({ where: { id: input.stageId, pipelineId: deal.pipelineId, tenantId: actor.tenantId } }),
      'Pipeline stage',
    );
    const siblings = await this.prisma.deal.findMany({
      where: { stageId: stage.id, id: { not: id } },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { position: true },
    });
    const before = siblings[input.index - 1]?.position;
    const after = siblings[input.index]?.position;
    const position =
      before === undefined && after === undefined ? 1000 : before === undefined ? after! - 1000 : after === undefined ? before + 1000 : (before + after) / 2;
    const status = stage.type === StageType.WON ? DealStatus.WON : stage.type === StageType.LOST ? DealStatus.LOST : DealStatus.OPEN;
    const updated = await this.prisma.deal.update({
      where: { id },
      data: {
        stageId: stage.id,
        position,
        status,
        probability: stage.probability,
        lastActivityAt: new Date(),
        closedAt: status === DealStatus.OPEN ? null : (deal.closedAt ?? new Date()),
      },
      include: dealInclude,
    });
    if (deal.stageId !== stage.id) {
      await this.activity.record(actor.tenantId, 'DEAL', id, 'stage_changed', `Moved from ${deal.stage.name} to ${stage.name}`, actor);
      await this.audit.log(actor, { action: 'deal.stage_changed', entityType: 'Deal', entityId: id, metadata: { from: deal.stage.name, to: stage.name } });
    }
    return updated;
  }

  async remove(actor: Actor, id: string) {
    const deal = ensureFound(await this.prisma.deal.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Deal');
    await this.prisma.deal.delete({ where: { id } });
    await this.audit.log(actor, { action: 'deal.deleted', entityType: 'Deal', entityId: id, metadata: { name: deal.name } });
    return { deleted: true };
  }
}
