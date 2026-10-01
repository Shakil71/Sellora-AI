import { Injectable } from '@nestjs/common';
import { NotificationType, PlanPaymentStatus, Prisma, SubscriptionPlan, SubscriptionStatus } from '@prisma/client';
import { z } from 'zod';
import { formatMoney, PLANS } from '@sellora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { paginate, toPaginated } from '../../common/pagination';
import { AppException, ConflictError, ensureFound, ValidationError } from '../../common/errors';
import type { Actor, AuthContext } from '../../common/auth-context';

const SETTINGS_KEY = 'billing';
const PURCHASABLE = ['STARTER', 'PRO', 'BUSINESS'] as const;

export const billingSettingsSchema = z.object({
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code such as BDT or USD')
    .default('USD'),
  /** Monthly price per plan in `currency`. A missing plan falls back to the USD list price. */
  prices: z.record(z.enum(PURCHASABLE), z.number().positive().max(1e9)).default({}),
  /** Shown to customers: where to send the money, e.g. "bKash Personal 01XXXXXXXXX". */
  instructions: z.string().trim().max(2000).default(''),
});
export type BillingSettings = z.infer<typeof billingSettingsSchema>;

export const submitPlanPaymentSchema = z.object({
  plan: z.enum(PURCHASABLE),
  method: z.string().trim().min(2).max(40),
  reference: z.string().trim().min(4, 'Enter the transaction ID from your payment').max(60),
  note: z.string().trim().max(500).optional(),
});

export const planPaymentListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.nativeEnum(PlanPaymentStatus).optional(),
});

export const reviewPlanPaymentSchema = z.object({ note: z.string().trim().max(300).optional() });

/** Adds one calendar month, keeping the day where possible. */
export function addMonth(from: Date): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + 1);
  if (d.getUTCDate() !== day) d.setUTCDate(0); // 31 Jan -> 28/29 Feb
  return d;
}

/**
 * Manual subscription payments: the customer pays the platform owner by bKash,
 * Nagad, bank transfer etc. and submits the transaction id; a platform admin
 * confirms it and the plan is activated for one month.
 */
@Injectable()
export class PlanPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async settings(): Promise<BillingSettings> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: SETTINGS_KEY } });
    const parsed = billingSettingsSchema.safeParse(row?.value ?? {});
    return parsed.success ? parsed.data : billingSettingsSchema.parse({});
  }

  async saveSettings(auth: AuthContext, input: z.infer<typeof billingSettingsSchema>) {
    const value = billingSettingsSchema.parse(input);
    await this.prisma.systemSetting.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, value }, update: { value } });
    await this.audit.log({ userId: auth.userId, name: auth.name, type: 'USER' }, { action: 'platform.billing_settings_changed', metadata: { currency: value.currency } });
    return value;
  }

  /** Price a workspace pays for a plan, with the platform's own currency if configured. */
  priceFor(settings: BillingSettings, plan: keyof typeof PLANS): { amount: number | null; currency: string } {
    const own = (settings.prices as Record<string, number | undefined>)[plan];
    if (own) return { amount: own, currency: settings.currency };
    const list = PLANS[plan].monthlyPrice;
    // List prices are in USD; only reuse them when the platform also bills in USD.
    return settings.currency === 'USD' ? { amount: list, currency: 'USD' } : { amount: null, currency: settings.currency };
  }

  /** What the billing page needs to offer manual payment. */
  async publicInfo(tenantId: string) {
    const settings = await this.settings();
    const [recent, pending] = await Promise.all([
      this.prisma.planPayment.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 5 }),
      this.prisma.planPayment.findFirst({ where: { tenantId, status: PlanPaymentStatus.PENDING } }),
    ]);
    return {
      enabled: settings.instructions.length > 0,
      instructions: settings.instructions,
      currency: settings.currency,
      prices: Object.fromEntries(PURCHASABLE.map((p) => [p, this.priceFor(settings, p).amount])),
      pending,
      recent,
    };
  }

  async submit(actor: Actor, input: z.infer<typeof submitPlanPaymentSchema>) {
    const settings = await this.settings();
    if (!settings.instructions) throw new AppException('BILLING_NOT_CONFIGURED', 'Manual payments are not set up. Contact the platform administrator.', 412);
    const { amount, currency } = this.priceFor(settings, input.plan);
    if (!amount) throw new ValidationError('No price is set for this plan yet. Contact the platform administrator.');
    if (await this.prisma.planPayment.findFirst({ where: { tenantId: actor.tenantId, status: PlanPaymentStatus.PENDING } })) {
      throw new ConflictError('You already have a payment waiting for confirmation.');
    }
    const reference = input.reference.toUpperCase();
    const reused = await this.prisma.planPayment.findFirst({
      where: { reference, method: { equals: input.method, mode: 'insensitive' }, status: { in: [PlanPaymentStatus.PENDING, PlanPaymentStatus.APPROVED] } },
    });
    if (reused) throw new ConflictError('This transaction ID was already submitted.');
    const row = await this.prisma.planPayment.create({
      data: { tenantId: actor.tenantId, plan: input.plan as SubscriptionPlan, amount, currency, method: input.method, reference, note: input.note, submittedById: actor.userId },
    });
    await this.audit.log(actor, { action: 'billing.payment_submitted', entityType: 'PlanPayment', entityId: row.id, metadata: { plan: input.plan, method: input.method } });
    return row;
  }

  async list(q: z.infer<typeof planPaymentListSchema>) {
    const where: Prisma.PlanPaymentWhereInput = q.status ? { status: q.status } : {};
    const [items, total, pending] = await Promise.all([
      this.prisma.planPayment.findMany({ where, include: { tenant: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'desc' }, ...paginate(q) }),
      this.prisma.planPayment.count({ where }),
      this.prisma.planPayment.count({ where: { status: PlanPaymentStatus.PENDING } }),
    ]);
    return { ...toPaginated(items, total, q), pending };
  }

  async approve(auth: AuthContext, id: string, input: z.infer<typeof reviewPlanPaymentSchema>) {
    const payment = await this.pendingOrThrow(id);
    const now = new Date();
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId: payment.tenantId } });
    // Renewing early extends the current period instead of wasting paid days.
    const extend = sub && sub.plan === payment.plan && sub.status === SubscriptionStatus.ACTIVE && sub.renewalDate && sub.renewalDate > now;
    const renewalDate = addMonth(extend ? sub!.renewalDate! : now);
    const { count } = await this.prisma.planPayment.updateMany({
      where: { id, status: PlanPaymentStatus.PENDING },
      data: { status: PlanPaymentStatus.APPROVED, reviewedAt: now, reviewedById: auth.userId, reviewNote: input.note },
    });
    if (!count) throw new ConflictError('This payment was already reviewed.');
    await this.prisma.subscription.upsert({
      where: { tenantId: payment.tenantId },
      create: { tenantId: payment.tenantId, plan: payment.plan, status: SubscriptionStatus.ACTIVE, provider: 'manual', renewalDate },
      update: { plan: payment.plan, status: SubscriptionStatus.ACTIVE, provider: 'manual', renewalDate, ...(extend ? {} : { startDate: now }) },
    });
    const actor = { tenantId: payment.tenantId, userId: auth.userId, name: `${auth.name} (platform admin)`, type: 'USER' as const };
    await this.audit.log(actor, { action: 'billing.payment_approved', entityType: 'PlanPayment', entityId: id, metadata: { plan: payment.plan, renewalDate } });
    await this.notifications.notify(payment.tenantId, { permission: 'billing.view' }, {
      type: NotificationType.SYSTEM,
      title: `Your ${PLANS[payment.plan].name} plan is active`,
      body: `Payment of ${formatMoney(Number(payment.amount), payment.currency)} confirmed. Renews ${renewalDate.toISOString().slice(0, 10)}.`,
      link: '/settings/billing',
    });
    return this.prisma.planPayment.findUniqueOrThrow({ where: { id } });
  }

  async reject(auth: AuthContext, id: string, input: z.infer<typeof reviewPlanPaymentSchema>) {
    const payment = await this.pendingOrThrow(id);
    const { count } = await this.prisma.planPayment.updateMany({
      where: { id, status: PlanPaymentStatus.PENDING },
      data: { status: PlanPaymentStatus.REJECTED, reviewedAt: new Date(), reviewedById: auth.userId, reviewNote: input.note },
    });
    if (!count) throw new ConflictError('This payment was already reviewed.');
    await this.audit.log({ tenantId: payment.tenantId, userId: auth.userId, name: `${auth.name} (platform admin)`, type: 'USER' }, { action: 'billing.payment_rejected', entityType: 'PlanPayment', entityId: id, metadata: { reason: input.note } });
    await this.notifications.notify(payment.tenantId, { permission: 'billing.view' }, {
      type: NotificationType.SYSTEM,
      title: 'We could not confirm your plan payment',
      body: input.note ?? 'Check the transaction ID and submit it again.',
      link: '/settings/billing',
    });
    return this.prisma.planPayment.findUniqueOrThrow({ where: { id } });
  }

  private async pendingOrThrow(id: string) {
    const payment = ensureFound(await this.prisma.planPayment.findUnique({ where: { id } }), 'Payment');
    if (payment.status !== PlanPaymentStatus.PENDING) throw new ConflictError('This payment was already reviewed.');
    return payment;
  }
}
