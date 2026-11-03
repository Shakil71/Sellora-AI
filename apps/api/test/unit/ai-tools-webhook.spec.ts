import { AIToolsService, ToolContext } from '../../src/modules/ai/ai-tools.service';
import { WhatsAppWebhookService } from '../../src/modules/whatsapp/webhook.service';
import { MetaWebhookService } from '../../src/modules/integrations/meta-webhook.service';
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

  it("drops changes for another workspace's number signed with a different secret", async () => {
    const victim = { id: 'acc2', tenantId: 't2', phoneNumberId: '999', appSecretEnc: encryptSecret('victim-secret') };
    const created: Array<{ tenantId: string; payload: { entry: Array<{ changes: Array<{ value: { metadata: { phone_number_id: string } } }> }> } }> = [];
    const prisma = {
      whatsAppAccount: { findMany: jest.fn(async () => [account, victim]) },
      webhookEvent: { create: jest.fn(async (a: { data: never }) => { created.push(a.data); return { id: 'evt1' }; }) },
    };
    const svc = new WhatsAppWebhookService(prisma as never, { processWebhook: jest.fn() } as never);
    const mixed = Buffer.from(
      JSON.stringify({
        entry: [
          { changes: [{ value: { metadata: { phone_number_id: '123' }, messages: [] } }] },
          { changes: [{ value: { metadata: { phone_number_id: '999' }, messages: [{ id: 'm1', from: '1', type: 'text', text: { body: 'hi' } }] } }] },
        ],
      }),
    );
    const res = await svc.receive(mixed, `sha256=${hmacSha256Hex(secret, mixed)}`);
    expect(res.ok).toBe(true);
    expect(created[0]!.tenantId).toBe('t1');
    const stored = created[0]!.payload.entry.flatMap((e) => e.changes.map((c) => c.value.metadata.phone_number_id));
    expect(stored).toEqual(['123']);
  });

  it('splits a batch for several workspaces of one shared app into one event per workspace', async () => {
    const other = { id: 'acc2', tenantId: 't2', phoneNumberId: '999', appSecretEnc: encryptSecret(secret) };
    const created: Array<{ tenantId: string; payload: { entry: Array<{ changes: Array<{ value: { metadata: { phone_number_id: string } } }> }> } }> = [];
    let n = 0;
    const prisma = {
      whatsAppAccount: { findMany: jest.fn(async () => [account, other]) },
      webhookEvent: { create: jest.fn(async (a: { data: never }) => { created.push(a.data); return { id: `evt${++n}` }; }) },
    };
    const queues = { processWebhook: jest.fn() };
    const svc = new WhatsAppWebhookService(prisma as never, queues as never);
    const batch = Buffer.from(
      JSON.stringify({
        entry: [
          { changes: [{ value: { metadata: { phone_number_id: '123' }, messages: [] } }] },
          { changes: [{ value: { metadata: { phone_number_id: '999' }, messages: [] } }] },
        ],
      }),
    );
    expect((await svc.receive(batch, `sha256=${hmacSha256Hex(secret, batch)}`)).ok).toBe(true);
    const ids = (e: (typeof created)[number]) => e.payload.entry.flatMap((x) => x.changes.map((c) => c.value.metadata.phone_number_id));
    expect(created.map((e) => [e.tenantId, ids(e)])).toEqual([['t1', ['123']], ['t2', ['999']]]);
    expect(queues.processWebhook).toHaveBeenCalledTimes(2);
  });

  it("rejects a payload naming only another workspace's number", async () => {
    const victim = { id: 'acc2', tenantId: 't2', phoneNumberId: '999', appSecretEnc: encryptSecret('victim-secret') };
    const created: unknown[] = [];
    const prisma = {
      whatsAppAccount: { findMany: jest.fn(async () => [victim]) },
      webhookEvent: { create: jest.fn(async (a: { data: unknown }) => { created.push(a.data); return { id: 'evt1' }; }) },
    };
    const svc = new WhatsAppWebhookService(prisma as never, { processWebhook: jest.fn() } as never);
    const forged = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '999' }, messages: [] } }] }] }));
    expect((await svc.receive(forged, `sha256=${hmacSha256Hex(secret, forged)}`)).ok).toBe(false);
    expect(created).toHaveLength(0);
  });
});

describe('Meta webhook signature verification', () => {
  const own = { id: 'c1', tenantId: 't1', type: 'MESSENGER', externalId: 'page-1', appSecretEnc: encryptSecret('own-secret') };
  const victim = { id: 'c2', tenantId: 't2', type: 'MESSENGER', externalId: 'page-2', appSecretEnc: encryptSecret('victim-secret') };
  const build = (connections: unknown[]) => {
    const created: Array<{ tenantId: string; payload: { entry: Array<{ id: string }> } }> = [];
    const prisma = {
      channelConnection: { findMany: jest.fn(async () => connections) },
      webhookEvent: { create: jest.fn(async (a: { data: never }) => { created.push(a.data); return { id: 'evt1' }; }) },
    };
    const queues = { processMetaWebhook: jest.fn() };
    const svc = new MetaWebhookService(prisma as never, queues as never, {} as never, {} as never, {} as never, {} as never);
    return { svc, created, queues };
  };
  const body = (ids: string[]) =>
    Buffer.from(JSON.stringify({ object: 'page', entry: ids.map((id) => ({ id, messaging: [{ sender: { id: 'u' }, message: { mid: `m-${id}`, text: 'hi' } }] })) }));

  it('keeps only the entries the signing secret covers', async () => {
    const { svc, created, queues } = build([own, victim]);
    const raw = body(['page-1', 'page-2']);
    const res = await svc.receive(raw, `sha256=${hmacSha256Hex('own-secret', raw)}`);
    expect(res.ok).toBe(true);
    expect(created[0]!.tenantId).toBe('t1');
    expect(created[0]!.payload.entry.map((e) => e.id)).toEqual(['page-1']);
    expect(queues.processMetaWebhook).toHaveBeenCalledWith('evt1');
  });

  it("rejects entries for another workspace's page signed with a different secret", async () => {
    const { svc, created } = build([victim]);
    const raw = body(['page-2']);
    expect((await svc.receive(raw, `sha256=${hmacSha256Hex('own-secret', raw)}`)).ok).toBe(false);
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
