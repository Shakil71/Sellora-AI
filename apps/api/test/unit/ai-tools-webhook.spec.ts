import { AIToolsService, ToolContext } from '../../src/modules/ai/ai-tools.service';
import { WhatsAppWebhookService } from '../../src/modules/whatsapp/webhook.service';
import { encryptSecret, hmacSha256Hex } from '../../src/common/utils/crypto.util';

/** Minimal Prisma double recording tool-execution logs. */
function prismaDouble(extra: Record<string, unknown> = {}) {
  const logs: unknown[] = [];
  return {
    logs,
    aIToolExecution: { create: jest.fn(async (args: { data: unknown }) => { logs.push(args.data); return args.data; }) },
    ...extra,
  };
}

const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({
  tenantId: 't1',
  agentId: 'a1',
  agentName: 'Agent',
  conversationId: 'c1',
  customerId: 'cust1',
  currency: 'USD',
  enabledTools: ['searchProducts', 'createOrder'],
  dryRun: false,
  ...over,
});

describe('AI tool system', () => {
  const products = { search: jest.fn(async () => [{ id: 'p1', name: 'Smart Watch', sku: 'SW', effectivePrice: 199, price: 199, salePrice: null, trackInventory: true, available: 3, category: { name: 'W' }, description: 'd' }]) };
  const orders = { create: jest.fn(), quote: jest.fn() };
  const tenants = { commerceSettings: jest.fn(async () => ({ aiCanCreateOrders: true })) };
  const make = (prisma = prismaDouble()) =>
    ({ svc: new AIToolsService(prisma as never, products as never, {} as never, orders as never, {} as never, {} as never, {} as never, {} as never, tenants as never), prisma });

  beforeEach(() => jest.clearAllMocks());

  it('executes an enabled read tool and logs it', async () => {
    const { svc, prisma } = make();
    const out = await svc.execute('searchProducts', JSON.stringify({ query: 'watch' }), ctx());
    expect(out.ok).toBe(true);
    expect(JSON.stringify(out.data)).toContain('$199.00');
    expect(prisma.logs).toHaveLength(1);
    expect((prisma.logs[0] as { status: string }).status).toBe('SUCCESS');
  });

  it('denies tools that are not enabled for the agent', async () => {
    const { svc, prisma } = make();
    const out = await svc.execute('createLead', JSON.stringify({ interest: 'x' }), ctx());
    expect(out.ok).toBe(false);
    expect((prisma.logs[0] as { status: string }).status).toBe('DENIED');
  });

  it('refuses to create an order without explicit customer confirmation', async () => {
    const { svc } = make();
    const out = await svc.execute(
      'createOrder',
      JSON.stringify({ items: [{ productId: '00000000-0000-4000-8000-000000000001', quantity: 1 }], shippingName: 'Ann', shippingAddress: '1 Main St', shippingCity: 'NYC', customerConfirmed: false }),
      ctx(),
    );
    expect(out.ok).toBe(false);
    expect(orders.create).not.toHaveBeenCalled();
  });

  it('runs write tools as dry runs in the playground', async () => {
    const { svc, prisma } = make();
    const out = await svc.execute(
      'createOrder',
      JSON.stringify({ items: [{ productId: '00000000-0000-4000-8000-000000000001', quantity: 1 }], shippingName: 'Ann', shippingAddress: '1 Main St', shippingCity: 'NYC', customerConfirmed: true }),
      ctx({ dryRun: true }),
    );
    expect(out.ok).toBe(true);
    expect(orders.create).not.toHaveBeenCalled();
    expect((prisma.logs[0] as { status: string }).status).toBe('DRY_RUN');
  });

  it('rejects malformed arguments', async () => {
    const { svc } = make();
    const out = await svc.execute('searchProducts', '{"query": ""}', ctx());
    expect(out.ok).toBe(false);
    expect(out.error).toContain('Invalid arguments');
  });

  it('always exposes transferToHuman', () => {
    const { svc } = make();
    expect(svc.definitions([]).map((d) => d.name)).toEqual(['transferToHuman']);
  });
});

describe('WhatsApp webhook signature verification', () => {
  const secret = 'app-secret-123';
  const account = { id: 'acc', tenantId: 't1', phoneNumberId: '123', appSecretEnc: encryptSecret(secret) };
  const payload = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '123' }, messages: [] } }] }] }));
  const build = () => {
    const created: unknown[] = [];
    const prisma = {
      whatsAppAccount: { findMany: jest.fn(async () => [account]), findFirst: jest.fn(async () => null) },
      webhookEvent: { create: jest.fn(async (a: { data: unknown }) => { created.push(a.data); return { id: 'evt1' }; }) },
    };
    const queues = { processWebhook: jest.fn() };
    return { svc: new WhatsAppWebhookService(prisma as never, queues as never), created, queues };
  };

  it('accepts a correctly signed payload and queues it', async () => {
    const { svc, queues } = build();
    const res = await svc.receive(payload, `sha256=${hmacSha256Hex(secret, payload)}`);
    expect(res.ok).toBe(true);
    expect(queues.processWebhook).toHaveBeenCalledWith('evt1');
  });

  it('rejects spoofed, unsigned and malformed requests', async () => {
    const { svc, created } = build();
    expect((await svc.receive(payload, `sha256=${hmacSha256Hex('wrong', payload)}`)).ok).toBe(false);
    expect((await svc.receive(payload, undefined)).ok).toBe(false);
    expect((await svc.receive(Buffer.from('not json'), 'sha256=x')).ok).toBe(false);
    expect(created).toHaveLength(0);
  });
});

describe('AI payment tools', () => {
  const order = { id: 'o1', number: 'ORD-1', currency: 'USD', total: 50, amountPaid: 0 };
  const methods = [
    { id: 'm1', key: 'stripe', label: 'Stripe', online: true, offered: true },
    { id: 'm2', key: 'bkash', label: 'bKash', online: false, offered: false },
  ];
  const payments = { methods: jest.fn(async () => methods), requestPayment: jest.fn(async () => ({ url: 'https://pay.example/x', message: 'Pay here: https://pay.example/x', sent: false })) };
  const prisma = { aIToolExecution: { create: jest.fn(async (a: { data: unknown }) => a.data) }, order: { findMany: jest.fn(async () => [order]) } };
  const svc = new AIToolsService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, payments as never);
  const enabled = ctx({ enabledTools: ['getPaymentOptions', 'requestPayment'] });

  beforeEach(() => jest.clearAllMocks());

  it('lists only the methods offered for the order', async () => {
    const out = await svc.execute('getPaymentOptions', '{}', enabled);
    expect(out.ok).toBe(true);
    expect(JSON.stringify(out.data)).toContain('Stripe');
    expect(JSON.stringify(out.data)).not.toContain('bKash');
    expect(JSON.stringify(out.data)).toContain('$50.00');
  });

  it('creates a payment link for a chosen method', async () => {
    const out = await svc.execute('requestPayment', JSON.stringify({ method: 'stripe' }), enabled);
    expect(out.ok).toBe(true);
    expect(payments.requestPayment).toHaveBeenCalledWith(expect.anything(), { orderId: 'o1', methodId: 'm1', sendToCustomer: false });
  });

  it('refuses methods that are not offered and never calls the gateway', async () => {
    const out = await svc.execute('requestPayment', JSON.stringify({ method: 'bKash' }), enabled);
    expect(out.ok).toBe(false);
    expect(payments.requestPayment).not.toHaveBeenCalled();
  });

  it('is a dry run in the playground', async () => {
    const out = await svc.execute('requestPayment', JSON.stringify({ method: 'stripe' }), { ...enabled, dryRun: true });
    expect(out.ok).toBe(true);
    expect(payments.requestPayment).not.toHaveBeenCalled();
  });
});
