import { createHmac, timingSafeEqual } from 'crypto';
import { PlanKey, PLANS } from '@sellora/shared';
import { env } from '../../config/env';

export interface CheckoutSession {
  url: string;
  providerSessionId: string;
}

export interface BillingWebhookResult {
  tenantId: string;
  plan?: PlanKey;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  renewalDate?: Date;
}

/**
 * Subscription payment provider abstraction. Implement this interface to add
 * Paddle or a local gateway; nothing else in the billing module changes.
 */
export interface PaymentProvider {
  readonly key: string;
  readonly label: string;
  isConfigured(): boolean;
  createCheckout(input: { tenantId: string; plan: PlanKey; customerEmail: string; successUrl: string; cancelUrl: string }): Promise<CheckoutSession>;
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): BillingWebhookResult | null;
}

export class StripePaymentProvider implements PaymentProvider {
  readonly key = 'stripe';
  readonly label = 'Stripe';

  isConfigured() {
    return Boolean(env.STRIPE_SECRET_KEY);
  }

  async createCheckout(input: { tenantId: string; plan: PlanKey; customerEmail: string; successUrl: string; cancelUrl: string }) {
    const plan = PLANS[input.plan];
    if (!plan.monthlyPrice) throw new Error('This plan cannot be purchased online');
    const form = new URLSearchParams({
      mode: 'subscription',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      customer_email: input.customerEmail,
      client_reference_id: input.tenantId,
      'metadata[tenantId]': input.tenantId,
      'metadata[plan]': input.plan,
      'subscription_data[metadata][tenantId]': input.tenantId,
      'subscription_data[metadata][plan]': input.plan,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(Math.round(plan.monthlyPrice * 100)),
      'line_items[0][price_data][recurring][interval]': 'month',
      'line_items[0][price_data][product_data][name]': `Sellora AI ${plan.name}`,
    });
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
    if (!res.ok || !json.url || !json.id) throw new Error(json.error?.message ?? 'Stripe checkout failed');
    return { url: json.url, providerSessionId: json.id };
  }

  /** Verifies the Stripe-Signature header (HMAC SHA-256, 5 minute tolerance). */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): BillingWebhookResult | null {
    const secret = env.STRIPE_WEBHOOK_SECRET;
    const header = headers['stripe-signature'];
    if (!secret || typeof header !== 'string') throw new Error('Missing signature');
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
    const timestamp = Number(parts.t);
    if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) throw new Error('Signature timestamp out of range');
    const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex');
    const signatures = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
    const valid = signatures.some((sig) => sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
    if (!valid) throw new Error('Invalid signature');

    const event = JSON.parse(rawBody.toString('utf8')) as {
      type: string;
      data: { object: Record<string, unknown> & { metadata?: Record<string, string> } };
    };
    const obj = event.data.object;
    const tenantId = obj.metadata?.tenantId;
    if (!tenantId) return null;
    switch (event.type) {
      case 'checkout.session.completed':
        return {
          tenantId,
          plan: obj.metadata?.plan as PlanKey,
          status: 'ACTIVE',
          providerCustomerId: obj.customer as string | undefined,
          providerSubscriptionId: obj.subscription as string | undefined,
        };
      case 'customer.subscription.updated':
        return {
          tenantId,
          plan: obj.metadata?.plan as PlanKey,
          status: obj.status === 'past_due' ? 'PAST_DUE' : obj.status === 'canceled' ? 'CANCELLED' : 'ACTIVE',
          renewalDate: obj.current_period_end ? new Date(Number(obj.current_period_end) * 1000) : undefined,
        };
      case 'customer.subscription.deleted':
        return { tenantId, plan: 'FREE', status: 'CANCELLED' };
      default:
        return null;
    }
  }
}

export const PAYMENT_PROVIDERS: PaymentProvider[] = [new StripePaymentProvider()];

export function activePaymentProvider(): PaymentProvider | undefined {
  return PAYMENT_PROVIDERS.find((p) => p.isConfigured());
}
