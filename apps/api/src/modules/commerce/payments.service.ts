import { Injectable } from '@nestjs/common';
import { NotificationType, PaymentStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { formatMoney } from '@sellora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ActivityService, EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { OrdersService } from './orders.service';
import { paginate, toPaginated } from '../../common/pagination';
import { ensureFound, ValidationError } from '../../common/errors';
import type { Actor } from '../../common/auth-context';

/**
 * Payment methods are data, not code paths. Online gateways implement
 * PaymentGateway and register a method key (e.g. "stripe_link").
 */
export const BUILT_IN_PAYMENT_METHODS = [
  { key: 'cash_on_delivery', label: 'Cash on delivery' },
  { key: 'bank_transfer', label: 'Bank transfer' },
  { key: 'card', label: 'Card (external terminal)' },
  { key: 'mobile_wallet', label: 'Mobile wallet' },
  { key: 'other', label: 'Other' },
] as const;

export interface PaymentGateway {
  readonly key: string;
  readonly label: string;
  isConfigured(tenantId: string): Promise<boolean>;
  /** Creates a hosted payment link for an order; the gateway webhook records the payment. */
  createPaymentLink(order: { id: string; number: string; total: number; currency: string }): Promise<{ url: string; reference: string }>;
}

export const recordPaymentSchema = z.object({
  orderId: z.string().uuid(),
  amount: z.number().positive().max(1e12),
  method: z.string().trim().min(1).max(40),
  status: z.enum([PaymentStatus.PAID, PaymentStatus.PENDING]).default(PaymentStatus.PAID),
  providerRef: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
  paidAt: z.coerce.date().optional(),
});

export const refundSchema = z.object({
  amount: z.number().positive().max(1e12),
  reason: z.string().trim().max(300).optional(),
});

export const paymentStatusSchema = z.object({ status: z.enum([PaymentStatus.PAID, PaymentStatus.FAILED]) });

export const paymentListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(PaymentStatus).optional(),
  method: z.string().max(40).optional(),
  search: z.string().trim().max(100).optional(),
});

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly orders: OrdersService,
  ) {}

  methods() {
    return BUILT_IN_PAYMENT_METHODS;
  }

  async list(tenantId: string, q: z.infer<typeof paymentListSchema>) {
    const where: Prisma.PaymentWhereInput = {
      tenantId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.method ? { method: q.method } : {}),
      ...(q.search
        ? { OR: [{ providerRef: { contains: q.search, mode: 'insensitive' } }, { order: { number: { contains: q.search, mode: 'insensitive' } } }] }
        : {}),
    };
    const [items, total, sums] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: { order: { select: { id: true, number: true, customer: { select: { id: true, name: true } } } } },
        orderBy: { createdAt: 'desc' },
        ...paginate(q),
      }),
      this.prisma.payment.count({ where }),
      this.prisma.payment.groupBy({ by: ['status'], where: { tenantId }, _sum: { amount: true, refundedAmount: true }, _count: { _all: true } }),
    ]);
    return {
      ...toPaginated(items, total, q),
      summary: sums.map((s) => ({ status: s.status, count: s._count._all, amount: Number(s._sum.amount ?? 0), refunded: Number(s._sum.refundedAmount ?? 0) })),
    };
  }

  private async afterPaymentChange(actor: Actor, orderId: string, amountText: string) {
    const { becamePaid } = await this.orders.syncPaymentState(actor.tenantId, orderId);
    if (!becamePaid) return;
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { customer: true } });
    await this.events.emit(actor.tenantId, 'order.paid', { orderId, customerId: order.customerId, total: Number(order.total), conversationId: order.conversationId });
    await this.notifications.notify(actor.tenantId, { permission: 'orders.update' }, {
      type: NotificationType.PAYMENT_RECEIVED,
      title: `Payment received for ${order.number}`,
      body: `${order.customer.name} · ${amountText}`,
      link: `/orders/${orderId}`,
    });
    if (order.customer.email) {
      await this.mail.queue(order.customer.email, 'payment-confirmation', { number: order.number, amount: formatMoney(Number(order.total), order.currency) });
    }
  }

  async record(actor: Actor, input: z.infer<typeof recordPaymentSchema>) {
    const order = ensureFound(await this.prisma.order.findFirst({ where: { id: input.orderId, tenantId: actor.tenantId }, include: { invoice: true } }), 'Order');
    if (order.status === 'CANCELLED' || order.status === 'REFUNDED') throw new ValidationError('Cannot record payments for cancelled or refunded orders.');
    const outstanding = Number(order.total) - Number(order.amountPaid);
    if (input.status === PaymentStatus.PAID && input.amount - outstanding > 0.005) {
      throw new ValidationError(`Amount exceeds the outstanding balance of ${formatMoney(outstanding, order.currency)}.`);
    }
    const payment = await this.prisma.payment.create({
      data: {
        tenantId: actor.tenantId,
        orderId: order.id,
        invoiceId: order.invoice?.id,
        amount: input.amount,
        currency: order.currency,
        status: input.status,
        method: input.method,
        provider: 'manual',
        providerRef: input.providerRef,
        notes: input.notes,
        paidAt: input.status === PaymentStatus.PAID ? (input.paidAt ?? new Date()) : null,
        createdById: actor.userId,
      },
    });
    const amountText = formatMoney(input.amount, order.currency);
    await this.activity.record(actor.tenantId, 'ORDER', order.id, 'payment', `Payment of ${amountText} recorded (${input.method.replace(/_/g, ' ')})`, actor);
    await this.audit.log(actor, { action: 'payment.recorded', entityType: 'Payment', entityId: payment.id, metadata: { order: order.number, amount: input.amount, method: input.method } });
    await this.afterPaymentChange(actor, order.id, amountText);
    return payment;
  }

  async setStatus(actor: Actor, id: string, status: 'PAID' | 'FAILED') {
    const payment = ensureFound(await this.prisma.payment.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Payment');
    if (payment.status !== PaymentStatus.PENDING) throw new ValidationError('Only pending payments can be updated.');
    const updated = await this.prisma.payment.update({ where: { id }, data: { status, paidAt: status === 'PAID' ? new Date() : null } });
    await this.audit.log(actor, { action: 'payment.status_changed', entityType: 'Payment', entityId: id, metadata: { status } });
    if (payment.orderId) await this.afterPaymentChange(actor, payment.orderId, formatMoney(Number(payment.amount), payment.currency));
    return updated;
  }

  async refund(actor: Actor, id: string, input: z.infer<typeof refundSchema>) {
    const payment = ensureFound(await this.prisma.payment.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Payment');
    if (payment.status !== PaymentStatus.PAID && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
      throw new ValidationError('Only paid payments can be refunded.');
    }
    const refundable = Number(payment.amount) - Number(payment.refundedAmount);
    if (input.amount - refundable > 0.005) throw new ValidationError(`You can refund at most ${formatMoney(refundable, payment.currency)}.`);
    const refundedAmount = Number(payment.refundedAmount) + input.amount;
    const status = refundedAmount >= Number(payment.amount) - 0.005 ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
    const updated = await this.prisma.payment.update({
      where: { id },
      data: { refundedAmount, status, notes: input.reason ? `${payment.notes ? `${payment.notes}\n` : ''}Refund: ${input.reason}` : payment.notes },
    });
    await this.audit.log(actor, { action: 'payment.refunded', entityType: 'Payment', entityId: id, metadata: { amount: input.amount, status } });
    if (payment.orderId) {
      await this.activity.record(actor.tenantId, 'ORDER', payment.orderId, 'refund', `Refund of ${formatMoney(input.amount, payment.currency)} issued`, actor);
      await this.orders.syncPaymentState(actor.tenantId, payment.orderId);
    }
    return updated;
  }
}
