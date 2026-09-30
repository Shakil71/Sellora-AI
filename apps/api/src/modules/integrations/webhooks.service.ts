import { Injectable, Logger } from '@nestjs/common';
import { NotificationType, Prisma, WebhookDeliveryStatus } from '@prisma/client';
import { z } from 'zod';
import { WEBHOOK_EVENTS } from '@sellora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { QueueService } from '../../queue/queue.module';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  decryptSecret,
  encryptSecret,
  hmacSha256Hex,
  randomToken,
} from '../../common/utils/crypto.util';
import { ensureFound, ValidationError } from '../../common/errors';
import { env } from '../../config/env';
import { assertPublicUrl } from '../ai/text-extraction';
import type { Actor } from '../../common/auth-context';

const EVENT_KEYS = WEBHOOK_EVENTS.map((e) => e.key as string);
const AUTO_DISABLE_AFTER = 20;

const urlSchema = z
  .string()
  .trim()
  .url('Enter a full URL such as https://example.com/webhooks/sellora')
  .max(500)
  .refine((u) => /^https?:\/\//i.test(u), 'Webhook URLs must start with https://')
  .refine(
    (u) => env.WEBHOOKS_ALLOW_PRIVATE || /^https:\/\//i.test(u),
    'Webhook URLs must use HTTPS',
  );

const eventsSchema = z
  .array(z.string())
  .min(1, 'Choose at least one event')
  .refine((list) => list.every((e) => e === '*' || EVENT_KEYS.includes(e)), 'Unknown event')
  .transform((list) => (list.includes('*') ? ['*'] : [...new Set(list)]));

export const endpointSchema = z.object({
  url: urlSchema,
  description: z.string().trim().max(200).optional().nullable(),
  events: eventsSchema,
  isActive: z.boolean().optional(),
});
export const endpointUpdateSchema = endpointSchema.partial();

export const deliveryListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(WebhookDeliveryStatus).optional(),
});

/**
 * Outgoing webhooks: business events are delivered to the workspace's own
 * HTTPS endpoints, signed with HMAC-SHA256 and retried with backoff.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly queues: QueueService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private cacheKey(tenantId: string) {
    return `webhooks:active:${tenantId}`;
  }

  private async invalidate(tenantId: string) {
    await this.redis.del(this.cacheKey(tenantId));
  }

  /** Cheap check used on every domain event. */
  async hasActiveEndpoints(tenantId: string): Promise<boolean> {
    const count = await this.redis.remember(this.cacheKey(tenantId), 60, () =>
      this.prisma.webhookEndpoint.count({ where: { tenantId, isActive: true } }),
    );
    return Number(count) > 0;
  }

  private present(e: {
    id: string;
    url: string;
    description: string | null;
    events: string[];
    isActive: boolean;
    lastStatus: number | null;
    lastError: string | null;
    lastDeliveryAt: Date | null;
    consecutiveFailures: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const {
      id,
      url,
      description,
      events,
      isActive,
      lastStatus,
      lastError,
      lastDeliveryAt,
      consecutiveFailures,
      createdAt,
      updatedAt,
    } = e;
    return {
      id,
      url,
      description,
      events,
      isActive,
      lastStatus,
      lastError,
      lastDeliveryAt,
      consecutiveFailures,
      createdAt,
      updatedAt,
    };
  }

  private async assertReachable(url: string) {
    if (env.WEBHOOKS_ALLOW_PRIVATE) return;
    try {
      await assertPublicUrl(url);
    } catch (err) {
      throw new ValidationError(`This URL cannot receive webhooks: ${(err as Error).message}`);
    }
  }

  async list(tenantId: string) {
    const rows = await this.prisma.webhookEndpoint.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.present(r));
  }

  async get(tenantId: string, id: string) {
    return this.present(
      ensureFound(
        await this.prisma.webhookEndpoint.findFirst({ where: { id, tenantId } }),
        'Webhook',
      ),
    );
  }

  async create(actor: Actor, input: z.infer<typeof endpointSchema>) {
    await this.assertReachable(input.url);
    if ((await this.prisma.webhookEndpoint.count({ where: { tenantId: actor.tenantId } })) >= 20)
      throw new ValidationError('A workspace can have up to 20 webhook endpoints.');
    const secret = `whsec_${randomToken(24)}`;
    const row = await this.prisma.webhookEndpoint.create({
      data: {
        tenantId: actor.tenantId,
        url: input.url,
        description: input.description ?? null,
        events: input.events,
        isActive: input.isActive ?? true,
        secretEnc: encryptSecret(secret),
      },
    });
    await this.invalidate(actor.tenantId);
    await this.audit.log(actor, {
      action: 'integrations.webhook_created',
      entityType: 'WebhookEndpoint',
      entityId: row.id,
      metadata: { url: row.url, events: row.events },
    });
    return { ...this.present(row), secret };
  }

  async update(actor: Actor, id: string, input: z.infer<typeof endpointUpdateSchema>) {
    ensureFound(
      await this.prisma.webhookEndpoint.findFirst({ where: { id, tenantId: actor.tenantId } }),
      'Webhook',
    );
    if (input.url) await this.assertReachable(input.url);
    const row = await this.prisma.webhookEndpoint.update({
      where: { id },
      data: {
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.events !== undefined ? { events: input.events } : {}),
        ...(input.isActive !== undefined
          ? { isActive: input.isActive, ...(input.isActive ? { consecutiveFailures: 0 } : {}) }
          : {}),
      },
    });
    await this.invalidate(actor.tenantId);
    await this.audit.log(actor, {
      action: 'integrations.webhook_updated',
      entityType: 'WebhookEndpoint',
      entityId: id,
      metadata: { fields: Object.keys(input) },
    });
    return this.present(row);
  }

  async remove(actor: Actor, id: string) {
    const row = ensureFound(
      await this.prisma.webhookEndpoint.findFirst({ where: { id, tenantId: actor.tenantId } }),
      'Webhook',
    );
    await this.prisma.webhookEndpoint.delete({ where: { id } });
    await this.invalidate(actor.tenantId);
    await this.audit.log(actor, {
      action: 'integrations.webhook_deleted',
      entityType: 'WebhookEndpoint',
      entityId: id,
      metadata: { url: row.url },
    });
    return { removed: true };
  }

  async revealSecret(actor: Actor, id: string) {
    const row = ensureFound(
      await this.prisma.webhookEndpoint.findFirst({ where: { id, tenantId: actor.tenantId } }),
      'Webhook',
    );
    await this.audit.log(actor, {
      action: 'integrations.webhook_secret_viewed',
      entityType: 'WebhookEndpoint',
      entityId: id,
    });
    return { secret: decryptSecret(row.secretEnc) };
  }

  async rollSecret(actor: Actor, id: string) {
    ensureFound(
      await this.prisma.webhookEndpoint.findFirst({ where: { id, tenantId: actor.tenantId } }),
      'Webhook',
    );
    const secret = `whsec_${randomToken(24)}`;
    await this.prisma.webhookEndpoint.update({
      where: { id },
      data: { secretEnc: encryptSecret(secret) },
    });
    await this.audit.log(actor, {
      action: 'integrations.webhook_secret_rolled',
      entityType: 'WebhookEndpoint',
      entityId: id,
    });
    return { secret };
  }

  async sendTest(actor: Actor, id: string) {
    const endpoint = ensureFound(
      await this.prisma.webhookEndpoint.findFirst({ where: { id, tenantId: actor.tenantId } }),
      'Webhook',
    );
    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        tenantId: actor.tenantId,
        endpointId: endpoint.id,
        event: 'webhook.test',
        payload: {
          message: 'This is a test event from Sellora AI.',
          sentBy: actor.name ?? null,
        } as Prisma.InputJsonValue,
      },
    });
    await this.queues.deliverWebhook(delivery.id, 1);
    return { deliveryId: delivery.id };
  }

  async deliveries(tenantId: string, endpointId: string, q: z.infer<typeof deliveryListSchema>) {
    ensureFound(
      await this.prisma.webhookEndpoint.findFirst({ where: { id: endpointId, tenantId } }),
      'Webhook',
    );
    const where: Prisma.WebhookDeliveryWhereInput = {
      tenantId,
      endpointId,
      ...(q.status ? { status: q.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.webhookDelivery.count({ where }),
    ]);
    return {
      items,
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      },
    };
  }

  async redeliver(actor: Actor, deliveryId: string) {
    const d = ensureFound(
      await this.prisma.webhookDelivery.findFirst({
        where: { id: deliveryId, tenantId: actor.tenantId },
      }),
      'Delivery',
    );
    await this.prisma.webhookDelivery.update({
      where: { id: d.id },
      data: { status: WebhookDeliveryStatus.PENDING, error: null },
    });
    await this.queues.deliverWebhook(d.id, 1);
    return { queued: true };
  }

  /** Worker: creates one delivery per subscribed endpoint. */
  async fanout(tenantId: string, event: string, data: Record<string, unknown>) {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: [{ events: { has: event } }, { events: { has: '*' } }],
      },
      select: { id: true },
    });
    if (!endpoints.length) return { deliveries: 0 };
    const enriched = await this.enrich(tenantId, event, data);
    for (const e of endpoints) {
      const delivery = await this.prisma.webhookDelivery.create({
        data: { tenantId, endpointId: e.id, event, payload: enriched as Prisma.InputJsonValue },
      });
      await this.queues.deliverWebhook(delivery.id);
    }
    return { deliveries: endpoints.length };
  }

  /** Adds human-friendly details so receivers rarely need a follow-up API call. */
  private async enrich(tenantId: string, event: string, data: Record<string, unknown>) {
    const out: Record<string, unknown> = { ...data };
    const customerId = typeof data.customerId === 'string' ? data.customerId : undefined;
    if (customerId) {
      out.customer = await this.prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          whatsappNumber: true,
          city: true,
          country: true,
        },
      });
    }
    if (event.startsWith('order.') && typeof data.orderId === 'string') {
      const order = await this.prisma.order.findFirst({
        where: { id: data.orderId, tenantId },
        select: {
          id: true,
          number: true,
          status: true,
          paymentStatus: true,
          source: true,
          currency: true,
          subtotal: true,
          discountTotal: true,
          taxTotal: true,
          shippingTotal: true,
          total: true,
          amountPaid: true,
          notes: true,
          shippingName: true,
          shippingPhone: true,
          shippingAddress: true,
          shippingCity: true,
          shippingCountry: true,
          placedAt: true,
          items: {
            select: {
              productId: true,
              name: true,
              sku: true,
              quantity: true,
              unitPrice: true,
              total: true,
            },
          },
        },
      });
      if (order) out.order = order;
    }
    if (event === 'lead.created' && typeof data.leadId === 'string') {
      out.lead = await this.prisma.lead.findFirst({
        where: { id: data.leadId, tenantId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          company: true,
          source: true,
          status: true,
          value: true,
          createdAt: true,
        },
      });
    }
    if (event === 'inventory.low' && typeof data.productId === 'string') {
      out.product = await this.prisma.product.findFirst({
        where: { id: data.productId, tenantId },
        select: { id: true, name: true, sku: true },
      });
    }
    return JSON.parse(JSON.stringify(out)) as Record<string, unknown>; // Decimals and dates become JSON values
  }

  /** Signs `${timestamp}.${body}` so receivers can verify origin and freshness. */
  static sign(secret: string, timestamp: number, body: string) {
    return `t=${timestamp},v1=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
  }

  /** Worker: one HTTP attempt. Throws to let the queue retry with backoff. */
  async deliver(deliveryId: string, finalAttempt: boolean) {
    const d = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: true },
    });
    if (!d || d.status === WebhookDeliveryStatus.SUCCEEDED) return;
    const endpoint = d.endpoint;
    if (!endpoint.isActive && d.event !== 'webhook.test') {
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: { status: WebhookDeliveryStatus.FAILED, error: 'Endpoint is disabled' },
      });
      return;
    }
    const body = JSON.stringify({
      id: d.id,
      event: d.event,
      createdAt: d.createdAt.toISOString(),
      workspaceId: d.tenantId,
      data: d.payload,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const started = Date.now();
    let status: number | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;
    try {
      if (!env.WEBHOOKS_ALLOW_PRIVATE) await assertPublicUrl(endpoint.url);
      const res = await fetch(endpoint.url, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Sellora-Webhooks/1.0',
          'X-Sellora-Event': d.event,
          'X-Sellora-Delivery': d.id,
          'X-Sellora-Timestamp': String(timestamp),
          'X-Sellora-Signature': WebhooksService.sign(
            decryptSecret(endpoint.secretEnc),
            timestamp,
            body,
          ),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      responseBody = (await res.text().catch(() => '')).slice(0, 1000) || null;
      if (res.status < 200 || res.status >= 300)
        error = `Endpoint responded with HTTP ${res.status}`;
    } catch (err) {
      error =
        (err as Error).name === 'TimeoutError'
          ? 'Timed out after 10 seconds'
          : (err as Error).message.slice(0, 500);
    }
    const durationMs = Date.now() - started;

    if (!error) {
      await this.prisma.$transaction([
        this.prisma.webhookDelivery.update({
          where: { id: d.id },
          data: {
            status: WebhookDeliveryStatus.SUCCEEDED,
            attempts: { increment: 1 },
            responseStatus: status,
            responseBody,
            error: null,
            durationMs,
            deliveredAt: new Date(),
          },
        }),
        this.prisma.webhookEndpoint.update({
          where: { id: endpoint.id },
          data: {
            lastStatus: status,
            lastError: null,
            lastDeliveryAt: new Date(),
            consecutiveFailures: 0,
          },
        }),
      ]);
      return;
    }

    await this.prisma.webhookDelivery.update({
      where: { id: d.id },
      data: {
        status: finalAttempt ? WebhookDeliveryStatus.FAILED : WebhookDeliveryStatus.PENDING,
        attempts: { increment: 1 },
        responseStatus: status,
        responseBody,
        error,
        durationMs,
      },
    });
    if (finalAttempt) {
      const updated = await this.prisma.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: {
          lastStatus: status,
          lastError: error,
          lastDeliveryAt: new Date(),
          consecutiveFailures: { increment: 1 },
        },
      });
      if (updated.isActive && updated.consecutiveFailures >= AUTO_DISABLE_AFTER) {
        await this.prisma.webhookEndpoint.update({
          where: { id: endpoint.id },
          data: { isActive: false },
        });
        await this.invalidate(d.tenantId);
        await this.notifications.notify(
          d.tenantId,
          { permission: 'integrations.manage' },
          {
            type: NotificationType.SYSTEM,
            title: 'Webhook endpoint disabled',
            body: `${endpoint.url} failed ${AUTO_DISABLE_AFTER} deliveries in a row and was switched off. Fix it and turn it back on in Integrations → Webhooks.`,
            link: '/integrations/webhooks',
          },
        );
      }
      return;
    }
    throw new Error(error);
  }
}
