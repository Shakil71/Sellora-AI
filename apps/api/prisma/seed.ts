/**
 * Sellora AI seed script.
 *
 *   npm run db:seed                         → sync permissions only (safe, idempotent)
 *   npm run db:seed -- --admin you@x.com Pass1234   → also create a platform administrator
 *   npm run db:seed:demo                    → also create the "Acme Commerce" demo workspace
 *
 * Demo data is fictional, flagged with isDemo=true and tagged "demo".
 * Never run the demo seed against a production workspace you care about.
 */
import {
  ChannelType,
  ConversationHandler,
  ConversationStatus,
  DealStatus,
  LeadStatus,
  MessageDirection,
  MessageSenderType,
  MessageStatus,
  MessageType,
  OrderSource,
  OrderStatus,
  PaymentStatus,
  Prisma,
  PrismaClient,
  StageType,
  StockStatus,
  WorkflowNodeType,
  WorkflowStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { PERMISSION_GROUPS, SYSTEM_ROLES, SYSTEM_ROLE_KEYS, AI_TOOL_NAMES, calculateOrderTotals } from '@sellora/shared';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const DEMO = args.includes('--demo');
const adminIdx = args.indexOf('--admin');

const DEMO_EMAIL = 'demo@sellora.test';
const DEMO_PASSWORD = 'SelloraDemo2026';

async function syncPermissions() {
  for (const group of PERMISSION_GROUPS) {
    for (const p of group.permissions) {
      await prisma.permission.upsert({
        where: { key: p.key },
        create: { key: p.key, group: group.group, description: p.description },
        update: { group: group.group, description: p.description },
      });
    }
  }
  console.log('✓ Permission catalog synced');
}

const hash = (pw: string) => argon2.hash(pw, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

async function provisionTenant(ownerId: string, name: string, slug: string, isDemo: boolean) {
  const permissions = await prisma.permission.findMany();
  const permId = new Map(permissions.map((p) => [p.key, p.id]));
  const tenant = await prisma.tenant.create({
    data: {
      name,
      slug,
      businessName: name,
      industry: 'Consumer electronics',
      country: 'United States',
      currency: 'USD',
      timezone: 'America/New_York',
      website: 'https://example.com',
      email: 'hello@example.com',
      isDemo,
      onboardingStep: 6,
      onboardingCompletedAt: new Date(),
      aiInstructions: 'Always mention our 30-day return policy when customers hesitate. Offer free shipping on orders over $150.',
      settings: {
        commerce: {
          taxRatePercent: 8,
          defaultShippingFee: 9.99,
          freeShippingThreshold: 150,
          inventoryMode: 'reserve',
          allowBackorders: false,
          orderPrefix: 'ACM',
          invoicePrefix: 'INV',
          invoiceDueDays: 7,
          deliveryZones: [
            { name: 'New York City', cities: ['new york', 'brooklyn', 'queens'], countries: [], fee: 4.99, etaDays: 1 },
            { name: 'United States', cities: [], countries: ['united states', 'usa', 'us'], fee: 9.99, etaDays: 4 },
          ],
          paymentMethods: ['cash_on_delivery', 'bank_transfer', 'card', 'mobile_wallet'],
          aiCanCreateOrders: true,
          sendOrderConfirmation: false,
        },
      } as Prisma.InputJsonValue,
    },
  });
  const roleIds: Record<string, string> = {};
  for (const key of SYSTEM_ROLE_KEYS) {
    const def = SYSTEM_ROLES[key];
    const role = await prisma.role.create({
      data: {
        tenantId: tenant.id,
        key,
        name: def.name,
        description: def.description,
        isSystem: true,
        permissions: { create: def.permissions.filter((p) => permId.has(p)).map((p) => ({ permissionId: permId.get(p)! })) },
      },
    });
    roleIds[key] = role.id;
  }
  await prisma.userRole.create({ data: { tenantId: tenant.id, userId: ownerId, roleId: roleIds.OWNER! } });
  await prisma.subscription.create({ data: { tenantId: tenant.id, plan: 'PRO' } });
  return { tenant, roleIds };
}

const daysAgo = (d: number, h = 10) => {
  const date = new Date(Date.now() - d * 86400_000);
  date.setHours(h, (d * 7) % 60, 0, 0);
  return date;
};

async function seedDemo() {
  const existing = await prisma.tenant.findUnique({ where: { slug: 'acme-commerce-demo' } });
  if (existing) {
    console.log('• Demo workspace already exists — skipping (delete it first to re-seed)');
    return;
  }
  let owner = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!owner) {
    owner = await prisma.user.create({ data: { email: DEMO_EMAIL, name: 'Demo Owner', passwordHash: await hash(DEMO_PASSWORD), emailVerifiedAt: new Date() } });
  }
  const { tenant, roleIds } = await provisionTenant(owner.id, 'Acme Commerce', 'acme-commerce-demo', true);
  const t = tenant.id;
  await prisma.user.update({ where: { id: owner.id }, data: { lastTenantId: t } });

  const sales = await prisma.user.create({
    data: { email: 'sales.demo@sellora.test', name: 'Sam Rivera (demo)', passwordHash: await hash(DEMO_PASSWORD), emailVerifiedAt: new Date() },
  }).catch(() => prisma.user.findUniqueOrThrow({ where: { email: 'sales.demo@sellora.test' } }));
  await prisma.userRole.create({ data: { tenantId: t, userId: sales.id, roleId: roleIds.SALES! } });

  // Categories & products
  const cats = await Promise.all(
    [
      ['Audio', 'audio', 'Headphones and speakers'],
      ['Wearables', 'wearables', 'Smart watches and fitness'],
      ['Accessories', 'accessories', 'Chargers and cables'],
      ['Bags', 'bags', 'Backpacks and travel'],
    ].map(([name, slug, description], i) => prisma.category.create({ data: { tenantId: t, name: name!, slug: slug!, description, position: i } })),
  );
  const catBy = Object.fromEntries(cats.map((c) => [c.slug, c.id]));
  const productDefs = [
    { name: 'Wireless Headphones', sku: 'ACM-WH-100', price: 129, sale: 109, cost: 55, cat: 'audio', stock: 42, tags: ['headphones', 'wireless', 'noise-cancelling'], desc: 'Over-ear Bluetooth headphones with active noise cancellation and 30-hour battery life.', notes: 'Battery: 30h with ANC, 40h without. Charges via USB-C (10 min = 3 h). 2-year warranty. Colors: black, silver.' },
    { name: 'Smart Watch', sku: 'ACM-SW-200', price: 199, sale: null, cost: 90, cat: 'wearables', stock: 18, tags: ['watch', 'fitness', 'smart'], desc: 'Fitness and health smart watch with GPS, heart-rate and sleep tracking. Water resistant to 50 m.', notes: 'Works with iOS and Android. Battery 7 days. Straps: 20 mm. Includes magnetic charger.' },
    { name: 'Bluetooth Speaker', sku: 'ACM-BS-300', price: 79, sale: null, cost: 32, cat: 'audio', stock: 4, tags: ['speaker', 'portable', 'waterproof'], desc: 'Portable waterproof speaker (IP67) with deep bass and 12-hour playtime.', notes: 'Pair two speakers for stereo. Not suitable for submersion longer than 30 minutes.' },
    { name: 'USB-C Fast Charger', sku: 'ACM-CH-65', price: 39, sale: 34, cost: 12, cat: 'accessories', stock: 120, tags: ['charger', 'usb-c', '65w'], desc: '65 W GaN USB-C charger for laptops, tablets and phones.', notes: 'Two USB-C ports and one USB-A. Supports PD 3.0 and PPS. Cable not included.' },
    { name: 'Premium Backpack', sku: 'ACM-BP-500', price: 149, sale: null, cost: 60, cat: 'bags', stock: 0, tags: ['backpack', 'travel', 'laptop'], desc: 'Water-resistant 25 L backpack with padded 16" laptop sleeve.', notes: 'Restock expected in 2 weeks. Lifetime warranty on zippers.' },
    { name: 'Wireless Earbuds', sku: 'ACM-EB-150', price: 89, sale: null, cost: 35, cat: 'audio', stock: 64, tags: ['earbuds', 'wireless'], desc: 'True wireless earbuds with transparency mode and wireless charging case.', notes: 'IPX4 sweat resistant. 6 h + 24 h with case.' },
  ];
  const products = [];
  for (const p of productDefs) {
    const product = await prisma.product.create({
      data: {
        tenantId: t, name: p.name, sku: p.sku, price: p.price, salePrice: p.sale, cost: p.cost, categoryId: catBy[p.cat], tags: p.tags,
        description: p.desc, aiNotes: p.notes, isDemo: true, attributes: { warranty: '2 years' },
      },
    });
    const status = p.stock <= 0 ? StockStatus.OUT_OF_STOCK : p.stock <= 5 ? StockStatus.LOW_STOCK : StockStatus.IN_STOCK;
    await prisma.inventory.create({ data: { tenantId: t, productId: product.id, onHand: p.stock, reserved: 0, lowStockThreshold: 5, status } });
    await prisma.inventoryMovement.create({ data: { tenantId: t, productId: product.id, type: 'INITIAL', quantity: p.stock, onHandAfter: p.stock, reservedAfter: 0, reason: 'Demo initial stock' } });
    products.push(product);
  }

  // Customers (fictional)
  const customerDefs = [
    ['Maya Chen', 'maya.chen@example.com', '+12125550101', 'New York'],
    ['Omar Haddad', 'omar.h@example.com', '+12125550102', 'Brooklyn'],
    ['Lina Kovacs', null, '+13105550103', 'Los Angeles'],
    ['Diego Alvarez', 'diego.alvarez@example.com', '+13125550104', 'Chicago'],
    ['Priya Nair', 'priya.nair@example.com', '+14155550105', 'San Francisco'],
    ['Jonas Weber', null, '+16175550106', 'Boston'],
    ['Aisha Bello', 'aisha.bello@example.com', '+17135550107', 'Houston'],
    ['Tom Becker', 'tom.becker@example.com', '+12065550108', 'Seattle'],
  ] as const;
  const customers = [];
  for (const [i, [name, email, phone, city]] of customerDefs.entries()) {
    customers.push(
      await prisma.customer.create({
        data: { tenantId: t, name, email, phone, whatsappNumber: phone, city, country: 'United States', tags: ['demo', ...(i % 3 === 0 ? ['vip'] : [])], source: i % 2 ? 'whatsapp' : 'website', isDemo: true, createdAt: daysAgo(60 - i * 5), lastInteractionAt: daysAgo(i) },
      }),
    );
  }

  // Orders
  let counter = 1000;
  const statuses: OrderStatus[] = ['DELIVERED', 'DELIVERED', 'SHIPPED', 'CONFIRMED', 'PENDING', 'DELIVERED', 'PROCESSING', 'CANCELLED', 'DELIVERED', 'PENDING', 'DELIVERED', 'PACKED'];
  for (let i = 0; i < 24; i++) {
    const customer = customers[i % customers.length]!;
    const lines = [products[i % 4]!, ...(i % 3 === 0 ? [products[3]!] : [])];
    const items = lines.map((p, j) => ({ product: p, quantity: j === 0 ? 1 + (i % 2) : 1 }));
    const unit = (p: (typeof products)[number]) => (p.salePrice !== null ? Number(p.salePrice) : Number(p.price));
    const totals = calculateOrderTotals({ items: items.map((it) => ({ unitPrice: unit(it.product), quantity: it.quantity })), shipping: 9.99, taxRatePercent: 8 });
    const status = statuses[i % statuses.length]!;
    const paid = ['DELIVERED', 'SHIPPED', 'PACKED'].includes(status);
    const createdAt = daysAgo(Math.floor(i * 2.4) + 1, 9 + (i % 8));
    counter += 1;
    const order = await prisma.order.create({
      data: {
        tenantId: t, number: `ACM-${String(counter).padStart(6, '0')}`, customerId: customer.id, status, paymentStatus: paid ? PaymentStatus.PAID : PaymentStatus.PENDING,
        source: i % 3 === 0 ? OrderSource.AI : i % 3 === 1 ? OrderSource.WHATSAPP : OrderSource.MANUAL, currency: 'USD',
        subtotal: totals.subtotal, taxTotal: totals.taxTotal, shippingTotal: totals.shippingTotal, discountTotal: 0, total: totals.total, amountPaid: paid ? totals.total : 0,
        shippingName: customer.name, shippingPhone: customer.phone, shippingAddress: `${100 + i} Demo Street`, shippingCity: customer.city, shippingCountry: 'United States',
        inventoryCommitted: ['DELIVERED', 'SHIPPED'].includes(status), createdAt, placedAt: createdAt, isDemo: true,
        items: { create: items.map((it, j) => ({ tenantId: t, productId: it.product.id, name: it.product.name, sku: it.product.sku, unitPrice: unit(it.product), quantity: it.quantity, total: totals.lines[j]!.total })) },
        statusHistory: { create: [{ tenantId: t, toStatus: 'PENDING', note: 'Order created', createdAt }, ...(status !== 'PENDING' ? [{ tenantId: t, fromStatus: 'PENDING' as OrderStatus, toStatus: status, createdAt: new Date(createdAt.getTime() + 3600_000) }] : [])] },
      },
    });
    if (paid) {
      await prisma.payment.create({ data: { tenantId: t, orderId: order.id, amount: totals.total, currency: 'USD', status: PaymentStatus.PAID, method: i % 2 ? 'card' : 'cash_on_delivery', paidAt: createdAt, createdAt } });
    }
    if (['SHIPPED', 'DELIVERED'].includes(status)) {
      await prisma.delivery.create({
        data: { tenantId: t, orderId: order.id, status: status === 'DELIVERED' ? 'DELIVERED' : 'IN_TRANSIT', carrier: 'Demo Express', trackingNumber: `DX${100000 + i}`, recipientName: customer.name, city: customer.city, country: 'United States', fee: 9.99, shippedAt: createdAt, deliveredAt: status === 'DELIVERED' ? new Date(createdAt.getTime() + 2 * 86400_000) : null },
      });
    }
  }
  await prisma.tenantCounter.create({ data: { tenantId: t, key: 'order', value: counter } });
  for (const c of customers) {
    const agg = await prisma.order.aggregate({ where: { customerId: c.id, status: { notIn: ['CANCELLED', 'REFUNDED', 'PENDING'] } }, _sum: { total: true }, _count: { _all: true } });
    await prisma.customer.update({ where: { id: c.id }, data: { totalSpent: agg._sum.total ?? 0, ordersCount: agg._count._all } });
  }

  // Leads & pipeline
  const pipeline = await prisma.pipeline.create({
    data: {
      tenantId: t, name: 'Sales Pipeline', isDefault: true,
      stages: {
        create: [
          ['New Lead', 10, StageType.OPEN, '#64748b'], ['Contacted', 20, StageType.OPEN, '#0ea5e9'], ['Qualified', 40, StageType.OPEN, '#6366f1'],
          ['Proposal', 60, StageType.OPEN, '#f59e0b'], ['Negotiation', 80, StageType.OPEN, '#f97316'], ['Won', 100, StageType.WON, '#10b981'], ['Lost', 0, StageType.LOST, '#ef4444'],
        ].map(([name, probability, type, color], i) => ({ tenantId: t, name: name as string, probability: probability as number, type: type as StageType, color: color as string, position: i })),
      },
    },
    include: { stages: { orderBy: { position: 'asc' } } },
  });
  const leadDefs: Array<[string, string, LeadStatus, number, string]> = [
    ['Northwind Office Supply', 'Bulk order of 50 chargers', 'QUALIFIED', 72, 'whatsapp'],
    ['Riverside Gym', 'Smart watches for trainers', 'PROPOSAL', 65, 'ai_agent'],
    ['Lena Park', 'Asked about headphone colours', 'NEW', 40, 'whatsapp'],
    ['Blue Harbor Hotel', 'Speakers for 20 rooms', 'NEGOTIATION', 81, 'website'],
    ['Carlos Mendes', 'Backpack pre-order', 'CONTACTED', 35, 'whatsapp'],
    ['Studio Nine', 'Earbuds for staff', 'WON', 95, 'referral'],
    ['Greenfield School', 'Chargers for labs', 'LOST', 20, 'website'],
  ];
  for (const [i, [name, note, status, score, source]] of leadDefs.entries()) {
    const lead = await prisma.lead.create({
      data: { tenantId: t, name, company: i % 2 === 0 ? name : null, status, score, source, notes: note, value: 300 + i * 450, assignedUserId: i % 2 ? sales.id : owner.id, tags: ['demo'], isDemo: true, createdAt: daysAgo(20 - i * 2) },
    });
    const stage = pipeline.stages[Math.min(i, pipeline.stages.length - 1)]!;
    await prisma.deal.create({
      data: {
        tenantId: t, pipelineId: pipeline.id, stageId: stage.id, leadId: lead.id, name: `${name} — ${note}`, amount: 300 + i * 450, probability: stage.probability,
        status: stage.type === 'WON' ? DealStatus.WON : stage.type === 'LOST' ? DealStatus.LOST : DealStatus.OPEN, assignedUserId: i % 2 ? sales.id : owner.id,
        priority: i % 3 === 0 ? 'HIGH' : 'MEDIUM', position: 1000, expectedCloseDate: new Date(Date.now() + (i + 1) * 5 * 86400_000), isDemo: true,
      },
    });
  }

  // Knowledge base & AI agent (AI replies need an API key in Settings → AI)
  const kb = await prisma.aIKnowledgeBase.create({ data: { tenantId: t, name: 'Store policies', description: 'Shipping, returns and warranty (demo content)' } });
  const policy = `Shipping: We ship across the United States. Orders placed before 2 PM ship the same day. Free shipping on orders over $150.\n\nReturns: 30-day hassle-free returns for unused items in original packaging. Refunds are issued to the original payment method within 5 business days.\n\nWarranty: All electronics include a 2-year limited warranty covering manufacturing defects.\n\nPayment: We accept card, bank transfer, mobile wallets and cash on delivery in New York City.`;
  const doc = await prisma.aIDocument.create({ data: { tenantId: t, knowledgeBaseId: kb.id, title: 'Shipping, returns & warranty', sourceType: 'TEXT', rawText: policy, status: 'READY', chunkCount: 1, tokenCount: Math.ceil(policy.length / 4), processedAt: new Date() } });
  await prisma.aIDocumentChunk.create({ data: { tenantId: t, documentId: doc.id, knowledgeBaseId: kb.id, index: 0, content: policy, tokenCount: Math.ceil(policy.length / 4) } });
  const agent = await prisma.aIAgent.create({
    data: {
      tenantId: t, name: 'Sales Assistant', description: 'Answers product questions and takes orders.', isDefault: true,
      systemInstructions: 'Greet customers warmly, recommend products that fit their needs and help them place orders.',
      personality: 'Helpful and knowledgeable, never pushy.', tone: 'friendly', salesObjectives: 'Convert interested customers into orders; capture leads for larger purchases.',
      escalationRules: 'Transfer to a human for complaints, refunds, bulk pricing or when asked.', fallbackMessage: 'Thanks for reaching out! A team member will reply shortly.',
      enabledTools: [...AI_TOOL_NAMES], knowledgeBases: { create: [{ knowledgeBaseId: kb.id }] },
    },
  });

  // Demo conversations (internal test channel — nothing is sent to WhatsApp)
  const threads: Array<{ customer: number; status: ConversationStatus; handler: ConversationHandler; msgs: Array<[MessageSenderType, string]>; summary?: string }> = [
    { customer: 0, status: 'OPEN', handler: 'AI', msgs: [['CUSTOMER', 'Hi! Do you have wireless headphones with noise cancelling?'], ['AI', 'Hi Maya! Yes — our Wireless Headphones have active noise cancelling and 30-hour battery life. They are on sale for $109 (regular $129). Would you like them in black or silver?'], ['CUSTOMER', 'Black please. How long is delivery to New York?']] },
    { customer: 1, status: 'OPEN', handler: 'HUMAN', msgs: [['CUSTOMER', 'My speaker arrived but the charging port looks damaged.'], ['SYSTEM', 'Sales Assistant transferred the conversation to a human: Damaged item — needs a replacement decision'], ['AGENT', 'Sorry about that, Omar! Could you send a photo of the port? We will arrange a replacement right away.']], summary: '• Customer received a Bluetooth Speaker with a damaged charging port.\n• Agent asked for a photo.\n• Next step: approve a replacement once the photo arrives.' },
    { customer: 2, status: 'PENDING', handler: 'AI', msgs: [['CUSTOMER', 'Is the premium backpack back in stock?'], ['AI', 'The Premium Backpack is currently out of stock — a restock is expected in about 2 weeks. Would you like me to note your interest so the team can let you know?']] },
    { customer: 3, status: 'RESOLVED', handler: 'AI', msgs: [['CUSTOMER', 'Where is my order ACM-001004?'], ['AI', 'Your order ACM-001004 has been shipped with Demo Express (tracking DX100003). It should arrive within 1–2 days.'], ['CUSTOMER', 'Great, thanks!']], summary: '• Customer asked for order status.\n• AI shared tracking details.\n• Resolved.' },
    { customer: 4, status: 'OPEN', handler: 'AI', msgs: [['CUSTOMER', 'I need 3 fast chargers for my office. Any discount?']] },
  ];
  for (const [i, th] of threads.entries()) {
    const customer = customers[th.customer]!;
    const start = daysAgo(i, 11);
    const conv = await prisma.conversation.create({
      data: {
        tenantId: t, channel: ChannelType.TEST, customerId: customer.id, status: th.status, handler: th.handler, aiAgentId: agent.id,
        assignedUserId: th.handler === 'HUMAN' ? sales.id : null, tags: ['demo'], subject: 'Demo conversation', unreadCount: th.status === 'OPEN' ? 1 : 0,
        lastMessageAt: new Date(start.getTime() + th.msgs.length * 60_000), lastInboundAt: start, lastMessagePreview: th.msgs[th.msgs.length - 1]![1].slice(0, 160),
        firstResponseAt: th.msgs.length > 1 ? new Date(start.getTime() + 60_000) : null, resolvedAt: th.status === 'RESOLVED' ? new Date(start.getTime() + 600_000) : null,
        summary: th.summary, summaryUpdatedAt: th.summary ? new Date() : null, createdAt: start,
        handoffAt: th.handler === 'HUMAN' ? new Date(start.getTime() + 60_000) : null, handoffReason: th.handler === 'HUMAN' ? 'Damaged item — needs a replacement decision' : null,
      },
    });
    for (const [j, [sender, body]] of th.msgs.entries()) {
      await prisma.message.create({
        data: {
          tenantId: t, conversationId: conv.id, body, senderType: sender, direction: sender === 'CUSTOMER' ? MessageDirection.INBOUND : MessageDirection.OUTBOUND,
          type: sender === 'SYSTEM' ? MessageType.SYSTEM : MessageType.TEXT, status: sender === 'CUSTOMER' ? MessageStatus.RECEIVED : MessageStatus.READ,
          senderUserId: sender === 'AGENT' ? sales.id : null, aiAgentId: sender === 'AI' ? agent.id : null, createdAt: new Date(start.getTime() + j * 60_000),
        },
      });
    }
  }

  // Tasks
  await prisma.task.createMany({
    data: [
      { tenantId: t, title: 'Send bulk charger quote to Northwind', priority: 'HIGH', dueDate: new Date(Date.now() + 86400_000), assignedUserId: sales.id, createdById: owner.id },
      { tenantId: t, title: 'Approve replacement speaker for Omar', priority: 'URGENT', dueDate: new Date(), assignedUserId: owner.id, customerId: customers[1]!.id },
      { tenantId: t, title: 'Reorder Premium Backpacks from supplier', priority: 'MEDIUM', dueDate: new Date(Date.now() + 3 * 86400_000), assignedUserId: owner.id },
    ],
  });

  // Workflows
  const wf1 = await prisma.workflow.create({ data: { tenantId: t, name: 'Follow up new leads', description: 'Create a task and notify the team when a new lead arrives.', status: WorkflowStatus.ACTIVE, triggerType: 'lead.created', createdById: owner.id } });
  await prisma.workflowNode.createMany({
    data: [
      { tenantId: t, workflowId: wf1.id, key: 'trigger', type: WorkflowNodeType.TRIGGER, subtype: 'lead.created', positionX: 250, positionY: 40 },
      { tenantId: t, workflowId: wf1.id, key: 'task', type: WorkflowNodeType.ACTION, subtype: 'create_task', config: { title: 'Call new lead {{lead.name}}', dueInDays: 1 }, positionX: 250, positionY: 180 },
      { tenantId: t, workflowId: wf1.id, key: 'notify', type: WorkflowNodeType.ACTION, subtype: 'notify_team', config: { title: 'New lead: {{lead.name}}', body: 'A follow-up task was created.' }, positionX: 250, positionY: 320 },
    ],
  });
  await prisma.workflowEdge.createMany({ data: [{ tenantId: t, workflowId: wf1.id, sourceKey: 'trigger', targetKey: 'task' }, { tenantId: t, workflowId: wf1.id, sourceKey: 'task', targetKey: 'notify' }] });
  const wf2 = await prisma.workflow.create({ data: { tenantId: t, name: 'VIP tag for large orders', description: 'Tag customers who place orders above $250.', status: WorkflowStatus.ACTIVE, triggerType: 'order.created', createdById: owner.id } });
  await prisma.workflowNode.createMany({
    data: [
      { tenantId: t, workflowId: wf2.id, key: 'trigger', type: WorkflowNodeType.TRIGGER, subtype: 'order.created', positionX: 250, positionY: 40 },
      { tenantId: t, workflowId: wf2.id, key: 'amount', type: WorkflowNodeType.CONDITION, subtype: 'order.amount', config: { operator: 'gt', value: 250 }, positionX: 250, positionY: 180 },
      { tenantId: t, workflowId: wf2.id, key: 'tag', type: WorkflowNodeType.ACTION, subtype: 'update_customer', config: { addTags: ['vip'] }, positionX: 100, positionY: 330 },
      { tenantId: t, workflowId: wf2.id, key: 'notify', type: WorkflowNodeType.ACTION, subtype: 'notify_team', config: { title: 'Large order {{order.number}}', body: '{{customer.name}} ordered {{order.total}}' }, positionX: 100, positionY: 470 },
    ],
  });
  await prisma.workflowEdge.createMany({
    data: [
      { tenantId: t, workflowId: wf2.id, sourceKey: 'trigger', targetKey: 'amount' },
      { tenantId: t, workflowId: wf2.id, sourceKey: 'amount', targetKey: 'tag', sourceHandle: 'yes' },
      { tenantId: t, workflowId: wf2.id, sourceKey: 'tag', targetKey: 'notify' },
    ],
  });

  await prisma.notification.createMany({
    data: [
      { tenantId: t, userId: owner.id, type: 'LOW_INVENTORY', title: 'Bluetooth Speaker is running low', body: '4 available', link: '/inventory' },
      { tenantId: t, userId: owner.id, type: 'AI_ESCALATION', title: 'Omar Haddad needs a human', body: 'Damaged item — needs a replacement decision', link: '/inbox' },
      { tenantId: t, userId: owner.id, type: 'NEW_ORDER', title: 'New order ACM-001024', body: 'Maya Chen', link: '/orders' },
    ],
  });

  console.log('✓ Demo workspace "Acme Commerce" created');
  console.log(`  Sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD} (demo only — change or delete in production)`);
}

/** Creating an administrator from the CLI completes installation, locking the web installer. */
async function markInstalled() {
  await prisma.systemSetting.upsert({
    where: { key: 'installed' },
    create: { key: 'installed', value: { at: new Date().toISOString(), via: 'cli' } },
    update: {},
  });
}

async function seedAdmin(email: string, password: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { isSuperAdmin: true } });
    console.log(`✓ ${email} is now a platform administrator`);
    return;
  }
  await prisma.user.create({ data: { email, name: 'Platform Admin', passwordHash: await hash(password), isSuperAdmin: true, emailVerifiedAt: new Date() } });
  console.log(`✓ Platform administrator ${email} created`);
}

async function main() {
  await syncPermissions();
  if (adminIdx >= 0) {
    const email = args[adminIdx + 1];
    const password = args[adminIdx + 2];
    if (!email || !password || password.length < 8) throw new Error('Usage: --admin <email> <password(min 8 chars)>');
    await seedAdmin(email.toLowerCase(), password);
    await markInstalled();
    console.log('✓ Installation marked complete (web installer locked)');
  }
  if (DEMO) await seedDemo();
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
