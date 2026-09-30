import { Injectable } from '@nestjs/common';
import { DeliveryStatus, OrderStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ActivityService } from '../events/events.service';
import { OrdersService, ORDER_TRANSITIONS } from './orders.service';
import { paginate, toPaginated } from '../../common/pagination';
import { ensureFound, ValidationError } from '../../common/errors';
import type { Actor } from '../../common/auth-context';

export const deliverySchema = z.object({
  orderId: z.string().uuid(),
  carrier: z.string().trim().max(80).nullable().optional(),
  trackingNumber: z.string().trim().max(120).nullable().optional(),
  trackingUrl: z.string().url().max(500).nullable().optional().or(z.literal('').transform(() => null)),
  scheduledAt: z.coerce.date().nullable().optional(),
  fee: z.number().min(0).max(1e9).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const deliveryUpdateSchema = z.object({
  status: z.nativeEnum(DeliveryStatus).optional(),
  carrier: z.string().trim().max(80).nullable().optional(),
  trackingNumber: z.string().trim().max(120).nullable().optional(),
  trackingUrl: z.string().url().max(500).nullable().optional().or(z.literal('').transform(() => null)),
  scheduledAt: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  notifyCustomer: z.boolean().default(false),
});

export const deliveryListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(DeliveryStatus).optional(),
  search: z.string().trim().max(100).optional(),
});

@Injectable()
export class DeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly orders: OrdersService,
  ) {}

  async list(tenantId: string, q: z.infer<typeof deliveryListSchema>) {
    const where: Prisma.DeliveryWhereInput = {
      tenantId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { trackingNumber: { contains: q.search, mode: 'insensitive' } },
              { order: { number: { contains: q.search, mode: 'insensitive' } } },
              { recipientName: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total, counts] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        include: { order: { select: { id: true, number: true, status: true, customer: { select: { id: true, name: true } } } } },
        orderBy: { createdAt: 'desc' },
        ...paginate(q),
      }),
      this.prisma.delivery.count({ where }),
      this.prisma.delivery.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
    ]);
    return { ...toPaginated(items, total, q), statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
  }

  async create(actor: Actor, input: z.infer<typeof deliverySchema>) {
    const order = ensureFound(await this.prisma.order.findFirst({ where: { id: input.orderId, tenantId: actor.tenantId } }), 'Order');
    if (order.status === 'CANCELLED' || order.status === 'REFUNDED') throw new ValidationError('Cannot ship a cancelled order.');
    const delivery = await this.prisma.delivery.create({
      data: {
        tenantId: actor.tenantId,
        orderId: order.id,
        status: input.scheduledAt ? DeliveryStatus.SCHEDULED : DeliveryStatus.PENDING,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        trackingUrl: input.trackingUrl,
        scheduledAt: input.scheduledAt,
        fee: input.fee ?? order.shippingTotal,
        notes: input.notes,
        recipientName: order.shippingName,
        recipientPhone: order.shippingPhone,
        address: order.shippingAddress,
        city: order.shippingCity,
        country: order.shippingCountry,
      },
    });
    await this.activity.record(actor.tenantId, 'ORDER', order.id, 'delivery_created', `Delivery created${input.carrier ? ` with ${input.carrier}` : ''}`, actor);
    await this.audit.log(actor, { action: 'delivery.created', entityType: 'Delivery', entityId: delivery.id, metadata: { order: order.number } });
    return delivery;
  }

  /** Updating a delivery keeps the order status in sync (in transit → shipped, delivered → delivered). */
  async update(actor: Actor, id: string, input: z.infer<typeof deliveryUpdateSchema>) {
    const delivery = ensureFound(await this.prisma.delivery.findFirst({ where: { id, tenantId: actor.tenantId }, include: { order: true } }), 'Delivery');
    const { notifyCustomer, ...data } = input;
    const updated = await this.prisma.delivery.update({
      where: { id },
      data: {
        ...data,
        ...(input.status === DeliveryStatus.IN_TRANSIT && !delivery.shippedAt ? { shippedAt: new Date() } : {}),
        ...(input.status === DeliveryStatus.DELIVERED ? { deliveredAt: new Date() } : {}),
      },
    });
    if (input.status && input.status !== delivery.status) {
      await this.activity.record(actor.tenantId, 'ORDER', delivery.orderId, 'delivery_status', `Delivery ${input.status.toLowerCase().replace('_', ' ')}`, actor);
      const target: OrderStatus | undefined =
        input.status === DeliveryStatus.IN_TRANSIT ? OrderStatus.SHIPPED : input.status === DeliveryStatus.DELIVERED ? OrderStatus.DELIVERED : undefined;
      if (target && delivery.order.status !== target) {
        // Walk through intermediate states when allowed (e.g. CONFIRMED → SHIPPED → DELIVERED)
        let current = delivery.order.status;
        const path: OrderStatus[] = target === OrderStatus.DELIVERED && current !== OrderStatus.SHIPPED ? [OrderStatus.SHIPPED, OrderStatus.DELIVERED] : [target];
        for (const step of path) {
          if (ORDER_TRANSITIONS[current].includes(step)) {
            await this.orders.changeStatus(actor, delivery.orderId, { status: step, note: 'Updated from delivery', restock: true, notifyCustomer: notifyCustomer && step === target });
            current = step;
          }
        }
      }
    }
    await this.audit.log(actor, { action: 'delivery.updated', entityType: 'Delivery', entityId: id, metadata: { fields: Object.keys(data) } });
    return updated;
  }
}
