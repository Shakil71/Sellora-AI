import { Injectable } from '@nestjs/common';
import { LeadStatus, NotificationType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ActivityService, EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService, REALTIME_EVENTS } from '../realtime/realtime.service';
import { paginate, sortBy, toPaginated } from '../../common/pagination';
import { ensureFound, ValidationError } from '../../common/errors';
import type { Actor } from '../../common/auth-context';
import { normalizePhone } from '../../common/utils/text.util';

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v));

export const leadSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email().max(254).nullable().optional().or(z.literal('').transform(() => null)),
  phone: nullableText(30),
  company: nullableText(120),
  source: nullableText(60),
  status: z.nativeEnum(LeadStatus).optional(),
  score: z.number().int().min(0).max(100).optional(),
  value: z.number().min(0).max(1e12).nullable().optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  notes: nullableText(5000),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
});
export type LeadInput = z.infer<typeof leadSchema>;

export const leadListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  status: z.nativeEnum(LeadStatus).optional(),
  assignedUserId: z.string().uuid().optional(),
  source: z.string().trim().max(60).optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const include = {
  assignedUser: { select: { id: true, name: true, avatarUrl: true } },
  customer: { select: { id: true, name: true } },
} satisfies Prisma.LeadInclude;

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  private async assertMember(tenantId: string, userId?: string | null) {
    if (!userId) return;
    const m = await this.prisma.userRole.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
    if (!m) throw new ValidationError('The selected team member does not belong to this workspace.');
  }

  private async assertCustomer(tenantId: string, customerId?: string | null) {
    if (!customerId) return;
    ensureFound(await this.prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } }), 'Customer');
  }

  async list(tenantId: string, q: z.infer<typeof leadListSchema>) {
    const where: Prisma.LeadWhereInput = {
      tenantId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.assignedUserId ? { assignedUserId: q.assignedUserId } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
              { phone: { contains: q.search } },
              { company: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total, byStatus] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include,
        orderBy: sortBy(q.sort, ['name', 'createdAt', 'score', 'lastActivityAt', 'status'] as const, 'createdAt', q.order),
        ...paginate(q),
      }),
      this.prisma.lead.count({ where }),
      this.prisma.lead.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
    ]);
    return {
      ...toPaginated(items, total, q),
      statusCounts: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
    };
  }

  async get(tenantId: string, id: string) {
    const lead = ensureFound(
      await this.prisma.lead.findFirst({
        where: { id, tenantId },
        include: { ...include, deals: { include: { stage: { select: { name: true, color: true } } } }, tasks: { orderBy: { createdAt: 'desc' }, take: 20 } },
      }),
      'Lead',
    );
    return { ...lead, activity: await this.activity.list(tenantId, 'LEAD', id) };
  }

  async create(actor: Actor, input: LeadInput) {
    await this.assertMember(actor.tenantId, input.assignedUserId);
    await this.assertCustomer(actor.tenantId, input.customerId);
    const lead = await this.prisma.lead.create({
      data: {
        ...input,
        phone: input.phone ? (normalizePhone(input.phone) ?? input.phone) : input.phone,
        tags: input.tags ?? [],
        tenantId: actor.tenantId,
      },
      include,
    });
    await this.activity.record(actor.tenantId, 'LEAD', lead.id, 'created', `Lead created${input.source ? ` from ${input.source}` : ''}`, actor);
    await this.audit.log(actor, { action: 'lead.created', entityType: 'Lead', entityId: lead.id });
    await this.events.emit(actor.tenantId, 'lead.created', { leadId: lead.id, customerId: lead.customerId });
    await this.notifications.notify(
      actor.tenantId,
      lead.assignedUserId ? { userIds: [lead.assignedUserId] } : { roles: ['OWNER', 'ADMIN', 'MANAGER', 'SALES'] },
      { type: NotificationType.NEW_LEAD, title: `New lead: ${lead.name}`, body: lead.source ? `Source: ${lead.source}` : undefined, link: `/leads/${lead.id}` },
    );
    this.realtime.toPermission(actor.tenantId, 'crm.leads.view', REALTIME_EVENTS.LEAD_UPDATED, { id: lead.id, action: 'created' });
    return lead;
  }

  async update(actor: Actor, id: string, input: Partial<LeadInput>) {
    const current = ensureFound(await this.prisma.lead.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Lead');
    await this.assertMember(actor.tenantId, input.assignedUserId);
    await this.assertCustomer(actor.tenantId, input.customerId);
    const data: Prisma.LeadUncheckedUpdateInput = { ...input, lastActivityAt: new Date() };
    if (input.status === LeadStatus.WON && current.status !== LeadStatus.WON) data.convertedAt = new Date();
    const lead = await this.prisma.lead.update({ where: { id }, data, include });
    if (input.status && input.status !== current.status) {
      await this.activity.record(actor.tenantId, 'LEAD', id, 'status_changed', `Status changed from ${current.status} to ${input.status}`, actor);
    }
    if (input.assignedUserId && input.assignedUserId !== current.assignedUserId && input.assignedUserId !== actor.userId) {
      await this.notifications.notify(actor.tenantId, { userIds: [input.assignedUserId] }, {
        type: NotificationType.ASSIGNMENT,
        title: `Lead assigned to you: ${lead.name}`,
        link: `/leads/${lead.id}`,
      });
    }
    await this.audit.log(actor, { action: 'lead.updated', entityType: 'Lead', entityId: id, metadata: { fields: Object.keys(input) } });
    this.realtime.toPermission(actor.tenantId, 'crm.leads.view', REALTIME_EVENTS.LEAD_UPDATED, { id, action: 'updated' });
    return lead;
  }

  async remove(actor: Actor, id: string) {
    const lead = ensureFound(await this.prisma.lead.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Lead');
    await this.prisma.lead.delete({ where: { id } });
    await this.audit.log(actor, { action: 'lead.deleted', entityType: 'Lead', entityId: id, metadata: { name: lead.name } });
    this.realtime.toPermission(actor.tenantId, 'crm.leads.view', REALTIME_EVENTS.LEAD_UPDATED, { id, action: 'deleted' });
    return { deleted: true };
  }

  /** Converts a lead into a customer (if needed) and an open deal in the default pipeline. */
  async convert(actor: Actor, id: string, input: { createDeal: boolean; dealName?: string; amount?: number }) {
    const lead = ensureFound(await this.prisma.lead.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Lead');
    return this.prisma.$transaction(async (tx) => {
      let customerId = lead.customerId;
      if (!customerId) {
        const customer = await tx.customer.create({
          data: {
            tenantId: actor.tenantId,
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            company: lead.company,
            source: lead.source ?? 'lead',
            tags: lead.tags,
          },
        });
        customerId = customer.id;
      }
      let dealId: string | undefined;
      if (input.createDeal) {
        const pipeline = await tx.pipeline.findFirst({
          where: { tenantId: actor.tenantId },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          include: { stages: { orderBy: { position: 'asc' } } },
        });
        const stage = pipeline?.stages.find((s) => s.type === 'OPEN');
        if (!pipeline || !stage) throw new ValidationError('Create a pipeline with at least one open stage first.');
        const deal = await tx.deal.create({
          data: {
            tenantId: actor.tenantId,
            pipelineId: pipeline.id,
            stageId: stage.id,
            name: input.dealName ?? `${lead.company ?? lead.name} deal`,
            amount: input.amount ?? lead.value ?? 0,
            probability: stage.probability,
            customerId,
            leadId: lead.id,
            assignedUserId: lead.assignedUserId,
          },
        });
        dealId = deal.id;
      }
      await tx.lead.update({
        where: { id },
        data: { customerId, status: LeadStatus.QUALIFIED, lastActivityAt: new Date() },
      });
      await this.activity.record(actor.tenantId, 'LEAD', id, 'converted', 'Lead converted to customer', actor, { customerId, dealId });
      await this.audit.log(actor, { action: 'lead.converted', entityType: 'Lead', entityId: id, metadata: { customerId, dealId } });
      return { customerId, dealId };
    });
  }
}
