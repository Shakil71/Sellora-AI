import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NotificationType, PaymentMethod, PaymentStatus, Prisma, WebhookEventStatus } from '@prisma/client';
import { z } from 'zod';
import { formatMoney } from '@sellora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ActivityService, EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { OrdersService } from './orders.service';
import { PaymentMethodsService } from '../payment-gateways/payment-methods.service';
import { GatewayError, WebhookOutcome } from '../payment-gateways/gateway.types';
import { toCountryCode } from '../payment-gateways/countries';
import { renderInstructions } from '../payment-gateways/presets';
import { paginate, toPaginated } from '../../common/pagination';
import { AppException, ensureFound, ValidationError } from '../../common/errors';
import { env } from '../../config/env';
import type { Actor } from '../../common/auth-context';

/**
 * A workspace's own payment methods (online gateways such as Stripe or
 * SSLCOMMERZ, and manual ones such as bKash or bank transfer) live in the
 * PaymentMethod table. These built-ins apply until it configures any.
 */
export const BUILT_IN_PAYMENT_METHODS = [
  { key: 'cash_on_delivery', label: 'Cash on delivery' },
  { key: 'bank_transfer', label: 'Bank transfer' },
  { key: 'card', label: 'Card (external terminal)' },
  { key: 'mobile_wallet', label: 'Mobile wallet' },
  { key: 'other', label: 'Other' },
] as const;

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

export const requestPaymentSchema = z.object({
  orderId: z.string().uuid(),
  methodId: z.string().uuid(),
  /** Defaults to the outstanding balance. */
  amount: z.number().positive().max(1e12).optional(),
  /** Also message the link or instructions to the customer in their conversation. */
  sendToCustomer: z.boolean().default(false),
});

export const methodsQuerySchema = z.object({ orderId: z.string().uuid().optional() });

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
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly orders: OrdersService,
    private readonly paymentMethods: PaymentMethodsService,
  ) {}

  /**
   * Methods the workspace accepts. With an order, each method says whether it
   * is offered for that order's currency and the customer's country.
   */
  async methods(tenantId: string, q: z.infer<typeof methodsQuerySchema> = {}) {
    const builtIn = (m: (typeof BUILT_IN_PAYMENT_METHODS)[number]) => ({
      key: m.key,
      label: m.label,
      id: null,
      provider: 'manual',
      online: false,
      instructions: null,
      countries: [] as string[],
      offered: true,
      notOfferedReason: undefined as string | undefined,
    });
    const [configured, order, tenant] = await Promise.all([
      this.prisma.paymentMethod.findMany({ where: { tenantId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      q.orderId ? this.prisma.order.findFirst({ where: { id: q.orderId, tenantId }, include: { customer: { select: { country: true } } } }) : null,
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { country: true } }),
    ]);
    if (!configured.length) return BUILT_IN_PAYMENT_METHODS.map(builtIn);
    const country = toCountryCode(order?.shippingCountry) ?? toCountryCode(order?.customer.country) ?? toCountryCode(tenant?.country);
    const items = configured.map((m) => {
      const { adapter } = this.paymentMethods.context(m);
      const currencies = m.currencies.length ? m.currencies : adapter.currencies;
      const currencyOk = !order || !currencies.length || currencies.includes(order.currency);
      const countryOk = !country || !m.countries.length || m.countries.includes(country);
      return {
        key: m.methodKey,
        label: m.name,
        id: m.id as string | null,
        provider: m.provider,
        online: Boolean(adapter.createPayment),
        instructions: m.instructions,
        countries: m.countries,
        offered: currencyOk && countryOk,
        notOfferedReason: !currencyOk ? `Does not accept ${order?.currency}` : !countryOk ? 'Not offered in this customer’s country' : undefined,
      };
    });
    // "Other" stays available for payments that fit none of the configured methods.
    return [...items, builtIn(BUILT_IN_PAYMENT_METHODS[BUILT_IN_PAYMENT_METHODS.length - 1]!)];
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

  private async afterPaymentChange(tenantId: string, orderId: string, amountText: string) {
    const { becamePaid } = await this.orders.syncPaymentState(tenantId, orderId);
    if (!becamePaid) return;
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { customer: true } });
    await this.events.emit(tenantId, 'order.paid', { orderId, customerId: order.customerId, total: Number(order.total), conversationId: order.conversationId });
    await this.notifications.notify(tenantId, { permission: 'orders.update' }, {
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
    await this.afterPaymentChange(actor.tenantId, order.id, amountText);
    return payment;
  }

  async setStatus(actor: Actor, id: string, status: 'PAID' | 'FAILED') {
    const payment = ensureFound(await this.prisma.payment.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Payment');
    if (payment.status !== PaymentStatus.PENDING) throw new ValidationError('Only pending payments can be updated.');
    const updated = await this.prisma.payment.update({ where: { id }, data: { status, paidAt: status === 'PAID' ? new Date() : null } });
    await this.audit.log(actor, { action: 'payment.status_changed', entityType: 'Payment', entityId: id, metadata: { status } });
    if (payment.orderId) await this.afterPaymentChange(actor.tenantId, payment.orderId, formatMoney(Number(payment.amount), payment.currency));
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

  /**
   * Creates a pending payment for an order and returns what the customer needs:
   * a hosted payment page for online gateways, or the written instructions for
   * manual methods. Optionally sends it to them in their conversation.
   */
  async requestPayment(actor: Actor, input: z.infer<typeof requestPaymentSchema>) {
    const order = ensureFound(
      await this.prisma.order.findFirst({ where: { id: input.orderId, tenantId: actor.tenantId }, include: { customer: true, invoice: { select: { id: true } } } }),
      'Order',
    );
    if (order.status === 'CANCELLED' || order.status === 'REFUNDED') throw new ValidationError('Cannot request payment for cancelled or refunded orders.');
    const outstanding = Number(order.total) - Number(order.amountPaid);
    if (outstanding <= 0.005) throw new ValidationError('This order is already paid.');
    const amount = input.amount ?? outstanding;
    if (amount - outstanding > 0.005) throw new ValidationError(`Amount exceeds the outstanding balance of ${formatMoney(outstanding, order.currency)}.`);
    const method = ensureFound(await this.prisma.paymentMethod.findFirst({ where: { id: input.methodId, tenantId: actor.tenantId, isActive: true } }), 'Payment method');
    const { adapter, ctx } = this.paymentMethods.context(method);
    const currencies = method.currencies.length ? method.currencies : adapter.currencies;
    if (currencies.length && !currencies.includes(order.currency)) throw new ValidationError(`${method.name} does not accept ${order.currency}.`);
    const missing = this.paymentMethods.missingSetup(adapter, ctx.credentials);
    if (missing.length) throw new ValidationError(`Finish setting up ${method.name} first: add the ${missing.join(' and ')} so payments can be confirmed automatically.`);

    const amountText = formatMoney(amount, order.currency);
    // Re-use an open request for the same amount instead of creating a second link.
    let payment = await this.prisma.payment.findFirst({
      where: { tenantId: actor.tenantId, orderId: order.id, paymentMethodId: method.id, status: PaymentStatus.PENDING, amount },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment) {
      payment = await this.prisma.payment.create({
        data: {
          id: randomUUID(),
          tenantId: actor.tenantId,
          orderId: order.id,
          invoiceId: order.invoice?.id,
          amount,
          currency: order.currency,
          status: PaymentStatus.PENDING,
          method: method.methodKey,
          provider: method.provider,
          paymentMethodId: method.id,
          createdById: actor.userId,
        },
      });
      if (adapter.createPayment) {
        try {
          const page = await adapter.createPayment(ctx, {
            reference: payment.id,
            amount,
            currency: order.currency,
            description: `Order ${order.number}`,
            orderNumber: order.number,
            customer: {
              name: order.customer.name,
              email: order.customer.email,
              phone: order.customer.phone ?? order.customer.whatsappNumber ?? order.shippingPhone,
              city: order.shippingCity ?? order.customer.city,
              country: order.shippingCountry ?? order.customer.country,
              address: order.shippingAddress ?? order.customer.addressLine,
            },
            returnUrl: (outcome) => `${env.API_URL}/api/v1/payment-gateways/return?outcome=${outcome}`,
            notifyUrl: this.paymentMethods.webhookUrl(method),
          });
          payment = await this.prisma.payment.update({ where: { id: payment.id }, data: { checkoutUrl: page.url, providerRef: page.providerRef ?? null } });
        } catch (err) {
          await this.prisma.payment.delete({ where: { id: payment.id } });
          if (err instanceof GatewayError) {
            await this.prisma.paymentMethod.update({ where: { id: method.id }, data: { lastError: err.message } });
            throw new ValidationError(err.message);
          }
          throw err;
        }
      }
      await this.activity.record(actor.tenantId, 'ORDER', order.id, 'payment', `Payment of ${amountText} requested via ${method.name}`, actor);
      await this.audit.log(actor, { action: 'payment.requested', entityType: 'Payment', entityId: payment.id, metadata: { order: order.number, amount, method: method.methodKey } });
    }

    const message = payment.checkoutUrl
      ? `Hi ${order.customer.name}, please pay ${amountText} for order ${order.number} securely here: ${payment.checkoutUrl}`
      : `To pay ${amountText} for order ${order.number} with ${method.name}:\n${renderInstructions(method.instructions ?? '', { order_number: order.number, amount: amountText })}`;
    const sent = input.sendToCustomer ? await this.orders.sendToCustomer(actor.tenantId, order.customerId, message, order.conversationId) : false;
    return { payment, url: payment.checkoutUrl, message, sent };
  }

  /** Public gateway webhook. The URL token identifies the workspace's payment method. */
  async handleGatewayWebhook(token: string, rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const method = await this.paymentMethods.byWebhookToken(token);
    if (!method) throw new AppException('UNKNOWN_PROVIDER', 'Unknown payment method', 404);
    const { adapter, ctx } = this.paymentMethods.context(method);
    if (!adapter.parseWebhook) throw new AppException('UNKNOWN_PROVIDER', 'This payment method does not accept webhooks', 404);
    const log = (status: WebhookEventStatus, valid: boolean, payload: Prisma.InputJsonValue, error?: string) =>
      this.prisma.webhookEvent
        .create({ data: { tenantId: method.tenantId, provider: `payment:${method.provider}`, eventType: 'payment', payload, signatureValid: valid, status, error, processedAt: new Date() } })
        .catch(() => undefined);

    let outcome: WebhookOutcome | null;
    try {
      outcome = await adapter.parseWebhook({ ...ctx, rawBody, headers });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Invalid webhook';
      this.logger.warn(`Rejected ${method.provider} payment webhook for ${method.id}: ${reason}`);
      await log(WebhookEventStatus.FAILED, false, {}, reason);
      throw new AppException('INVALID_SIGNATURE', 'Invalid webhook signature', 400);
    }
    if (!outcome) {
      await log(WebhookEventStatus.IGNORED, true, {});
      return { received: true };
    }
    const result = await this.applyOutcome(method, outcome);
    await log(result === 'applied' ? WebhookEventStatus.PROCESSED : WebhookEventStatus.IGNORED, true, { reference: outcome.reference, status: outcome.status, result });
    return { received: true };
  }

  /** Marks a pending payment paid or failed from a verified gateway notification. Idempotent. */
  async applyOutcome(method: PaymentMethod, outcome: WebhookOutcome): Promise<'applied' | 'unknown' | 'duplicate' | 'mismatch'> {
    const payment = await this.prisma.payment.findFirst({ where: { id: outcome.reference, tenantId: method.tenantId, paymentMethodId: method.id } });
    if (!payment) return 'unknown';
    const system = { tenantId: method.tenantId, type: 'SYSTEM' as const, name: method.name };
    const amountText = formatMoney(Number(payment.amount), payment.currency);

    if (outcome.status === 'FAILED') {
      const { count } = await this.prisma.payment.updateMany({ where: { id: payment.id, status: PaymentStatus.PENDING }, data: { status: PaymentStatus.FAILED } });
      if (!count) return 'duplicate';
      if (payment.orderId) await this.activity.record(method.tenantId, 'ORDER', payment.orderId, 'payment', `Payment of ${amountText} via ${method.name} did not complete${outcome.reason ? ` (${outcome.reason})` : ''}`, system);
      await this.audit.log(system, { action: 'payment.failed', entityType: 'Payment', entityId: payment.id, metadata: { method: method.methodKey, reason: outcome.reason } });
      return 'applied';
    }

    const wrongAmount = outcome.amount !== undefined && Math.abs(outcome.amount - Number(payment.amount)) > 0.01;
    const wrongCurrency = outcome.currency !== undefined && outcome.currency !== payment.currency.toUpperCase();
    if (wrongAmount || wrongCurrency) {
      const note = `Gateway reported ${outcome.amount ?? '?'} ${outcome.currency ?? ''} but ${payment.amount} ${payment.currency} was expected. Check the transaction${outcome.transactionId ? ` ${outcome.transactionId}` : ''} before marking it paid.`;
      await this.prisma.payment.update({ where: { id: payment.id }, data: { notes: note } });
      await this.audit.log(system, { action: 'payment.mismatch', entityType: 'Payment', entityId: payment.id, metadata: { reported: outcome.amount, currency: outcome.currency } });
      await this.notifications.notify(method.tenantId, { permission: 'orders.update' }, { type: NotificationType.PAYMENT_RECEIVED, title: 'Payment amount needs review', body: note, link: payment.orderId ? `/orders/${payment.orderId}` : '/payments' });
      return 'mismatch';
    }
    // A gateway-confirmed payment wins over a link that was marked failed earlier.
    const { count } = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: { in: [PaymentStatus.PENDING, PaymentStatus.FAILED] } },
      data: { status: PaymentStatus.PAID, paidAt: new Date(), providerRef: outcome.transactionId ?? payment.providerRef },
    });
    if (!count) return 'duplicate';
    await this.audit.log(system, { action: 'payment.received', entityType: 'Payment', entityId: payment.id, metadata: { method: method.methodKey, amount: Number(payment.amount), transactionId: outcome.transactionId } });
    if (payment.orderId) {
      await this.activity.record(method.tenantId, 'ORDER', payment.orderId, 'payment', `Payment of ${amountText} received via ${method.name}`, system);
      await this.afterPaymentChange(method.tenantId, payment.orderId, amountText);
    }
    return 'applied';
  }
}
