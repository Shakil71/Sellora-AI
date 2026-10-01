import { createHmac } from 'crypto';
import { hmacSha256Hex, safeEqual } from '../../common/utils/crypto.util';
import {
  GatewayContext,
  GatewayError,
  PaymentGatewayAdapter,
  PaymentRequest,
  WebhookInput,
  WebhookOutcome,
} from './gateway.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

export function currencyExponent(currency: string): number {
  const c = currency.toUpperCase();
  return ZERO_DECIMAL.has(c) ? 0 : THREE_DECIMAL.has(c) ? 3 : 2;
}

/** 12.5 USD -> 1250; 500 JPY -> 500. */
export function toMinorUnits(amount: number, currency: string): number {
  return Math.round(amount * 10 ** currencyExponent(currency));
}

export function fromMinorUnits(minor: number, currency: string): number {
  return minor / 10 ** currencyExponent(currency);
}

const header = (headers: WebhookInput['headers'], name: string): string | undefined => {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

interface HttpResult<T> {
  ok: boolean;
  status: number;
  json: T;
}

async function http<T = Record<string, unknown>>(url: string, init: RequestInit & { form?: Record<string, string> } = {}): Promise<HttpResult<T>> {
  const { form, ...rest } = init;
  const headers = new Headers(rest.headers);
  let body = rest.body;
  if (form) {
    body = new URLSearchParams(form);
    headers.set('Content-Type', 'application/x-www-form-urlencoded');
  }
  let res: Response;
  try {
    res = await fetch(url, { ...rest, headers, body, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new GatewayError('The payment gateway could not be reached. Try again in a moment.');
  }
  const text = await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { message: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, json: json as T };
}

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
const sha512Hex = (secret: string, payload: Buffer) => createHmac('sha512', secret).update(payload).digest('hex');
const upper = (v: unknown) => (typeof v === 'string' ? v.toUpperCase() : undefined);

// ---------------------------------------------------------------------------
// Manual methods and custom payment links
// ---------------------------------------------------------------------------

const manual: PaymentGatewayAdapter = {
  key: 'manual',
  label: 'Manual method',
  description: 'Cash on delivery, bank transfer, mobile wallets (bKash, Nagad, UPI, M-Pesa…). The customer pays outside Sellora and you confirm it.',
  regions: ['Global'],
  countries: [],
  currencies: [],
  fields: [],
  setupSteps: ['Write the instructions your customers should follow, such as the account number to pay to.', 'When an order is paid, record the payment on the order page.'],
  webhook: false,
};

export const CUSTOM_LINK_PLACEHOLDERS = ['order_number', 'amount', 'currency', 'reference', 'customer_name', 'customer_email', 'customer_phone'] as const;

export function renderLinkTemplate(template: string, req: PaymentRequest): string {
  const values: Record<string, string> = {
    order_number: req.orderNumber,
    amount: req.amount.toFixed(currencyExponent(req.currency)),
    currency: req.currency,
    reference: req.reference,
    customer_name: req.customer.name,
    customer_email: req.customer.email ?? '',
    customer_phone: req.customer.phone ?? '',
  };
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? encodeURIComponent(values[key]!) : match));
}

function assertHttpsTemplate(template: string | undefined) {
  if (!template || !/^https:\/\/[^\s/]+/i.test(template.trim())) {
    throw new GatewayError('Enter a payment link starting with https://');
  }
}

const customLink: PaymentGatewayAdapter = {
  key: 'custom_link',
  label: 'Any gateway (payment link)',
  description: 'Use any payment provider that gives you a payment page URL. Sellora fills in the order details and sends the link to your customer.',
  regions: ['Global'],
  countries: [],
  currencies: [],
  fields: [
    {
      key: 'linkTemplate',
      label: 'Payment link',
      required: true,
      placeholder: 'https://pay.example.com/checkout?amount={amount}&currency={currency}&ref={reference}',
      help: `You can use these placeholders: ${CUSTOM_LINK_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}. They are replaced for each order.`,
    },
    {
      key: 'signingSecret',
      label: 'Webhook signing secret',
      secret: true,
      help: 'Optional. Lets your provider or automation mark payments as paid automatically (see the webhook instructions below).',
    },
  ],
  setupSteps: [
    'Paste the payment page URL of your provider and add the placeholders it needs.',
    'To confirm payments automatically, send a signed POST to the webhook URL shown after saving: {"reference": "{reference}", "status": "paid"}. Sign the raw body with HMAC-SHA256 using the signing secret and send it in the X-Sellora-Signature header.',
    'Without a webhook, mark the payment as paid from the order page when the money arrives.',
  ],
  webhook: true,
  async verify(ctx) {
    assertHttpsTemplate(ctx.credentials.linkTemplate ?? ctx.config.linkTemplate);
  },
  async createPayment(ctx, req) {
    const template = ctx.config.linkTemplate ?? ctx.credentials.linkTemplate;
    assertHttpsTemplate(template);
    return { url: renderLinkTemplate(template!.trim(), req) };
  },
  async parseWebhook({ credentials, rawBody, headers }) {
    const secret = credentials.signingSecret;
    const signature = header(headers, 'x-sellora-signature');
    if (!secret || !signature) throw new GatewayError('Missing signature');
    if (!safeEqual(signature.replace(/^sha256=/, ''), hmacSha256Hex(secret, rawBody))) throw new GatewayError('Invalid signature');
    const body = JSON.parse(rawBody.toString('utf8')) as { reference?: string; status?: string; transactionId?: string; amount?: number | string; currency?: string };
    if (!body.reference) return null;
    const status = String(body.status ?? '').toLowerCase();
    if (['paid', 'success', 'succeeded', 'completed'].includes(status)) {
      return {
        reference: body.reference,
        status: 'PAID',
        transactionId: body.transactionId,
        amount: body.amount !== undefined ? Number(body.amount) : undefined,
        currency: upper(body.currency),
      };
    }
    if (['failed', 'cancelled', 'canceled', 'expired'].includes(status)) return { reference: body.reference, status: 'FAILED', reason: status };
    return null;
  },
};

// ---------------------------------------------------------------------------
// Stripe (worldwide, cards and local methods)
// ---------------------------------------------------------------------------

const stripe: PaymentGatewayAdapter = {
  key: 'stripe',
  label: 'Stripe',
  description: 'Cards, Apple Pay, Google Pay and many local payment methods in 40+ countries.',
  regions: ['Global'],
  countries: [],
  currencies: [],
  fields: [
    { key: 'secretKey', label: 'Secret key', secret: true, required: true, placeholder: 'sk_live_… or sk_test_…', help: 'Stripe Dashboard → Developers → API keys.' },
    { key: 'webhookSecret', label: 'Webhook signing secret', secret: true, later: true, placeholder: 'whsec_…', help: 'Created in the next step, when you add the webhook endpoint.' },
  ],
  setupSteps: [
    'In Stripe, open Developers → API keys and copy the Secret key.',
    'Open Developers → Webhooks → Add endpoint and paste the webhook URL shown here.',
    'Select the events checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed and checkout.session.expired.',
    'Copy the endpoint’s Signing secret (whsec_…) into the field above.',
  ],
  docsUrl: 'https://docs.stripe.com/webhooks',
  webhook: true,
  async verify({ credentials }) {
    const res = await http('https://api.stripe.com/v1/account', { headers: { Authorization: `Bearer ${credentials.secretKey}` } });
    if (res.status === 401) throw new GatewayError('Stripe rejected this secret key.');
    if (!res.ok) throw new GatewayError('Stripe could not verify this key.');
  },
  async createPayment({ credentials }, req) {
    const form: Record<string, string> = {
      mode: 'payment',
      success_url: req.returnUrl('success'),
      cancel_url: req.returnUrl('cancelled'),
      client_reference_id: req.reference,
      'metadata[paymentId]': req.reference,
      'payment_intent_data[metadata][paymentId]': req.reference,
      'payment_intent_data[description]': req.description,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': req.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(toMinorUnits(req.amount, req.currency)),
      'line_items[0][price_data][product_data][name]': req.description,
    };
    if (req.customer.email) form.customer_email = req.customer.email;
    const res = await http<{ id?: string; url?: string; error?: { message?: string } }>('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${credentials.secretKey}` },
      form,
    });
    if (!res.ok || !res.json.url) throw new GatewayError(res.json.error?.message ?? 'Stripe could not create the payment page.');
    return { url: res.json.url, providerRef: res.json.id };
  },
  async parseWebhook({ credentials, rawBody, headers }) {
    const secret = credentials.webhookSecret;
    const sig = header(headers, 'stripe-signature');
    if (!secret || !sig) throw new GatewayError('Missing signature');
    const parts = sig.split(',').map((p) => p.split('=') as [string, string]);
    const timestamp = Number(parts.find(([k]) => k === 't')?.[1]);
    if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) throw new GatewayError('Signature timestamp out of range');
    const expected = hmacSha256Hex(secret, `${timestamp}.${rawBody.toString('utf8')}`);
    if (!parts.some(([k, v]) => k === 'v1' && v !== undefined && safeEqual(v, expected))) throw new GatewayError('Invalid signature');

    const event = JSON.parse(rawBody.toString('utf8')) as { type: string; data: { object: Record<string, unknown> } };
    const obj = event.data.object;
    const reference = (obj.client_reference_id as string | undefined) ?? (obj.metadata as Record<string, string> | undefined)?.paymentId;
    if (!reference) return null;
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        if (obj.payment_status !== 'paid') return null; // bank debits settle later
        const currency = upper(obj.currency);
        return {
          reference,
          status: 'PAID',
          transactionId: (obj.payment_intent as string | undefined) ?? undefined,
          amount: typeof obj.amount_total === 'number' && currency ? fromMinorUnits(obj.amount_total, currency) : undefined,
          currency,
        };
      }
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        return { reference, status: 'FAILED', reason: event.type.split('.').pop() };
      default:
        return null;
    }
  },
};

// ---------------------------------------------------------------------------
// PayPal (worldwide)
// ---------------------------------------------------------------------------

const PAYPAL_CURRENCIES = ['AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'ILS', 'JPY', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'SEK', 'SGD', 'THB', 'TWD', 'USD'];
interface PayPalResource {
  id?: string;
  custom_id?: string;
  amount?: { value?: string; currency_code?: string };
  purchase_units?: Array<{ custom_id?: string }>;
}

const paypalBase = (ctx: GatewayContext) => (ctx.config.mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');

async function paypalToken(ctx: GatewayContext): Promise<string> {
  const res = await http<{ access_token?: string }>(`${paypalBase(ctx)}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: basic(ctx.credentials.clientId ?? '', ctx.credentials.clientSecret ?? '') },
    form: { grant_type: 'client_credentials' },
  });
  if (!res.ok || !res.json.access_token) throw new GatewayError('PayPal rejected these credentials. Check the Client ID, Client secret and the Sandbox/Live mode.');
  return res.json.access_token;
}

const paypal: PaymentGatewayAdapter = {
  key: 'paypal',
  label: 'PayPal',
  description: 'Let customers pay with their PayPal balance, cards or bank in 200+ markets.',
  regions: ['Global'],
  countries: [],
  currencies: PAYPAL_CURRENCIES,
  fields: [
    { key: 'mode', label: 'Mode', type: 'select', default: 'sandbox', options: [{ value: 'sandbox', label: 'Sandbox (testing)' }, { value: 'live', label: 'Live' }] },
    { key: 'clientId', label: 'Client ID', required: true, help: 'PayPal Developer Dashboard → Apps & Credentials.' },
    { key: 'clientSecret', label: 'Client secret', secret: true, required: true },
    { key: 'webhookId', label: 'Webhook ID', later: true, help: 'Shown after you add the webhook in the PayPal app settings.' },
  ],
  setupSteps: [
    'In the PayPal Developer Dashboard, open your app (Sandbox or Live) and copy the Client ID and Secret.',
    'In the same app, add a Webhook with the URL shown here.',
    'Subscribe it to Checkout order approved, Payment capture completed and Payment capture denied.',
    'Copy the Webhook ID into the field above.',
  ],
  docsUrl: 'https://developer.paypal.com/api/rest/webhooks/',
  webhook: true,
  async verify(ctx) {
    await paypalToken(ctx);
  },
  async createPayment(ctx, req) {
    const token = await paypalToken(ctx);
    const exponent = ['JPY', 'HUF', 'TWD'].includes(req.currency) ? 0 : 2;
    const res = await http<{ id?: string; links?: Array<{ rel: string; href: string }>; message?: string }>(`${paypalBase(ctx)}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': req.reference },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            custom_id: req.reference,
            invoice_id: req.reference,
            description: req.description.slice(0, 127),
            amount: { currency_code: req.currency, value: req.amount.toFixed(exponent) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: req.returnUrl('success'),
              cancel_url: req.returnUrl('cancelled'),
              user_action: 'PAY_NOW',
              shipping_preference: 'NO_SHIPPING',
            },
          },
        },
      }),
    });
    const link = res.json.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve');
    if (!res.ok || !link) throw new GatewayError(res.json.message ?? 'PayPal could not create the payment page.');
    return { url: link.href, providerRef: res.json.id };
  },
  async parseWebhook(input) {
    const { rawBody, headers } = input;
    const token = await paypalToken(input);
    const event = JSON.parse(rawBody.toString('utf8')) as { event_type: string; resource: PayPalResource };
    const verification = await http<{ verification_status?: string }>(`${paypalBase(input)}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo: header(headers, 'paypal-auth-algo'),
        cert_url: header(headers, 'paypal-cert-url'),
        transmission_id: header(headers, 'paypal-transmission-id'),
        transmission_sig: header(headers, 'paypal-transmission-sig'),
        transmission_time: header(headers, 'paypal-transmission-time'),
        webhook_id: input.credentials.webhookId,
        webhook_event: event,
      }),
    });
    if (verification.json.verification_status !== 'SUCCESS') throw new GatewayError('Invalid signature');

    const r = event.resource;
    switch (event.event_type) {
      case 'CHECKOUT.ORDER.APPROVED': {
        const reference = r.purchase_units?.[0]?.custom_id;
        if (!reference) return null;
        const capture = await http<{ status?: string; purchase_units?: Array<{ payments?: { captures?: Array<{ id: string; amount: { value: string; currency_code: string } }> } }> }>(
          `${paypalBase(input)}/v2/checkout/orders/${encodeURIComponent(String(r.id))}/capture`,
          { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `capture-${reference}` }, body: '{}' },
        );
        const done = capture.json.purchase_units?.[0]?.payments?.captures?.[0];
        if (capture.json.status !== 'COMPLETED' || !done) return null; // PAYMENT.CAPTURE.COMPLETED follows if it settles later
        return { reference, status: 'PAID', transactionId: done.id, amount: Number(done.amount.value), currency: done.amount.currency_code };
      }
      case 'PAYMENT.CAPTURE.COMPLETED':
        return r.custom_id
          ? { reference: r.custom_id, status: 'PAID', transactionId: r.id, amount: Number(r.amount?.value), currency: r.amount?.currency_code }
          : null;
      case 'PAYMENT.CAPTURE.DENIED':
        return r.custom_id ? { reference: r.custom_id, status: 'FAILED', reason: 'denied' } : null;
      default:
        return null;
    }
  },
};

// ---------------------------------------------------------------------------
// Razorpay (India)
// ---------------------------------------------------------------------------

const razorpay: PaymentGatewayAdapter = {
  key: 'razorpay',
  label: 'Razorpay',
  description: 'UPI, cards, net banking and wallets for customers in India.',
  regions: ['India'],
  countries: ['IN'],
  currencies: [],
  fields: [
    { key: 'keyId', label: 'Key ID', required: true, placeholder: 'rzp_live_…', help: 'Razorpay Dashboard → Account & Settings → API keys.' },
    { key: 'keySecret', label: 'Key secret', secret: true, required: true },
    { key: 'webhookSecret', label: 'Webhook secret', secret: true, later: true, help: 'The secret you type when adding the webhook.' },
  ],
  setupSteps: [
    'In Razorpay, generate API keys under Account & Settings → API keys.',
    'Open Account & Settings → Webhooks → Add new webhook, paste the webhook URL shown here and choose your own secret.',
    'Enable the events payment_link.paid, payment_link.cancelled and payment_link.expired.',
    'Enter the same secret in the Webhook secret field above.',
  ],
  docsUrl: 'https://razorpay.com/docs/webhooks/',
  webhook: true,
  async verify({ credentials }) {
    const res = await http('https://api.razorpay.com/v1/payments?count=1', { headers: { Authorization: basic(credentials.keyId ?? '', credentials.keySecret ?? '') } });
    if (res.status === 401) throw new GatewayError('Razorpay rejected this Key ID and secret.');
    if (!res.ok) throw new GatewayError('Razorpay could not verify these keys.');
  },
  async createPayment({ credentials }, req) {
    const phone = (req.customer.phone ?? '').replace(/[^\d+]/g, '');
    const res = await http<{ id?: string; short_url?: string; error?: { description?: string } }>('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: { Authorization: basic(credentials.keyId ?? '', credentials.keySecret ?? ''), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: toMinorUnits(req.amount, req.currency),
        currency: req.currency,
        accept_partial: false,
        reference_id: req.reference,
        description: req.description.slice(0, 2000),
        customer: { name: req.customer.name, ...(req.customer.email ? { email: req.customer.email } : {}), ...(phone.length >= 8 ? { contact: phone } : {}) },
        notify: { sms: false, email: false },
        reminder_enable: false,
        callback_url: req.returnUrl('success'),
        callback_method: 'get',
      }),
    });
    if (!res.ok || !res.json.short_url) throw new GatewayError(res.json.error?.description ?? 'Razorpay could not create the payment link.');
    return { url: res.json.short_url, providerRef: res.json.id };
  },
  async parseWebhook({ credentials, rawBody, headers }) {
    const secret = credentials.webhookSecret;
    const signature = header(headers, 'x-razorpay-signature');
    if (!secret || !signature || !safeEqual(signature, hmacSha256Hex(secret, rawBody))) throw new GatewayError('Invalid signature');
    const event = JSON.parse(rawBody.toString('utf8')) as { event: string; payload: { payment_link?: { entity?: { reference_id?: string } }; payment?: { entity?: { id?: string; amount?: number; currency?: string } } } };
    const reference = event.payload.payment_link?.entity?.reference_id;
    if (!reference) return null;
    if (event.event === 'payment_link.paid') {
      const p = event.payload.payment?.entity;
      const currency = upper(p?.currency);
      return { reference, status: 'PAID', transactionId: p?.id, amount: typeof p?.amount === 'number' && currency ? fromMinorUnits(p.amount, currency) : undefined, currency };
    }
    if (event.event === 'payment_link.cancelled' || event.event === 'payment_link.expired') return { reference, status: 'FAILED', reason: event.event.split('.')[1] };
    return null;
  },
};

// ---------------------------------------------------------------------------
// Paystack (Nigeria, Ghana, South Africa, Kenya)
// ---------------------------------------------------------------------------

const paystack: PaymentGatewayAdapter = {
  key: 'paystack',
  label: 'Paystack',
  description: 'Cards, bank transfer, USSD and mobile money across Africa.',
  regions: ['Nigeria', 'Ghana', 'South Africa', 'Kenya'],
  countries: ['NG', 'GH', 'ZA', 'KE'],
  currencies: ['NGN', 'GHS', 'ZAR', 'KES', 'USD'],
  fields: [{ key: 'secretKey', label: 'Secret key', secret: true, required: true, placeholder: 'sk_live_… or sk_test_…', help: 'Paystack Dashboard → Settings → API Keys & Webhooks.' }],
  setupSteps: [
    'In Paystack, open Settings → API Keys & Webhooks and copy the Secret key.',
    'Paste the webhook URL shown here into the Live (or Test) Webhook URL field and save.',
    'Paystack signs webhooks with your secret key, so nothing else is needed.',
  ],
  docsUrl: 'https://paystack.com/docs/payments/webhooks/',
  webhook: true,
  async verify({ credentials }) {
    const res = await http('https://api.paystack.co/bank?perPage=1', { headers: { Authorization: `Bearer ${credentials.secretKey}` } });
    if (res.status === 401) throw new GatewayError('Paystack rejected this secret key.');
    if (!res.ok) throw new GatewayError('Paystack could not verify this key.');
  },
  async createPayment({ credentials }, req) {
    if (!req.customer.email) throw new GatewayError('Paystack needs the customer’s email address. Add one to the customer first.');
    const res = await http<{ status?: boolean; message?: string; data?: { authorization_url?: string; reference?: string } }>('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${credentials.secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: req.customer.email,
        amount: toMinorUnits(req.amount, req.currency),
        currency: req.currency,
        reference: req.reference,
        callback_url: req.returnUrl('success'),
        metadata: { paymentId: req.reference, orderNumber: req.orderNumber },
      }),
    });
    if (!res.ok || !res.json.data?.authorization_url) throw new GatewayError(res.json.message ?? 'Paystack could not create the payment page.');
    return { url: res.json.data.authorization_url, providerRef: res.json.data.reference };
  },
  async parseWebhook({ credentials, rawBody, headers }) {
    const secret = credentials.secretKey;
    const signature = header(headers, 'x-paystack-signature');
    if (!secret || !signature || !safeEqual(signature, sha512Hex(secret, rawBody))) throw new GatewayError('Invalid signature');
    const event = JSON.parse(rawBody.toString('utf8')) as { event: string; data?: { reference?: string; id?: number; amount?: number; currency?: string } };
    if (event.event !== 'charge.success' || !event.data?.reference) return null;
    const currency = upper(event.data.currency);
    return {
      reference: event.data.reference,
      status: 'PAID',
      transactionId: event.data.id !== undefined ? String(event.data.id) : undefined,
      amount: typeof event.data.amount === 'number' && currency ? fromMinorUnits(event.data.amount, currency) : undefined,
      currency,
    };
  },
};

// ---------------------------------------------------------------------------
// SSLCOMMERZ (Bangladesh: bKash, Nagad, Rocket, cards, internet banking)
// ---------------------------------------------------------------------------

const sslBase = (ctx: GatewayContext) => (ctx.config.mode === 'live' ? 'https://securepay.sslcommerz.com' : 'https://sandbox.sslcommerz.com');

const sslcommerz: PaymentGatewayAdapter = {
  key: 'sslcommerz',
  label: 'SSLCOMMERZ',
  description: 'The most widely used Bangladeshi gateway: bKash, Nagad, Rocket, cards and internet banking in one checkout.',
  regions: ['Bangladesh'],
  countries: ['BD'],
  currencies: ['BDT', 'USD', 'EUR', 'GBP', 'SGD', 'INR', 'MYR'],
  fields: [
    { key: 'mode', label: 'Mode', type: 'select', default: 'sandbox', options: [{ value: 'sandbox', label: 'Sandbox (testing)' }, { value: 'live', label: 'Live' }] },
    { key: 'storeId', label: 'Store ID', required: true },
    { key: 'storePassword', label: 'Store password', secret: true, required: true },
  ],
  setupSteps: [
    'Get your Store ID and Store password from the SSLCOMMERZ merchant panel (use the sandbox ones while testing).',
    'In the merchant panel, set the IPN (Instant Payment Notification) URL to the webhook URL shown here.',
    'Switch the mode to Live when SSLCOMMERZ approves your store.',
  ],
  docsUrl: 'https://developer.sslcommerz.com/doc/v4/',
  webhook: true,
  async createPayment(ctx, req) {
    const { storeId = '', storePassword = '' } = ctx.credentials;
    const res = await http<{ status?: string; failedreason?: string; GatewayPageURL?: string; sessionkey?: string }>(`${sslBase(ctx)}/gwprocess/v4/api.php`, {
      method: 'POST',
      form: {
        store_id: storeId,
        store_passwd: storePassword,
        total_amount: req.amount.toFixed(2),
        currency: req.currency,
        tran_id: req.reference,
        success_url: req.returnUrl('success'),
        fail_url: req.returnUrl('failed'),
        cancel_url: req.returnUrl('cancelled'),
        ipn_url: req.notifyUrl,
        shipping_method: 'NO',
        product_name: req.description.slice(0, 100),
        product_category: 'general',
        product_profile: 'general',
        cus_name: req.customer.name,
        cus_email: req.customer.email ?? 'noemail@example.com',
        cus_add1: req.customer.address ?? 'N/A',
        cus_city: req.customer.city ?? 'N/A',
        cus_country: req.customer.country ?? 'Bangladesh',
        cus_phone: req.customer.phone ?? 'N/A',
      },
    });
    if (res.json.status !== 'SUCCESS' || !res.json.GatewayPageURL) throw new GatewayError(res.json.failedreason ?? 'SSLCOMMERZ rejected the payment request. Check the Store ID, password and mode.');
    return { url: res.json.GatewayPageURL, providerRef: res.json.sessionkey };
  },
  async parseWebhook(input) {
    // IPN is a form POST. It is not signed with a shared secret, so the
    // transaction is confirmed by asking SSLCOMMERZ's validation API directly.
    const body = Object.fromEntries(new URLSearchParams(input.rawBody.toString('utf8'))) as Record<string, string>;
    const reference = body.tran_id;
    if (!reference) return null;
    if (body.status === 'FAILED' || body.status === 'CANCELLED') return { reference, status: 'FAILED', reason: body.status.toLowerCase() };
    if (body.status !== 'VALID' && body.status !== 'VALIDATED') return null;
    if (!body.val_id) throw new GatewayError('Missing validation id');
    const { storeId = '', storePassword = '' } = input.credentials;
    const url = `${sslBase(input)}/validator/api/validationserverAPI.php?${new URLSearchParams({ val_id: body.val_id, store_id: storeId, store_passwd: storePassword, v: '1', format: 'json' })}`;
    const check = await http<{ status?: string; tran_id?: string; amount?: string; currency_amount?: string; currency_type?: string; bank_tran_id?: string }>(url);
    if (!check.ok || (check.json.status !== 'VALID' && check.json.status !== 'VALIDATED') || check.json.tran_id !== reference) throw new GatewayError('Transaction could not be validated');
    const currency = upper(check.json.currency_type);
    return {
      reference,
      status: 'PAID',
      transactionId: check.json.bank_tran_id ?? body.val_id,
      amount: Number(check.json.currency_amount ?? check.json.amount),
      currency,
    };
  },
};

// ---------------------------------------------------------------------------

/** Register new adapters here. */
export const GATEWAYS: PaymentGatewayAdapter[] = [manual, customLink, stripe, paypal, razorpay, paystack, sslcommerz];

export function getGateway(key: string): PaymentGatewayAdapter | undefined {
  return GATEWAYS.find((g) => g.key === key);
}

/** Webhook outcome type re-exported for the service layer. */
export type { WebhookOutcome };
