import { Injectable, Logger } from '@nestjs/common';
import { AIToolStatus, LeadStatus, OrderSource, Prisma, ProductStatus } from '@prisma/client';
import { z, ZodTypeAny } from 'zod';
import { AI_TOOLS, AIToolName, formatMoney } from '@sellora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsService, effectivePrice } from '../commerce/products.service';
import { InventoryService } from '../commerce/inventory.service';
import { OrdersService } from '../commerce/orders.service';
import { PaymentsService } from '../commerce/payments.service';
import { LeadsService } from '../crm/leads.service';
import { CustomersService } from '../crm/customers.service';
import { TasksService } from '../crm/tasks.service';
import { ConversationsService } from '../conversations/conversations.service';
import { TenantsService } from '../tenants/tenants.service';
import { findDeliveryZone } from '../tenants/tenant-settings';
import { aiActor } from '../../common/auth-context';
import type { ToolDefinition } from './ai-provider.service';

export interface ToolContext {
  tenantId: string;
  agentId: string | null;
  agentName: string;
  conversationId: string | null;
  customerId: string | null;
  currency: string;
  enabledTools: string[];
  /** Playground mode: write tools describe what they would do without changing data */
  dryRun: boolean;
  /** Channel the customer is writing on (WHATSAPP, WEB_CHAT, MESSENGER, INSTAGRAM, TEST) */
  channel?: string;
}

export interface ToolOutcome {
  ok: boolean;
  data?: unknown;
  error?: string;
  /** The conversation was handed to a human; the runtime stops replying afterwards */
  handoff?: boolean;
}

interface ToolSpec<S extends ZodTypeAny> {
  name: AIToolName;
  description: string;
  parameters: Record<string, unknown>;
  schema: S;
  writes: boolean;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<ToolOutcome>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra });
const int = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'integer', description, ...extra });

const cartItems = {
  type: 'array',
  description: 'Products and quantities',
  items: obj({ productId: str('Product id from searchProducts'), quantity: int('Quantity', { minimum: 1, maximum: 100 }) }, ['productId', 'quantity']),
  minItems: 1,
  maxItems: 20,
};
const cartSchema = z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(100) })).min(1).max(20);

/**
 * Controlled tools the AI can call. The model never touches the database:
 * every action goes tool → authorization → validation → service layer, and
 * is scoped to the customer of the current conversation.
 */
@Injectable()
export class AIToolsService {
  private readonly logger = new Logger(AIToolsService.name);
  private readonly specs: Map<string, ToolSpec<ZodTypeAny>>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly inventory: InventoryService,
    private readonly orders: OrdersService,
    private readonly leads: LeadsService,
    private readonly customers: CustomersService,
    private readonly tasks: TasksService,
    private readonly conversations: ConversationsService,
    private readonly tenants: TenantsService,
    private readonly payments: PaymentsService,
  ) {
    const specs: ToolSpec<ZodTypeAny>[] = [
      this.searchProducts(),
      this.getProductDetails(),
      this.checkInventory(),
      this.calculateOrderTotal(),
      this.checkDeliveryAvailability(),
      this.getOrderStatus(),
      this.getCustomerHistory(),
      this.createLead(),
      this.updateCustomer(),
      this.createOrder(),
      this.getPaymentOptions(),
      this.requestPayment(),
      this.createTask(),
      this.transferToHuman(),
    ] as ToolSpec<ZodTypeAny>[];
    this.specs = new Map(specs.map((s) => [s.name, s]));
  }

  definitions(enabled: string[]): ToolDefinition[] {
    return [...this.specs.values()]
      .filter((s) => enabled.includes(s.name) || s.name === 'transferToHuman')
      .map((s) => ({ name: s.name, description: s.description, parameters: s.parameters }));
  }

  isWriteTool(name: string) {
    return AI_TOOLS.find((t) => t.name === name)?.writes ?? true;
  }

  /** Executes a tool call with authorization, validation and logging. */
  async execute(name: string, rawArgs: string, ctx: ToolContext): Promise<ToolOutcome> {
    const started = Date.now();
    const spec = this.specs.get(name);
    let input: unknown = {};
    let outcome: ToolOutcome;
    let status: AIToolStatus = AIToolStatus.SUCCESS;
    try {
      input = rawArgs ? JSON.parse(rawArgs) : {};
    } catch {
      input = {};
    }
    if (!spec) {
      outcome = { ok: false, error: `Unknown tool ${name}` };
      status = AIToolStatus.DENIED;
    } else if (!ctx.enabledTools.includes(name) && name !== 'transferToHuman') {
      outcome = { ok: false, error: 'This tool is not enabled for this agent. Offer to connect the customer with the team instead.' };
      status = AIToolStatus.DENIED;
    } else {
      const parsed = spec.schema.safeParse(input);
      if (!parsed.success) {
        outcome = { ok: false, error: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
        status = AIToolStatus.ERROR;
      } else if (ctx.dryRun && spec.writes) {
        outcome = { ok: true, data: { dryRun: true, note: `Test mode: ${name} was not executed. In a live conversation it would run with these arguments.`, arguments: parsed.data } };
        status = AIToolStatus.DRY_RUN;
      } else {
        try {
          outcome = await spec.run(parsed.data, ctx);
          if (!outcome.ok) status = AIToolStatus.ERROR;
        } catch (err) {
          outcome = { ok: false, error: (err as Error).message };
          status = AIToolStatus.ERROR;
        }
      }
    }
    await this.prisma.aIToolExecution
      .create({
        data: {
          tenantId: ctx.tenantId,
          agentId: ctx.agentId,
          conversationId: ctx.conversationId,
          toolName: name,
          input: (input ?? {}) as Prisma.InputJsonValue,
          output: JSON.parse(JSON.stringify(outcome.data ?? { error: outcome.error ?? null })) as Prisma.InputJsonValue,
          status,
          error: outcome.error?.slice(0, 1000),
          durationMs: Date.now() - started,
        },
      })
      .catch((err: Error) => this.logger.warn(`Tool log failed: ${err.message}`));
    return outcome;
  }

  private requireCustomer(ctx: ToolContext): string {
    if (!ctx.customerId) throw new Error('No customer is linked to this conversation.');
    return ctx.customerId;
  }

  // ------------------------------------------------------------------ tools

  private searchProducts(): ToolSpec<ZodTypeAny> {
    const schema = z.object({ query: z.string().trim().min(1).max(100), limit: z.number().int().min(1).max(10).optional() });
    return {
      name: 'searchProducts',
      writes: false,
      description: 'Search the product catalog by name, SKU, category or keyword. Always use this before mentioning any product, price or availability.',
      parameters: obj({ query: str('What the customer is looking for'), limit: int('Max results (1-10)', { minimum: 1, maximum: 10 }) }, ['query']),
      schema,
      run: async (input: z.infer<typeof schema>, ctx) => {
        const items = await this.products.search(ctx.tenantId, input.query, { onlyActive: true, take: input.limit ?? 5 });
        return {
          ok: true,
          data: {
            results: items.map((p) => ({
              productId: p.id,
              name: p.name,
              sku: p.sku,
              price: formatMoney(p.effectivePrice, ctx.currency),
              regularPrice: p.salePrice !== null && Number(p.salePrice) < Number(p.price) ? formatMoney(Number(p.price), ctx.currency) : undefined,
              inStock: !p.trackInventory || (p.available ?? 0) > 0,
              category: p.category?.name,
              summary: p.description?.slice(0, 200),
            })),
            note: items.length ? undefined : 'No matching products. Do not invent products; ask the customer for more details or suggest browsing categories.',
          },
        };
      },
    };
  }

  private getProductDetails(): ToolSpec<ZodTypeAny> {
    const schema = z.object({ productId: z.string().uuid() });
    return {
      name: 'getProductDetails',
      writes: false,
      description: 'Get full details for one product: price, description, attributes, product notes and availability.',
      parameters: obj({ productId: str('Product id from searchProducts') }, ['productId']),
      schema,
      run: async (input: z.infer<typeof schema>, ctx) => {
        const p = await this.prisma.product.findFirst({
          where: { id: input.productId, tenantId: ctx.tenantId, status: ProductStatus.ACTIVE },
          include: { category: { select: { name: true } }, inventory: true },
        });
        if (!p) return { ok: false, error: 'Product not found or not for sale.' };
        const available = p.inventory ? p.inventory.onHand - p.inventory.reserved : 0;
        return {
          ok: true,
          data: {
            productId: p.id,
            name: p.name,
            sku: p.sku,
            price: formatMoney(effectivePrice(p), ctx.currency),
            onSale: p.salePrice !== null && Number(p.salePrice) < Number(p.price),
            description: p.description?.slice(0, 1500),
            category: p.category?.name,
            attributes: p.attributes,
            productNotes: p.aiNotes?.slice(0, 1500),
            availability: !p.trackInventory ? 'available' : available > 0 ? (available <= (p.inventory?.lowStockThreshold ?? 0) ? `only ${available} left` : 'in stock') : 'out of stock',
            image: p.images[0],
          },
        };
      },
    };
  }

  private checkInventory(): ToolSpec<ZodTypeAny> {
    const schema = z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(1000).optional() });
    return {
      name: 'checkInventory',
      writes: false,
      description: 'Check whether a quantity of a product is available right now.',
      parameters: obj({ productId: str('Product id'), quantity: int('Quantity wanted', { minimum: 1 }) }, ['productId']),
      schema,
      run: async (input: z.infer<typeof schema>, ctx) => {
        const p = await this.prisma.product.findFirst({ where: { id: input.productId, tenantId: ctx.tenantId }, select: { name: true, trackInventory: true, status: true } });
        if (!p || p.status !== ProductStatus.ACTIVE) return { ok: false, error: 'Product not found or not for sale.' };
        if (!p.trackInventory) return { ok: true, data: { product: p.name, available: true } };
        const a = await this.inventory.availability(ctx.tenantId, input.productId);
        const wanted = input.quantity ?? 1;
        return { ok: true, data: { product: p.name, availableUnits: Math.max(0, a.available), canFulfil: a.available >= wanted, requested: wanted } };
      },
    };
  }

  private calculateOrderTotal(): ToolSpec<ZodTypeAny> {
    const schema = z.object({ items: cartSchema, city: z.string().max(80).optional(), country: z.string().max(80).optional() });
    return {
      name: 'calculateOrderTotal',
      writes: false,
      description: 'Calculate subtotal, tax, shipping and total for a cart using official prices. Use before quoting any total.',
      parameters: obj({ items: cartItems, city: str('Delivery city, if known'), country: str('Delivery country, if known') }, ['items']),
      schema,
      run: async (input: z.infer<typeof schema>, ctx) => {
        const { lines, totals, deliveryZone } = await this.orders.quote(ctx.tenantId, { items: input.items, city: input.city, country: input.country });
        const m = (v: number) => formatMoney(v, ctx.currency);
        return {
          ok: true,
          data: {
            lines: lines.map((l, i) => ({ product: l.product.name, quantity: l.quantity, unitPrice: m(l.unitPrice), total: m(totals.lines[i]!.total) })),
            subtotal: m(totals.subtotal),
            discount: m(totals.discountTotal),
            tax: m(totals.taxTotal),
            shipping: m(totals.shippingTotal),
            total: m(totals.total),
            deliveryZone: deliveryZone ? { name: deliveryZone.name, etaDays: deliveryZone.etaDays } : null,
          },
        };
      },
    };
  }

  private checkDeliveryAvailability(): ToolSpec<ZodTypeAny> {
    const schema = z.object({ city: z.string().trim().min(1).max(80), country: z.string().trim().max(80).optional() });
    return {
      name: 'checkDeliveryAvailability',
      writes: false,
      description: 'Check if the business delivers to a city, with fee and estimated delivery time.',
      parameters: obj({ city: str('City'), country: str('Country') }, ['city']),
      schema,
      run: async (input: z.infer<typeof schema>, ctx) => {
        const settings = await this.tenants.commerceSettings(ctx.tenantId);
        if (!settings.deliveryZones.length) {
          return { ok: true, data: { configured: false, note: 'Delivery areas are not configured. Tell the customer a team member will confirm delivery details.' } };
        }
        const zone = findDeliveryZone(settings, input.city, input.country);
        return {
          ok: true,
          data: zone
            ? { delivers: true, zone: zone.name, fee: formatMoney(zone.fee, ctx.currency), estimatedDays: zone.etaDays }
            : { delivers: false, note: 'This location is outside the configured delivery areas.' },
        };
      },
    };
  }

  private getOrderStatus(): ToolSpec<ZodTypeAny> {
    const schema = z.object({ orderNumber: z.string().trim().max(40).optional() });
    return {
      name: 'getOrderStatus',
      writes: false,
      description: "Look up the status of this customer's orders. Only the current customer's orders are visible.",
      parameters: obj({ orderNumber: str('Order number if the customer gave one, e.g. ORD-001234') }),
      schema,
      run: async (input: z.infer<typeof schema>, ctx) => {
        const customerId = this.requireCustomer(ctx);
        const orders = await this.orders.customerOrders(ctx.tenantId, customerId, 5);
        const filtered = input.orderNumber ? orders.filter((o) => o.number.toLowerCase() === input.orderNumber!.toLowerCase()) : orders;
        if (!filtered.length) return { ok: true, data: { orders: [], note: input.orderNumber ? 'No order with that number for this customer.' : 'This customer has no orders yet.' } };
        return {
          ok: true,
          data: {
            orders: filtered.map((o) => ({
              number: o.number,
              status: o.status,
              paymentStatus: o.paymentStatus,
              total: formatMoney(Number(o.total), o.currency),
              placed: o.createdAt.toISOString().slice(0, 10),
              items: o.items.map((i) => `${i.quantity} × ${i.name}`),
              delivery: o.deliveries[0] ? { status: o.deliveries[0].status, carrier: o.deliveries[0].carrier, tracking: o.deliveries[0].trackingUrl ?? o.deliveries[0].trackingNumber } : null,
            })),
          },
        };
      },
    };
  }

  private getCustomerHistory(): ToolSpec<ZodTypeAny> {
    const schema = z.object({});
    return {
      name: 'getCustomerHistory',
      writes: false,
      description: 'Read the current customer profile, recent orders and open leads to personalise the conversation.',
      parameters: obj({}),
      schema,
      run: async (_input, ctx) => {
        const customerId = this.requireCustomer(ctx);
        const c = await this.prisma.customer.findFirst({
          where: { id: customerId, tenantId: ctx.tenantId },
          select: { name: true, email: true, city: true, country: true, addressLine: true, tags: true, ordersCount: true, totalSpent: true, createdAt: true },
        });
        if (!c) return { ok: false, error: 'Customer not found' };
        const [orders, leads] = await Promise.all([
          this.orders.customerOrders(ctx.tenantId, customerId, 3),
          this.prisma.lead.findMany({ where: { tenantId: ctx.tenantId, customerId, status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } }, select: { status: true, notes: true }, take: 3 }),
        ]);
        return {
          ok: true,
          data: {
            name: c.name,
            hasEmail: Boolean(c.email),
            city: c.city,
            country: c.country,
            hasAddress: Boolean(c.addressLine),
            tags: c.tags,
            ordersCount: c.ordersCount,
            totalSpent: formatMoney(Number(c.totalSpent), ctx.currency),
            customerSince: c.createdAt.toISOString().slice(0, 10),
            recentOrders: orders.map((o) => ({ number: o.number, status: o.status, total: formatMoney(Number(o.total), o.currency) })),
            openLeads: leads,
          },
        };
      },
    };
  }

  private createLead(): ToolSpec<ZodTypeAny> {
    const schema = z.object({
      interest: z.string().trim().min(2).max(300),
      estimatedValue: z.number().min(0).max(1e9).optional(),
      score: z.number().int().min(0).max(100).optional(),
    });
    return {
      name: 'createLead',
      writes: true,
      description: 'Record this customer as a sales lead when they show buying interest but have not ordered yet. Skips if an open lead exists.',
      parameters: obj(
        { interest: str('What the customer is interested in'), estimatedValue: { type: 'number', description: 'Estimated deal value' }, score: int('Purchase intent 0-100', { minimum: 0, maximum: 100 }) },
        ['interest'],
      ),
      schema,
      run: async (input: z.infer<typeof schema>, ctx) => {
        const customerId = this.requireCustomer(ctx);
        const existing = await this.prisma.lead.findFirst({ where: { tenantId: ctx.tenantId, customerId, status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } } });
        if (existing) {
          await this.prisma.lead.update({
            where: { id: existing.id },
            data: { notes: `${existing.notes ? `${existing.notes}\n` : ''}AI: ${input.interest}`.slice(0, 5000), lastActivityAt: new Date(), score: Math.max(existing.score, input.score ?? 0) },
          });
          return { ok: true, data: { leadId: existing.id, updated: true } };
        }
        const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
        const lead = await this.leads.create(aiActor(ctx.tenantId, ctx.agentName), {
          name: customer.name,
          email: customer.email,
          phone: customer.whatsappNumber ?? customer.phone,
          source: 'ai_agent',
          notes: `AI: ${input.interest}`,
          value: input.estimatedValue ?? null,
          score: input.score ?? 50,
          customerId,
          tags: ['ai'],
        });
        return { ok: true, data: { leadId: lead.id, created: true } };
      },
    };
  }

  private updateCustomer(): ToolSpec<ZodTypeAny> {
    const schema = z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        email: z.string().trim().toLowerCase().email().max(254).optional(),
        addressLine: z.string().trim().max(250).optional(),
        city: z.string().trim().max(80).optional(),
        country: z.string().trim().max(80).optional(),
        postalCode: z.string().trim().max(20).optional(),
      })
      .refine((v) => Object.values(v).some(Boolean), 'Provide at least one field');
    return {
      name: 'updateCustomer',
      writes: true,
      description: 'Save details the customer shared about themselves (name, email, delivery address). Never guess values.',
      parameters: obj({ name: str('Full name'), email: str('Email address'), addressLine: str('Street address'), city: str('City'), country: str('Country'), postalCode: str('Postal code') }),
      schema,
      run: async (input: z.infer<typeof schema>, ctx) => {
        const customerId = this.requireCustomer(ctx);
        const actor = aiActor(ctx.tenantId, ctx.agentName);
        await this.customers.update(actor, customerId, input);
        return { ok: true, data: { saved: Object.keys(input) } };
      },
    };
  }

  private createOrder(): ToolSpec<ZodTypeAny> {
    const schema = z.object({
      items: cartSchema,
      shippingName: z.string().trim().min(2).max(120),
      shippingAddress: z.string().trim().min(5).max(300),
      shippingCity: z.string().trim().min(2).max(80),
      shippingCountry: z.string().trim().max(80).optional(),
      shippingPhone: z.string().trim().max(30).optional(),
      notes: z.string().trim().max(500).optional(),
      customerConfirmed: z.literal(true, { errorMap: () => ({ message: 'The customer must explicitly confirm the order summary first' }) }),
    });
    return {
      name: 'createOrder',
      writes: true,
      description:
        'Place an order ONLY after you showed the customer the items and total from calculateOrderTotal and they explicitly confirmed. Requires delivery name, address and city.',
      parameters: obj(
        {
          items: cartItems,
          shippingName: str('Recipient name'),
          shippingAddress: str('Street address'),
          shippingCity: str('City'),
          shippingCountry: str('Country'),
          shippingPhone: str('Contact phone'),
          notes: str('Delivery notes'),
          customerConfirmed: { type: 'boolean', description: 'true only if the customer explicitly confirmed this exact order' },
        },
        ['items', 'shippingName', 'shippingAddress', 'shippingCity', 'customerConfirmed'],
      ),
      schema,
      run: async (input: z.infer<typeof schema>, ctx) => {
        const customerId = this.requireCustomer(ctx);
        const settings = await this.tenants.commerceSettings(ctx.tenantId);
        if (!settings.aiCanCreateOrders) {
          return { ok: false, error: 'Automatic ordering is disabled for this business. Transfer the customer to a human to complete the order.' };
        }
        const actor = aiActor(ctx.tenantId, ctx.agentName);
        const order = await this.orders.create(
          actor,
          {
            customerId,
            items: input.items,
            shippingName: input.shippingName,
            shippingAddress: input.shippingAddress,
            shippingCity: input.shippingCity,
            shippingCountry: input.shippingCountry,
            shippingPhone: input.shippingPhone,
            notes: input.notes ? `Customer note: ${input.notes}` : 'Placed by AI agent',
            conversationId: ctx.conversationId,
          },
          { source: OrderSource.AI },
        );
        await this.customers.update(actor, customerId, { addressLine: input.shippingAddress, city: input.shippingCity, ...(input.shippingCountry ? { country: input.shippingCountry } : {}) }).catch(() => undefined);
        return {
          ok: true,
          data: { orderNumber: order.number, status: order.status, total: formatMoney(Number(order.total), order.currency), items: order.items.map((i) => `${i.quantity} × ${i.name}`) },
        };
      },
    };
  }

  /** The customer's unpaid order, matched by number or the most recent one. */
  private async unpaidOrder(ctx: ToolContext, orderNumber?: string) {
    const customerId = this.requireCustomer(ctx);
    const orders = await this.prisma.order.findMany({
      where: { tenantId: ctx.tenantId, customerId, status: { notIn: ['CANCELLED', 'REFUNDED'] }, ...(orderNumber ? { number: { equals: orderNumber, mode: 'insensitive' } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return orders.find((o) => Number(o.total) - Number(o.amountPaid) > 0.005);
  }

  private getPaymentOptions(): ToolSpec<ZodTypeAny> {
    const schema = z.object({ orderNumber: z.string().trim().max(40).optional() });
    return {
      name: 'getPaymentOptions',
      writes: false,
      description: "List how the current customer can pay for an unpaid order (online payment link or manual methods) and the amount due. Only the customer's own orders are visible.",
      parameters: obj({ orderNumber: str('Order number; defaults to the latest unpaid order') }),
      schema,
      run: async (input: z.infer<typeof schema>, ctx) => {
        const order = await this.unpaidOrder(ctx, input.orderNumber);
        if (!order) return { ok: true, data: { note: 'No unpaid order found for this customer.' } };
        const methods = (await this.payments.methods(ctx.tenantId, { orderId: order.id })).filter((m) => m.id && m.offered);
        return {
          ok: true,
          data: {
            orderNumber: order.number,
            amountDue: formatMoney(Number(order.total) - Number(order.amountPaid), order.currency),
            methods: methods.map((m) => ({ method: m.label, type: m.online ? 'online payment link' : 'manual (customer follows instructions)' })),
            note: methods.length ? undefined : 'No payment methods are set up for this order. Offer to connect the customer with the team.',
          },
        };
      },
    };
  }

  private requestPayment(): ToolSpec<ZodTypeAny> {
    const schema = z.object({ method: z.string().trim().min(1).max(60), orderNumber: z.string().trim().max(40).optional() });
    return {
      name: 'requestPayment',
      writes: true,
      description:
        'After the customer chose a payment method from getPaymentOptions, create the payment link or payment instructions for the unpaid order. Share the returned text with the customer exactly as given.',
      parameters: obj({ method: str('Method name exactly as listed by getPaymentOptions'), orderNumber: str('Order number; defaults to the latest unpaid order') }, ['method']),
      schema,
      run: async (input: z.infer<typeof schema>, ctx) => {
        const order = await this.unpaidOrder(ctx, input.orderNumber);
        if (!order) return { ok: false, error: 'No unpaid order found for this customer.' };
        const wanted = input.method.toLowerCase();
        const methods = await this.payments.methods(ctx.tenantId, { orderId: order.id });
        const method = methods.find((m) => m.id && m.offered && (m.label.toLowerCase() === wanted || m.key === wanted));
        if (!method?.id) return { ok: false, error: 'That payment method is not available for this order. Call getPaymentOptions and offer one of the listed methods.' };
        try {
          const result = await this.payments.requestPayment(aiActor(ctx.tenantId, ctx.agentName), { orderId: order.id, methodId: method.id, sendToCustomer: false });
          return { ok: true, data: { orderNumber: order.number, method: method.label, paymentLink: result.url ?? undefined, messageToShare: result.message } };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : 'Could not create the payment request. Offer to connect the customer with the team.' };
        }
      },
    };
  }

  private createTask(): ToolSpec<ZodTypeAny> {
    const schema = z.object({ title: z.string().trim().min(3).max(200), description: z.string().trim().max(2000).optional(), dueInHours: z.number().int().min(1).max(720).optional() });
    return {
      name: 'createTask',
      writes: true,
      description: 'Create a follow-up task for the team (e.g. call back, send a quote, check a special request).',
      parameters: obj({ title: str('Short task title'), description: str('Details'), dueInHours: int('Due in N hours', { minimum: 1, maximum: 720 }) }, ['title']),
      schema,
      run: async (input: z.infer<typeof schema>, ctx) => {
        const task = await this.tasks.create(aiActor(ctx.tenantId, ctx.agentName), {
          title: input.title,
          description: input.description ?? null,
          dueDate: input.dueInHours ? new Date(Date.now() + input.dueInHours * 3600_000) : null,
          customerId: ctx.customerId,
          conversationId: ctx.conversationId,
        });
        return { ok: true, data: { taskId: task.id, created: true } };
      },
    };
  }

  private transferToHuman(): ToolSpec<ZodTypeAny> {
    const schema = z.object({ reason: z.string().trim().min(3).max(300) });
    return {
      name: 'transferToHuman',
      writes: true,
      description:
        'Hand the conversation to a human agent when you cannot help confidently, the customer asks for a person, is upset, or the request needs a human decision (refunds, complaints, custom pricing).',
      parameters: obj({ reason: str('Why a human is needed') }, ['reason']),
      schema,
      run: async (input: z.infer<typeof schema>, ctx) => {
        if (ctx.conversationId) await this.conversations.handoffToHuman(ctx.tenantId, ctx.conversationId, input.reason, ctx.agentName);
        return { ok: true, data: { transferred: true }, handoff: true };
      },
    };
  }
}
