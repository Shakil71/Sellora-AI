import { Injectable, Logger } from '@nestjs/common';
import { NotificationType, OrderSource, OrderStatus, PaymentStatus, Prisma, ProductStatus } from '@prisma/client';
import { z } from 'zod';
import { calculateOrderTotals, formatMoney } from '@sellora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ActivityService, EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService, REALTIME_EVENTS } from '../realtime/realtime.service';
import { MailService } from '../mail/mail.service';
import { TenantsService } from '../tenants/tenants.service';
import { findDeliveryZone } from '../tenants/tenant-settings';
import { CustomersService } from '../crm/customers.service';
import { InventoryService, StockAlert, StockLine } from './inventory.service';
import { effectivePrice } from './products.service';
import { paginate, toPaginated } from '../../common/pagination';
import { ensureFound, ValidationError } from '../../common/errors';
import type { Actor } from '../../common/auth-context';

type Tx = Prisma.TransactionClient;

export const orderItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100000),
  discount: z.number().min(0).max(1e10).optional(),
  /** Manual price override (requires orders.update) */
  unitPrice: z.number().min(0).max(1e10).optional(),
});

export const createOrderSchema = z.object({
  customerId: z.string().uuid(),
  items: z.array(orderItemSchema).min(1, 'Add at least one product').max(100),
  discount: z.number().min(0).max(1e10).optional(),
  shipping: z.number().min(0).max(1e10).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  shippingName: z.string().trim().max(120).nullable().optional(),
  shippingPhone: z.string().trim().max(30).nullable().optional(),
  shippingAddress: z.string().trim().max(300).nullable().optional(),
  shippingCity: z.string().trim().max(80).nullable().optional(),
  shippingCountry: z.string().trim().max(80).nullable().optional(),
  conversationId: z.string().uuid().nullable().optional(),
  confirm: z.boolean().optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const updateOrderSchema = z.object({
  notes: z.string().trim().max(2000).nullable().optional(),
  shippingName: z.string().trim().max(120).nullable().optional(),
  shippingPhone: z.string().trim().max(30).nullable().optional(),
  shippingAddress: z.string().trim().max(300).nullable().optional(),
  shippingCity: z.string().trim().max(80).nullable().optional(),
  shippingCountry: z.string().trim().max(80).nullable().optional(),
});

export const orderStatusSchema = z.object({
  status: z.nativeEnum(OrderStatus),
  note: z.string().trim().max(500).optional(),
  restock: z.boolean().default(true),
  notifyCustomer: z.boolean().default(false),
});

export const orderListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  status: z.nativeEnum(OrderStatus).optional(),
  paymentStatus: z.nativeEnum(PaymentStatus).optional(),
  source: z.nativeEnum(OrderSource).optional(),
  customerId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'PROCESSING', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'PACKED', 'SHIPPED', 'CANCELLED'],
  PROCESSING: ['PACKED', 'SHIPPED', 'CANCELLED'],
  PACKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'CANCELLED', 'REFUNDED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

const FULFILLED: OrderStatus[] = ['SHIPPED', 'DELIVERED'];

const detailInclude = {
  customer: { select: { id: true, name: true, email: true, phone: true, whatsappNumber: true, addressLine: true, city: true, country: true } },
  items: { include: { product: { select: { id: true, images: true, status: true } } } },
  payments: { orderBy: { createdAt: 'desc' } },
  invoice: { select: { id: true, number: true, status: true, paymentStatus: true } },
  deliveries: { orderBy: { createdAt: 'desc' } },
  statusHistory: { orderBy: { createdAt: 'asc' } },
  conversation: { select: { id: true, channel: true, status: true } },
} satisfies Prisma.OrderInclude;

export interface CreateOrderOptions {
  source?: OrderSource;
  allowPriceOverride?: boolean;
}

/** Hook for sending WhatsApp updates to customers without a hard dependency cycle. */
export interface CustomerMessenger {
  sendToCustomer(tenantId: string, customerId: string, text: string, conversationId?: string | null): Promise<boolean>;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private messenger?: CustomerMessenger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly mail: MailService,
    private readonly tenants: TenantsService,
    private readonly customers: CustomersService,
    private readonly inventory: InventoryService,
  ) {}

  registerMessenger(messenger: CustomerMessenger) {
    this.messenger = messenger;
  }

  /** Messages the customer on their channel. False when there is no conversation to send it in. */
  async sendToCustomer(tenantId: string, customerId: string, text: string, conversationId?: string | null): Promise<boolean> {
    if (!this.messenger) return false;
    return this.messenger.sendToCustomer(tenantId, customerId, text, conversationId).catch((err: Error) => {
      this.logger.warn(`Could not message customer ${customerId}: ${err.message}`);
      return false;
    });
  }

  async nextNumber(tx: Tx, tenantId: string, key: 'order' | 'invoice', prefix: string) {
    const counter = await tx.tenantCounter.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, value: 1001 },
      update: { value: { increment: 1 } },
    });
    return `${prefix}-${String(counter.value).padStart(6, '0')}`;
  }

  /** Prices a cart using catalog prices and workspace tax/shipping rules (used by UI preview and AI). */
  async quote(tenantId: string, input: { items: Array<{ productId: string; quantity: number; discount?: number; unitPrice?: number }>; discount?: number; shipping?: number; city?: string | null; country?: string | null }, allowPriceOverride = false) {
    const settings = await this.tenants.commerceSettings(tenantId);
    const ids = [...new Set(input.items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({ where: { tenantId, id: { in: ids } }, include: { inventory: true } });
    const byId = new Map(products.map((p) => [p.id, p]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) throw new ValidationError('One or more products do not exist in this workspace.');
    const inactive = products.filter((p) => p.status !== ProductStatus.ACTIVE);
    if (inactive.length) throw new ValidationError(`Not available for sale: ${inactive.map((p) => p.name).join(', ')}`);

    const lines = input.items.map((i) => {
      const p = byId.get(i.productId)!;
      const unitPrice = allowPriceOverride && i.unitPrice !== undefined ? i.unitPrice : effectivePrice(p);
      return { product: p, unitPrice, quantity: i.quantity, discount: i.discount ?? 0 };
    });
    const subtotalPreview = lines.reduce((s, l) => s + l.unitPrice * l.quantity - l.discount, 0);
    const zone = findDeliveryZone(settings, input.city ?? undefined, input.country ?? undefined);
    let shipping = input.shipping ?? zone?.fee ?? settings.defaultShippingFee;
    if (input.shipping === undefined && settings.freeShippingThreshold !== null && subtotalPreview >= settings.freeShippingThreshold) shipping = 0;
    const totals = calculateOrderTotals({
      items: lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity, discount: l.discount })),
      orderDiscount: input.discount,
      shipping,
      taxRatePercent: settings.taxRatePercent,
    });
    return { lines, totals, settings, deliveryZone: zone ?? null };
  }

  async create(actor: Actor, input: CreateOrderInput, opts: CreateOrderOptions = {}) {
    const customer = ensureFound(await this.prisma.customer.findFirst({ where: { id: input.customerId, tenantId: actor.tenantId } }), 'Customer');
    if (input.conversationId) {
      ensureFound(await this.prisma.conversation.findFirst({ where: { id: input.conversationId, tenantId: actor.tenantId } }), 'Conversation');
    }
    const tenant = ensureFound(await this.prisma.tenant.findUnique({ where: { id: actor.tenantId } }), 'Workspace');
    const { lines, totals, settings } = await this.quote(
      actor.tenantId,
      { ...input, city: input.shippingCity ?? customer.city, country: input.shippingCountry ?? customer.country },
      opts.allowPriceOverride,
    );

    const alerts: StockAlert[] = [];
    const stockLines: StockLine[] = lines
      .filter((l) => l.product.trackInventory)
      .map((l) => ({ productId: l.product.id, quantity: l.quantity, name: l.product.name }));

    const order = await this.prisma.$transaction(
      async (tx) => {
        const number = await this.nextNumber(tx, actor.tenantId, 'order', settings.orderPrefix);
        const status = input.confirm ? OrderStatus.CONFIRMED : OrderStatus.PENDING;
        const created = await tx.order.create({
          data: {
            tenantId: actor.tenantId,
            number,
            customerId: customer.id,
            conversationId: input.conversationId ?? null,
            status,
            source: opts.source ?? OrderSource.MANUAL,
            currency: tenant.currency,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            shippingTotal: totals.shippingTotal,
            taxTotal: totals.taxTotal,
            total: totals.total,
            notes: input.notes,
            shippingName: input.shippingName ?? customer.name,
            shippingPhone: input.shippingPhone ?? customer.phone ?? customer.whatsappNumber,
            shippingAddress: input.shippingAddress ?? customer.addressLine,
            shippingCity: input.shippingCity ?? customer.city,
            shippingCountry: input.shippingCountry ?? customer.country,
            confirmedAt: input.confirm ? new Date() : null,
            createdById: actor.userId,
            items: {
              create: lines.map((l, idx) => ({
                tenantId: actor.tenantId,
                productId: l.product.id,
                name: l.product.name,
                sku: l.product.sku,
                unitPrice: l.unitPrice,
                quantity: l.quantity,
                discount: totals.lines[idx]!.discount,
                total: totals.lines[idx]!.total,
              })),
            },
            statusHistory: { create: { tenantId: actor.tenantId, toStatus: status, note: 'Order created', actorId: actor.userId, actorName: actor.name } },
          },
        });
        if (stockLines.length) {
          if (settings.inventoryMode === 'deduct') {
            await this.inventory.deduct(tx, actor.tenantId, stockLines, number, settings.allowBackorders, alerts, actor);
            await tx.order.update({ where: { id: created.id }, data: { inventoryCommitted: true } });
          } else {
            await this.inventory.reserve(tx, actor.tenantId, stockLines, number, settings.allowBackorders, alerts, actor);
            await tx.order.update({ where: { id: created.id }, data: { inventoryReserved: true } });
          }
        }
        return created;
      },
      { timeout: 20_000 },
    );

    await this.inventory.dispatchAlerts(alerts);
    await this.customers.refreshStats(actor.tenantId, customer.id);
    await this.activity.record(actor.tenantId, 'CUSTOMER', customer.id, 'order_created', `Order ${order.number} placed (${formatMoney(totals.total, tenant.currency)})`, actor, { orderId: order.id });
    await this.activity.record(actor.tenantId, 'ORDER', order.id, 'created', `Order created via ${(opts.source ?? 'MANUAL').toLowerCase()}`, actor);
    await this.audit.log(actor, { action: 'order.created', entityType: 'Order', entityId: order.id, metadata: { number: order.number, total: totals.total, source: opts.source ?? 'MANUAL' } });
    await this.events.emit(actor.tenantId, 'order.created', { orderId: order.id, customerId: customer.id, total: totals.total, conversationId: input.conversationId ?? null });
    await this.notifications.notify(actor.tenantId, { permission: 'orders.update' }, {
      type: NotificationType.NEW_ORDER,
      title: `New order ${order.number}`,
      body: `${customer.name} · ${formatMoney(totals.total, tenant.currency)}`,
      link: `/orders/${order.id}`,
    });
    this.realtime.toPermission(actor.tenantId, 'orders.view', REALTIME_EVENTS.ORDER_UPDATED, { id: order.id, action: 'created' });

    if (settings.sendOrderConfirmation && customer.email) {
      await this.mail.queue(customer.email, 'order-confirmation', {
        name: customer.name,
        number: order.number,
        total: formatMoney(totals.total, tenant.currency),
        items: lines.map((l, i) => ({ name: l.product.name, quantity: l.quantity, total: formatMoney(totals.lines[i]!.total, tenant.currency) })),
      });
    }
    return this.get(actor.tenantId, order.id);
  }

  async list(tenantId: string, q: z.infer<typeof orderListSchema>) {
    const where: Prisma.OrderWhereInput = {
      tenantId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.paymentStatus ? { paymentStatus: q.paymentStatus } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
      ...(q.search
        ? {
            OR: [
              { number: { contains: q.search, mode: 'insensitive' } },
              { customer: { name: { contains: q.search, mode: 'insensitive' } } },
              { customer: { phone: { contains: q.search } } },
            ],
          }
        : {}),
    };
    const [items, total, statusCounts] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: { customer: { select: { id: true, name: true } }, _count: { select: { items: true } } },
        orderBy: { createdAt: 'desc' },
        ...paginate(q),
      }),
      this.prisma.order.count({ where }),
      this.prisma.order.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
    ]);
    return {
      ...toPaginated(items, total, q),
      statusCounts: Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all])),
    };
  }

  async get(tenantId: string, id: string) {
    const order = ensureFound(await this.prisma.order.findFirst({ where: { id, tenantId }, include: detailInclude }), 'Order');
    return { ...order, allowedTransitions: ORDER_TRANSITIONS[order.status], activity: await this.activity.list(tenantId, 'ORDER', id, 30) };
  }

  async update(actor: Actor, id: string, input: z.infer<typeof updateOrderSchema>) {
    const order = ensureFound(await this.prisma.order.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Order');
    if (['CANCELLED', 'REFUNDED', 'DELIVERED'].includes(order.status)) throw new ValidationError('Closed orders cannot be edited.');
    await this.prisma.order.update({ where: { id }, data: input });
    await this.audit.log(actor, { action: 'order.updated', entityType: 'Order', entityId: id, metadata: { fields: Object.keys(input) } });
    this.realtime.toPermission(actor.tenantId, 'orders.view', REALTIME_EVENTS.ORDER_UPDATED, { id, action: 'updated' });
    return this.get(actor.tenantId, id);
  }

  async changeStatus(actor: Actor, id: string, input: z.infer<typeof orderStatusSchema>) {
    const order = ensureFound(
      await this.prisma.order.findFirst({ where: { id, tenantId: actor.tenantId }, include: { items: { include: { product: { select: { trackInventory: true } } } } } }),
      'Order',
    );
    if (order.status === input.status) return this.get(actor.tenantId, id);
    if (!ORDER_TRANSITIONS[order.status].includes(input.status)) {
      throw new ValidationError(`An order cannot move from ${order.status} to ${input.status}.`);
    }
    const lines: StockLine[] = order.items
      .filter((i) => i.productId && i.product?.trackInventory)
      .map((i) => ({ productId: i.productId!, quantity: i.quantity, name: i.name }));
    const alerts: StockAlert[] = [];

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.OrderUpdateInput = { status: input.status };
      if (input.status === OrderStatus.CONFIRMED) data.confirmedAt = new Date();
      if (FULFILLED.includes(input.status) && order.inventoryReserved && !order.inventoryCommitted && lines.length) {
        await this.inventory.commit(tx, actor.tenantId, lines, order.number, alerts, actor);
        data.inventoryReserved = false;
        data.inventoryCommitted = true;
      }
      if (input.status === OrderStatus.CANCELLED || input.status === OrderStatus.REFUNDED) {
        if (order.inventoryReserved && !order.inventoryCommitted && lines.length) {
          await this.inventory.release(tx, actor.tenantId, lines, order.number, alerts, actor);
          data.inventoryReserved = false;
        } else if (order.inventoryCommitted && input.restock && lines.length) {
          await this.inventory.restock(tx, actor.tenantId, lines, order.number, alerts, actor);
          data.inventoryCommitted = false;
        }
        if (input.status === OrderStatus.CANCELLED) {
          data.cancelledAt = new Date();
          data.cancelReason = input.note;
        }
        if (input.status === OrderStatus.REFUNDED) data.paymentStatus = PaymentStatus.REFUNDED;
      }
      await tx.order.update({ where: { id }, data });
      await tx.orderStatusHistory.create({
        data: { tenantId: actor.tenantId, orderId: id, fromStatus: order.status, toStatus: input.status, note: input.note, actorId: actor.userId, actorName: actor.name },
      });
    });

    await this.inventory.dispatchAlerts(alerts);
    await this.customers.refreshStats(actor.tenantId, order.customerId);
    await this.activity.record(actor.tenantId, 'ORDER', id, 'status_changed', `Status changed to ${input.status}${input.note ? `: ${input.note}` : ''}`, actor);
    await this.audit.log(actor, { action: 'order.status_changed', entityType: 'Order', entityId: id, metadata: { number: order.number, from: order.status, to: input.status } });
    if (input.status === OrderStatus.CANCELLED) {
      await this.events.emit(actor.tenantId, 'order.cancelled', { orderId: id, customerId: order.customerId, total: Number(order.total), conversationId: order.conversationId });
    }
    this.realtime.toPermission(actor.tenantId, 'orders.view', REALTIME_EVENTS.ORDER_UPDATED, { id, action: 'status', status: input.status });
    if (input.notifyCustomer && this.messenger) {
      const text = `Update on your order ${order.number}: it is now ${input.status.toLowerCase().replace('_', ' ')}.${input.note ? ` ${input.note}` : ''}`;
      await this.messenger.sendToCustomer(actor.tenantId, order.customerId, text, order.conversationId).catch((err: Error) => {
        this.logger.warn(`Could not notify customer about ${order.number}: ${err.message}`);
      });
    }
    return this.get(actor.tenantId, id);
  }

  /** Recalculates paid amount and payment status from payments. */
  async syncPaymentState(tenantId: string, orderId: string): Promise<{ becamePaid: boolean }> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId }, include: { payments: true, invoice: true } });
    if (!order) return { becamePaid: false };
    const paid = order.payments
      .filter((p) => p.status === PaymentStatus.PAID || p.status === PaymentStatus.PARTIALLY_REFUNDED)
      .reduce((sum, p) => sum + Number(p.amount) - Number(p.refundedAmount), 0);
    const refundedAll = order.payments.length > 0 && order.payments.every((p) => p.status === PaymentStatus.REFUNDED || p.status === PaymentStatus.FAILED) && order.payments.some((p) => p.status === PaymentStatus.REFUNDED);
    const total = Number(order.total);
    const paymentStatus: PaymentStatus = refundedAll
      ? PaymentStatus.REFUNDED
      : paid >= total - 0.005
        ? PaymentStatus.PAID
        : order.payments.some((p) => p.status === PaymentStatus.PARTIALLY_REFUNDED)
          ? PaymentStatus.PARTIALLY_REFUNDED
          : PaymentStatus.PENDING;
    await this.prisma.order.update({ where: { id: orderId }, data: { amountPaid: Math.max(0, paid), paymentStatus } });
    if (order.invoice) {
      await this.prisma.invoice.update({ where: { id: order.invoice.id }, data: { amountPaid: Math.max(0, paid), paymentStatus } });
    }
    this.realtime.toPermission(tenantId, 'orders.view', REALTIME_EVENTS.ORDER_UPDATED, { id: orderId, action: 'payment' });
    return { becamePaid: paymentStatus === PaymentStatus.PAID && order.paymentStatus !== PaymentStatus.PAID };
  }

  /** Orders of one customer for the AI "order status" tool. */
  customerOrders(tenantId: string, customerId: string, take = 5) {
    return this.prisma.order.findMany({
      where: { tenantId, customerId },
      orderBy: { createdAt: 'desc' },
      take,
      include: { items: { select: { name: true, quantity: true } }, deliveries: { select: { status: true, carrier: true, trackingNumber: true, trackingUrl: true } } },
    });
  }
}
