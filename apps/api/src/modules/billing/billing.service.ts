import { Injectable, Logger } from '@nestjs/common';
import { SubscriptionPlan, SubscriptionStatus } from '@prisma/client';
import { PLAN_KEYS, PlanKey, PLANS } from '@sellora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditActor, AuditService } from '../audit/audit.service';
import { isLapsed, UsageService } from './usage.service';
import { PlanPaymentsService } from './plan-payments.service';
import { activePaymentProvider, PAYMENT_PROVIDERS } from './payment-providers';
import { AppException, ensureFound } from '../../common/errors';
import type { Actor } from '../../common/auth-context';
import { env } from '../../config/env';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly audit: AuditService,
    private readonly planPayments: PlanPaymentsService,
  ) {}

  plans() {
    return PLAN_KEYS.map((k) => PLANS[k]);
  }

  async overview(tenantId: string) {
    const subscription = await this.prisma.subscription.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
    });
    const provider = activePaymentProvider();
    const manual = await this.planPayments.publicInfo(tenantId);
    const lapsed = isLapsed(subscription);
    return {
      subscription: { ...subscription, lapsed },
      manualPayment: manual,
      plan: PLANS[subscription.plan],
      usage: await this.usage.summary(tenantId),
      plans: this.plans(),
      paymentProvider: provider ? { key: provider.key, label: provider.label } : null,
    };
  }

  /**
   * Starts a plan change. Paid plans go through the configured payment
   * provider; without one, only a downgrade to Free is self-service and paid
   * plans are assigned by the platform administrator.
   */
  async changePlan(actor: Actor, plan: PlanKey, customerEmail: string) {
    if (plan === 'FREE') {
      await this.setPlan(actor, actor.tenantId, 'FREE');
      return { mode: 'updated' as const };
    }
    if (plan === 'ENTERPRISE') {
      throw new AppException('CONTACT_SALES', 'Enterprise plans are arranged with the platform administrator.');
    }
    const provider = activePaymentProvider();
    if (!provider) {
      throw new AppException(
        'BILLING_NOT_CONFIGURED',
        'Online payments are not configured. Ask the platform administrator to change your plan.',
        412,
      );
    }
    const checkout = await provider.createCheckout({
      tenantId: actor.tenantId,
      plan,
      customerEmail,
      successUrl: `${env.APP_URL}/settings/billing?checkout=success`,
      cancelUrl: `${env.APP_URL}/settings/billing?checkout=cancelled`,
    });
    await this.audit.log(actor, { action: 'billing.checkout_started', entityType: 'Subscription', metadata: { plan, provider: provider.key } });
    return { mode: 'checkout' as const, url: checkout.url };
  }

  async setPlan(actor: AuditActor, tenantId: string, plan: PlanKey, status: SubscriptionStatus = SubscriptionStatus.ACTIVE) {
    ensureFound(await this.prisma.tenant.findUnique({ where: { id: tenantId } }), 'Workspace');
    const sub = await this.prisma.subscription.upsert({
      where: { tenantId },
      create: { tenantId, plan: plan as SubscriptionPlan, status },
      // An admin-assigned plan never lapses: clear any manual-payment expiry.
      update: { plan: plan as SubscriptionPlan, status, startDate: new Date(), provider: null, renewalDate: null },
    });
    await this.audit.log({ ...actor, tenantId }, { action: 'billing.plan_changed', entityType: 'Subscription', entityId: sub.id, metadata: { plan, status } });
    return sub;
  }

  async handleWebhook(providerKey: string, rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const provider = PAYMENT_PROVIDERS.find((p) => p.key === providerKey && p.isConfigured());
    if (!provider) throw new AppException('UNKNOWN_PROVIDER', 'Payment provider not configured', 404);
    let result;
    try {
      result = provider.parseWebhook(rawBody, headers);
    } catch (err) {
      this.logger.warn(`Rejected ${providerKey} webhook: ${(err as Error).message}`);
      throw new AppException('INVALID_SIGNATURE', 'Invalid webhook signature', 400);
    }
    if (!result) return { received: true };
    const tenant = await this.prisma.tenant.findUnique({ where: { id: result.tenantId } });
    if (!tenant) return { received: true };
    await this.prisma.subscription.upsert({
      where: { tenantId: result.tenantId },
      create: {
        tenantId: result.tenantId,
        plan: (result.plan ?? 'FREE') as SubscriptionPlan,
        status: result.status as SubscriptionStatus,
        provider: provider.key,
        providerCustomerId: result.providerCustomerId,
        providerSubscriptionId: result.providerSubscriptionId,
        renewalDate: result.renewalDate,
      },
      update: {
        ...(result.plan ? { plan: result.plan as SubscriptionPlan } : {}),
        status: result.status as SubscriptionStatus,
        provider: provider.key,
        ...(result.providerCustomerId ? { providerCustomerId: result.providerCustomerId } : {}),
        ...(result.providerSubscriptionId ? { providerSubscriptionId: result.providerSubscriptionId } : {}),
        ...(result.renewalDate ? { renewalDate: result.renewalDate } : {}),
      },
    });
    await this.audit.log(
      { tenantId: result.tenantId, type: 'SYSTEM', name: provider.label },
      { action: 'billing.subscription_synced', entityType: 'Subscription', metadata: { plan: result.plan, status: result.status } },
    );
    return { received: true };
  }
}
