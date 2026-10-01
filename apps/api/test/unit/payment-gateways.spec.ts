import { createHmac } from 'crypto';
import { PaymentStatus } from '@prisma/client';
import { fromMinorUnits, getGateway, GATEWAYS, renderLinkTemplate, toMinorUnits } from '../../src/modules/payment-gateways/gateways';
import { toCountryCode } from '../../src/modules/payment-gateways/countries';
import { renderInstructions } from '../../src/modules/payment-gateways/presets';
import { createPaymentMethodSchema, PaymentMethodsService } from '../../src/modules/payment-gateways/payment-methods.service';
import { PaymentsService } from '../../src/modules/commerce/payments.service';
import { encryptJson } from '../../src/common/utils/crypto.util';

const hex = (alg: 'sha256' | 'sha512', secret: string, body: string | Buffer) => createHmac(alg, secret).update(body).digest('hex');
const adapter = (key: string) => getGateway(key)!;

describe('currency amounts', () => {
  it('converts to minor units with the right exponent', () => {
    expect(toMinorUnits(12.5, 'USD')).toBe(1250);
    expect(toMinorUnits(500, 'JPY')).toBe(500);
    expect(toMinorUnits(1.234, 'KWD')).toBe(1234);
    expect(toMinorUnits(19.99, 'BDT')).toBe(1999);
    expect(fromMinorUnits(1250, 'usd')).toBe(12.5);
  });
});

describe('country codes', () => {
  it('accepts ISO codes and English country names', () => {
    expect(toCountryCode('bd')).toBe('BD');
    expect(toCountryCode('Bangladesh')).toBe('BD');
    expect(toCountryCode(' india ')).toBe('IN');
    expect(toCountryCode('Atlantis')).toBeUndefined();
    expect(toCountryCode(null)).toBeUndefined();
  });
});

describe('gateway catalog', () => {
  it('describes every gateway and requires a webhook parser wherever it promises one', () => {
    expect(new Set(GATEWAYS.map((g) => g.key)).size).toBe(GATEWAYS.length);
    for (const g of GATEWAYS) {
      if (g.webhook) expect(g.parseWebhook).toBeDefined();
      expect(g.setupSteps.length).toBeGreaterThan(0);
    }
  });
});

describe('custom payment links', () => {
  const req = {
    reference: 'ref-1',
    amount: 1500,
    currency: 'BDT',
    description: 'Order ORD-1',
    orderNumber: 'ORD-1',
    customer: { name: 'Rahim Uddin', email: 'r@example.com', phone: '+8801700000000' },
    returnUrl: () => 'https://app/return',
    notifyUrl: 'https://api/notify',
  };

  it('fills placeholders with URL-encoded values', () => {
    expect(renderLinkTemplate('https://pay.example.com/p?n={order_number}&a={amount}&c={customer_name}&x={unknown}', req)).toBe(
      'https://pay.example.com/p?n=ORD-1&a=1500.00&c=Rahim%20Uddin&x={unknown}',
    );
  });

  it('only accepts https templates', async () => {
    const custom = adapter('custom_link');
    await expect(custom.verify!({ credentials: { linkTemplate: 'http://insecure.example' }, config: {} })).rejects.toThrow('https://');
    await expect(custom.verify!({ credentials: { linkTemplate: 'https://pay.example.com/x' }, config: {} })).resolves.toBeUndefined();
  });

  it('confirms payments through a signed webhook', async () => {
    const custom = adapter('custom_link');
    const body = Buffer.from(JSON.stringify({ reference: 'abc', status: 'paid', transactionId: 'tx1', amount: 1500, currency: 'bdt' }));
    const ctx = { credentials: { signingSecret: 's3cret' }, config: {}, rawBody: body };
    const ok = await custom.parseWebhook!({ ...ctx, headers: { 'x-sellora-signature': hex('sha256', 's3cret', body) } });
    expect(ok).toEqual({ reference: 'abc', status: 'PAID', transactionId: 'tx1', amount: 1500, currency: 'BDT' });
    await expect(custom.parseWebhook!({ ...ctx, headers: { 'x-sellora-signature': hex('sha256', 'wrong', body) } })).rejects.toThrow('Invalid signature');
    await expect(custom.parseWebhook!({ ...ctx, headers: {} })).rejects.toThrow('Missing signature');
    await expect(custom.parseWebhook!({ credentials: {}, config: {}, rawBody: body, headers: { 'x-sellora-signature': hex('sha256', '', body) } })).rejects.toThrow();
  });
});

describe('gateway webhooks', () => {
  it('Stripe: verifies the signature and reads a paid checkout session', async () => {
    const body = Buffer.from(
      JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'pay-1', payment_status: 'paid', payment_intent: 'pi_1', amount_total: 2500, currency: 'usd' } } }),
    );
    const t = Math.floor(Date.now() / 1000);
    const sig = hex('sha256', 'whsec_x', `${t}.${body.toString('utf8')}`);
    const base = { credentials: { webhookSecret: 'whsec_x' }, config: {}, rawBody: body };
    const out = await adapter('stripe').parseWebhook!({ ...base, headers: { 'stripe-signature': `t=${t},v1=${sig}` } });
    expect(out).toEqual({ reference: 'pay-1', status: 'PAID', transactionId: 'pi_1', amount: 25, currency: 'USD' });
    await expect(adapter('stripe').parseWebhook!({ ...base, headers: { 'stripe-signature': `t=${t},v1=${'0'.repeat(64)}` } })).rejects.toThrow('Invalid signature');
    const old = t - 3600;
    await expect(adapter('stripe').parseWebhook!({ ...base, headers: { 'stripe-signature': `t=${old},v1=${hex('sha256', 'whsec_x', `${old}.${body.toString('utf8')}`)}` } })).rejects.toThrow('timestamp');
  });

  it('Stripe: waits for delayed payment methods to settle', async () => {
    const body = Buffer.from(JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'p', payment_status: 'unpaid' } } }));
    const t = Math.floor(Date.now() / 1000);
    const out = await adapter('stripe').parseWebhook!({
      credentials: { webhookSecret: 's' },
      config: {},
      rawBody: body,
      headers: { 'stripe-signature': `t=${t},v1=${hex('sha256', 's', `${t}.${body.toString('utf8')}`)}` },
    });
    expect(out).toBeNull();
  });

  it('Razorpay: reads payment_link.paid and rejects bad signatures', async () => {
    const body = Buffer.from(
      JSON.stringify({ event: 'payment_link.paid', payload: { payment_link: { entity: { reference_id: 'pay-2' } }, payment: { entity: { id: 'pay_9', amount: 150000, currency: 'INR' } } } }),
    );
    const base = { credentials: { webhookSecret: 'rz' }, config: {}, rawBody: body };
    expect(await adapter('razorpay').parseWebhook!({ ...base, headers: { 'x-razorpay-signature': hex('sha256', 'rz', body) } })).toEqual({
      reference: 'pay-2',
      status: 'PAID',
      transactionId: 'pay_9',
      amount: 1500,
      currency: 'INR',
    });
    await expect(adapter('razorpay').parseWebhook!({ ...base, headers: { 'x-razorpay-signature': 'nope' } })).rejects.toThrow('Invalid signature');
  });

  it('Paystack: verifies the HMAC-SHA512 signature', async () => {
    const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'pay-3', id: 77, amount: 500000, currency: 'NGN' } }));
    const base = { credentials: { secretKey: 'sk_test_1' }, config: {}, rawBody: body };
    expect(await adapter('paystack').parseWebhook!({ ...base, headers: { 'x-paystack-signature': hex('sha512', 'sk_test_1', body) } })).toEqual({
      reference: 'pay-3',
      status: 'PAID',
      transactionId: '77',
      amount: 5000,
      currency: 'NGN',
    });
    await expect(adapter('paystack').parseWebhook!({ ...base, headers: { 'x-paystack-signature': hex('sha256', 'sk_test_1', body) } })).rejects.toThrow('Invalid signature');
  });

  it('SSLCOMMERZ: reports cancelled payments without calling the gateway', async () => {
    const body = Buffer.from('tran_id=pay-4&status=CANCELLED');
    expect(await adapter('sslcommerz').parseWebhook!({ credentials: { storeId: 's', storePassword: 'p' }, config: {}, rawBody: body, headers: {} })).toEqual({
      reference: 'pay-4',
      status: 'FAILED',
      reason: 'cancelled',
    });
  });

  it('SSLCOMMERZ: only trusts a payment the validation API confirms', async () => {
    const body = Buffer.from('tran_id=pay-5&status=VALID&val_id=v1');
    const input = { credentials: { storeId: 's', storePassword: 'p' }, config: {}, rawBody: body, headers: {} };
    const fetchMock = jest.spyOn(global, 'fetch');
    try {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'VALID', tran_id: 'pay-5', amount: '1500.00', currency_type: 'BDT', currency_amount: '1500.00', bank_tran_id: 'B1' })));
      expect(await adapter('sslcommerz').parseWebhook!(input)).toEqual({ reference: 'pay-5', status: 'PAID', transactionId: 'B1', amount: 1500, currency: 'BDT' });
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'VALID', tran_id: 'someone-else' })));
      await expect(adapter('sslcommerz').parseWebhook!(input)).rejects.toThrow('validated');
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'INVALID_TRANSACTION' })));
      await expect(adapter('sslcommerz').parseWebhook!(input)).rejects.toThrow('validated');
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe('payment method setup', () => {
  const methods = (existing: unknown[] = []) => {
    const created: Array<{ data: Record<string, unknown> }> = [];
    const prisma = {
      paymentMethod: {
        findUnique: jest.fn(async () => null),
        count: jest.fn(async () => existing.length),
        create: jest.fn(async (args: { data: Record<string, unknown> }) => {
          created.push(args);
          return { id: 'm1', createdAt: new Date(), lastError: null, sortOrder: 0, ...args.data };
        }),
      },
    };
    return { svc: new PaymentMethodsService(prisma as never, { log: jest.fn() } as never), created };
  };
  const actor = { tenantId: 't1', userId: 'u1', name: 'Owner', type: 'USER' as const };

  it('stores credentials encrypted and never returns secrets', async () => {
    const { svc, created } = methods();
    const view = await svc.create(
      actor,
      createPaymentMethodSchema.parse({ provider: 'custom_link', name: 'Local PSP', values: { linkTemplate: 'https://pay.example.com/{reference}', signingSecret: 'super-secret-signing-key' } }),
    );
    expect(created[0]!.data.credentialsEnc).toEqual(expect.stringMatching(/^v1:/));
    expect(created[0]!.data.credentialsEnc).not.toContain('super-secret');
    expect(view.values).toEqual({ linkTemplate: 'https://pay.example.com/{reference}' });
    expect(view.secretsSet).toEqual(['signingSecret']);
    expect(JSON.stringify(view)).not.toContain('super-secret');
    expect(view).toMatchObject({ methodKey: 'local_psp', online: true });
  });

  it('creates manual methods without credentials and normalises countries', async () => {
    const { svc, created } = methods();
    const result = await svc.create(actor, createPaymentMethodSchema.parse({ provider: 'manual', name: 'bKash', instructions: 'Send to 017…', countries: ['bd'] }));
    expect(result).toMatchObject({ methodKey: 'bkash', countries: ['BD'], online: false, webhookUrl: null });
    expect(created[0]!.data.credentialsEnc).toBeNull();
  });

  it('manual methods need instructions and required gateway fields are enforced', async () => {
    const { svc } = methods();
    await expect(svc.create(actor, createPaymentMethodSchema.parse({ provider: 'manual', name: 'Bank transfer' }))).rejects.toThrow('how to pay');
    await expect(svc.create(actor, createPaymentMethodSchema.parse({ provider: 'razorpay', name: 'Razorpay', values: { keyId: 'rzp_test_1' } }))).rejects.toThrow('Key secret is required');
    await expect(svc.create(actor, createPaymentMethodSchema.parse({ provider: 'nope', name: 'Nope' }))).rejects.toThrow('Unknown payment gateway');
  });

  it('keeps saved secrets when an edit leaves them blank', () => {
    const { svc } = methods();
    const row = {
      id: 'm1',
      provider: 'razorpay',
      methodKey: 'razorpay',
      name: 'Razorpay',
      instructions: null,
      countries: ['IN'],
      currencies: [],
      isActive: true,
      lastError: null,
      createdAt: new Date(),
      webhookToken: 'tok',
      credentialsEnc: encryptJson({ keyId: 'rzp_live_1', keySecret: 'secret-value', webhookSecret: 'whsec' }),
    };
    const view = svc.present(row as never);
    expect(view.values).toEqual({ keyId: 'rzp_live_1' });
    expect(view.secretsSet.sort()).toEqual(['keySecret', 'webhookSecret']);
    expect(JSON.stringify(view)).not.toContain('secret-value');
    expect(view.webhookUrl).toMatch(/\/payment-gateways\/webhooks\/tok$/);
  });
});

describe('PaymentsService.applyOutcome', () => {
  const method = { id: 'm1', tenantId: 't1', name: 'Stripe', methodKey: 'stripe', provider: 'stripe' } as never;
  const make = (payment: Record<string, unknown> | null, updateCount = 1) => {
    const prisma = {
      payment: {
        findFirst: jest.fn(async () => payment),
        updateMany: jest.fn(async () => ({ count: updateCount })),
        update: jest.fn(async () => payment),
      },
    };
    const orders = { syncPaymentState: jest.fn(async () => ({ becamePaid: false })) };
    const audit = { log: jest.fn() };
    const activity = { record: jest.fn() };
    const notifications = { notify: jest.fn() };
    const svc = new PaymentsService(prisma as never, audit as never, activity as never, {} as never, notifications as never, {} as never, orders as never, {} as never);
    return { svc, prisma, orders, notifications };
  };
  const pending = { id: 'p1', orderId: 'o1', status: PaymentStatus.PENDING, amount: 25, currency: 'USD', providerRef: 'cs_1' };

  it('marks a pending payment paid and syncs the order', async () => {
    const { svc, prisma, orders } = make(pending);
    expect(await svc.applyOutcome(method, { reference: 'p1', status: 'PAID', transactionId: 'pi_1', amount: 25, currency: 'USD' })).toBe('applied');
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: PaymentStatus.PAID, providerRef: 'pi_1' }) }));
    expect(orders.syncPaymentState).toHaveBeenCalledWith('t1', 'o1');
  });

  it('ignores unknown references and repeated notifications', async () => {
    expect(await make(null).svc.applyOutcome(method, { reference: 'x', status: 'PAID' })).toBe('unknown');
    expect(await make(pending, 0).svc.applyOutcome(method, { reference: 'p1', status: 'PAID' })).toBe('duplicate');
  });

  it('does not mark a payment paid when the amount or currency differs', async () => {
    const { svc, prisma, notifications } = make(pending);
    expect(await svc.applyOutcome(method, { reference: 'p1', status: 'PAID', amount: 5, currency: 'USD' })).toBe('mismatch');
    expect(await svc.applyOutcome(method, { reference: 'p1', status: 'PAID', amount: 25, currency: 'EUR' })).toBe('mismatch');
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledTimes(2);
  });

  it('records failed payments', async () => {
    const { svc, prisma } = make(pending);
    expect(await svc.applyOutcome(method, { reference: 'p1', status: 'FAILED', reason: 'expired' })).toBe('applied');
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: PaymentStatus.FAILED } }));
  });
});

describe('payment instructions', () => {
  it('fills in the order number and amount', () => {
    expect(renderInstructions('Pay {amount} with ref {order_number}', { order_number: 'ORD-9', amount: '$10.00' })).toBe('Pay $10.00 with ref ORD-9');
  });
});
