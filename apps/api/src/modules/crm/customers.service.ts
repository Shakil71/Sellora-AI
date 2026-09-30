import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ActivityService } from '../events/events.service';
import { paginate, sortBy, toPaginated } from '../../common/pagination';
import { ensureFound, ValidationError } from '../../common/errors';
import { normalizePhone } from '../../common/utils/text.util';
import type { Actor } from '../../common/auth-context';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v));

export const customerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email().max(254).nullable().optional().or(z.literal('').transform(() => null)),
  phone: optionalText(30),
  whatsappNumber: optionalText(30),
  company: optionalText(120),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  notes: optionalText(5000),
  addressLine: optionalText(250),
  city: optionalText(80),
  country: optionalText(80),
  postalCode: optionalText(20),
  source: optionalText(60),
});
export type CustomerInput = z.infer<typeof customerSchema>;

export const customerListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  tag: z.string().trim().max(40).optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const COUNTED_STATUSES: OrderStatus[] = ['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED'];

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
  ) {}

  private normalize<T extends Partial<CustomerInput>>(input: T): T {
    const out = { ...input };
    if (input.phone !== undefined) out.phone = input.phone ? (normalizePhone(input.phone) ?? input.phone) : null;
    if (input.whatsappNumber !== undefined)
      out.whatsappNumber = input.whatsappNumber ? (normalizePhone(input.whatsappNumber) ?? null) : null;
    if (input.tags) out.tags = [...new Set(input.tags.map((t) => t.toLowerCase()))];
    return out;
  }

  async list(tenantId: string, q: z.infer<typeof customerListSchema>) {
    const where: Prisma.CustomerWhereInput = {
      tenantId,
      ...(q.tag ? { tags: { has: q.tag.toLowerCase() } } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
              { phone: { contains: q.search } },
              { whatsappNumber: { contains: q.search } },
              { company: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: sortBy(q.sort, ['name', 'createdAt', 'totalSpent', 'lastInteractionAt', 'ordersCount'] as const, 'createdAt', q.order),
        ...paginate(q),
      }),
      this.prisma.customer.count({ where }),
    ]);
    return toPaginated(items, total, q);
  }

  async get(tenantId: string, id: string) {
    const customer = ensureFound(await this.prisma.customer.findFirst({ where: { id, tenantId } }), 'Customer');
    const [orders, conversations, leads, deals, tasks, activity] = await Promise.all([
      this.prisma.order.findMany({
        where: { tenantId, customerId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, number: true, status: true, paymentStatus: true, total: true, currency: true, createdAt: true },
      }),
      this.prisma.conversation.findMany({
        where: { tenantId, customerId: id },
        orderBy: { lastMessageAt: 'desc' },
        take: 10,
        select: { id: true, status: true, handler: true, channel: true, lastMessageAt: true, lastMessagePreview: true, summary: true },
      }),
      this.prisma.lead.findMany({ where: { tenantId, customerId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.deal.findMany({
        where: { tenantId, customerId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { stage: { select: { name: true, color: true } } },
      }),
      this.prisma.task.findMany({ where: { tenantId, customerId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.activity.list(tenantId, 'CUSTOMER', id, 30),
    ]);
    return { ...customer, orders, conversations, leads, deals, tasks, activity };
  }

  private async assertUnique(tenantId: string, input: Partial<CustomerInput>, excludeId?: string) {
    const checks: Prisma.CustomerWhereInput[] = [];
    if (input.email) checks.push({ email: input.email });
    if (input.whatsappNumber) checks.push({ whatsappNumber: input.whatsappNumber });
    if (!checks.length) return;
    const dup = await this.prisma.customer.findFirst({
      where: { tenantId, OR: checks, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, name: true },
    });
    if (dup) throw new ValidationError(`A customer with this email or WhatsApp number already exists (${dup.name}).`);
  }

  async create(actor: Actor, input: CustomerInput) {
    const data = this.normalize(input);
    await this.assertUnique(actor.tenantId, data);
    const customer = await this.prisma.customer.create({
      data: { ...data, tags: data.tags ?? [], tenantId: actor.tenantId, lastInteractionAt: new Date() },
    });
    await this.activity.record(actor.tenantId, 'CUSTOMER', customer.id, 'created', 'Customer created', actor);
    await this.audit.log(actor, { action: 'customer.created', entityType: 'Customer', entityId: customer.id });
    return customer;
  }

  async update(actor: Actor, id: string, input: Partial<CustomerInput>) {
    ensureFound(await this.prisma.customer.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Customer');
    const data = this.normalize(input);
    await this.assertUnique(actor.tenantId, data, id);
    const customer = await this.prisma.customer.update({ where: { id }, data });
    await this.activity.record(actor.tenantId, 'CUSTOMER', id, 'updated', 'Customer details updated', actor, { fields: Object.keys(input) });
    await this.audit.log(actor, { action: 'customer.updated', entityType: 'Customer', entityId: id, metadata: { fields: Object.keys(input) } });
    return customer;
  }

  async remove(actor: Actor, id: string) {
    const customer = ensureFound(
      await this.prisma.customer.findFirst({ where: { id, tenantId: actor.tenantId }, include: { _count: { select: { orders: true, invoices: true } } } }),
      'Customer',
    );
    if (customer._count.orders > 0 || customer._count.invoices > 0) {
      throw new ValidationError('This customer has orders or invoices and cannot be deleted.');
    }
    await this.prisma.customer.delete({ where: { id } });
    await this.audit.log(actor, { action: 'customer.deleted', entityType: 'Customer', entityId: id, metadata: { name: customer.name } });
    return { deleted: true };
  }

  async tags(tenantId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
      SELECT unnest(tags) AS tag, COUNT(*) AS count FROM "Customer" WHERE "tenantId" = ${tenantId}::uuid GROUP BY tag ORDER BY count DESC LIMIT 100`;
    return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
  }

  /** Finds a customer by WhatsApp number or creates one (used by inbound messages). */
  async findOrCreateByWhatsApp(tenantId: string, waId: string, profileName?: string) {
    const phone = normalizePhone(waId) ?? `+${waId}`;
    const existing = await this.prisma.customer.findFirst({
      where: { tenantId, OR: [{ whatsappNumber: phone }, { phone }] },
    });
    if (existing) {
      if (!existing.whatsappNumber) {
        return this.prisma.customer.update({ where: { id: existing.id }, data: { whatsappNumber: phone } });
      }
      return existing;
    }
    return this.prisma.customer.create({
      data: { tenantId, name: profileName?.trim() || phone, whatsappNumber: phone, phone, source: 'whatsapp', lastInteractionAt: new Date() },
    });
  }

  async touch(tenantId: string, customerId: string) {
    await this.prisma.customer.updateMany({ where: { id: customerId, tenantId }, data: { lastInteractionAt: new Date() } });
  }

  /** Recomputes total spent and order count from confirmed orders. */
  async refreshStats(tenantId: string, customerId: string) {
    const agg = await this.prisma.order.aggregate({
      where: { tenantId, customerId, status: { in: COUNTED_STATUSES } },
      _sum: { total: true },
      _count: { _all: true },
    });
    await this.prisma.customer.updateMany({
      where: { id: customerId, tenantId },
      data: { totalSpent: agg._sum.total ?? 0, ordersCount: agg._count._all, lastInteractionAt: new Date() },
    });
  }

  async addTags(tenantId: string, customerId: string, add: string[] = [], remove: string[] = []) {
    const customer = ensureFound(await this.prisma.customer.findFirst({ where: { id: customerId, tenantId } }), 'Customer');
    const tags = new Set(customer.tags);
    add.forEach((t) => tags.add(t.toLowerCase().trim()));
    remove.forEach((t) => tags.delete(t.toLowerCase().trim()));
    return this.prisma.customer.update({ where: { id: customerId }, data: { tags: [...tags].filter(Boolean).slice(0, 30) } });
  }
}
