import { Injectable } from '@nestjs/common';
import { ConversationHandler, MessageSenderType, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { InventoryService } from '../commerce/inventory.service';

export type Range = '7d' | '30d' | '90d' | '12m';
const EXCLUDED: OrderStatus[] = ['CANCELLED', 'REFUNDED'];

function rangeBounds(range: Range) {
  const now = new Date();
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 365;
  const from = new Date(now.getTime() - days * 86400_000);
  const prevFrom = new Date(from.getTime() - days * 86400_000);
  return { from, to: now, prevFrom, days, bucket: range === '12m' ? 'month' : 'day' };
}

const pct = (current: number, previous: number) => (previous === 0 ? (current > 0 ? 100 : 0) : Math.round(((current - previous) / previous) * 1000) / 10);

interface SeriesRow {
  bucket: Date;
  value: number | bigint | Prisma.Decimal | null;
}

function fillSeries(rows: Array<{ bucket: Date; [k: string]: unknown }>, from: Date, days: number, bucket: string, keys: string[]) {
  const map = new Map(rows.map((r) => [r.bucket.toISOString().slice(0, bucket === 'month' ? 7 : 10), r]));
  const out: Array<Record<string, number | string>> = [];
  if (bucket === 'month') {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    for (let i = 0; i < 12; i++) {
      const key = d.toISOString().slice(0, 7);
      const row = map.get(key);
      out.push({ date: key, ...Object.fromEntries(keys.map((k) => [k, Number(row?.[k] ?? 0)])) });
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return out;
  }
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    const row = map.get(key);
    out.push({ date: key, ...Object.fromEntries(keys.map((k) => [k, Number(row?.[k] ?? 0)])) });
  }
  return out;
}

/**
 * All analytics are computed from live data (never fabricated). Results are
 * cached for a short time per workspace to keep dashboards fast.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly inventory: InventoryService,
  ) {}

  private cached<T>(tenantId: string, key: string, loader: () => Promise<T>) {
    return this.redis.remember(`analytics:${tenantId}:${key}`, 60, loader);
  }

  async dashboard(tenantId: string) {
    return this.cached(tenantId, 'dashboard', async () => {
      const { from, prevFrom } = rangeBounds('30d');
      const orderWhere = (gte: Date, lt?: Date): Prisma.OrderWhereInput => ({ tenantId, status: { notIn: EXCLUDED }, createdAt: { gte, ...(lt ? { lt } : {}) } });
      const [cur, prev, leads, prevLeads, customers, prevCustomers, convs, prevConvs, aiConvs, convWithOrders, pending, totalCustomers] = await Promise.all([
        this.prisma.order.aggregate({ where: orderWhere(from), _sum: { total: true }, _count: { _all: true } }),
        this.prisma.order.aggregate({ where: orderWhere(prevFrom, from), _sum: { total: true }, _count: { _all: true } }),
        this.prisma.lead.count({ where: { tenantId, createdAt: { gte: from } } }),
        this.prisma.lead.count({ where: { tenantId, createdAt: { gte: prevFrom, lt: from } } }),
        this.prisma.customer.count({ where: { tenantId, createdAt: { gte: from } } }),
        this.prisma.customer.count({ where: { tenantId, createdAt: { gte: prevFrom, lt: from } } }),
        this.prisma.conversation.count({ where: { tenantId, createdAt: { gte: from } } }),
        this.prisma.conversation.count({ where: { tenantId, createdAt: { gte: prevFrom, lt: from } } }),
        this.prisma.conversation.count({ where: { tenantId, createdAt: { gte: from }, aiAgentId: { not: null } } }),
        this.prisma.conversation.count({ where: { tenantId, createdAt: { gte: from }, orders: { some: {} } } }),
        this.prisma.order.count({ where: { tenantId, status: OrderStatus.PENDING } }),
        this.prisma.customer.count({ where: { tenantId } }),
      ]);
      const revenue = Number(cur._sum.total ?? 0);
      const prevRevenue = Number(prev._sum.total ?? 0);
      const orders = cur._count._all;
      const [series, convSeries, recentOrders, recentConversations, recentLeads, lowStock] = await Promise.all([
        this.prisma.$queryRaw<Array<{ bucket: Date; revenue: Prisma.Decimal; orders: bigint }>>`
          SELECT date_trunc('day', "createdAt") AS bucket, SUM(total) AS revenue, COUNT(*) AS orders
          FROM "Order" WHERE "tenantId" = ${tenantId}::uuid AND "createdAt" >= ${from} AND status NOT IN ('CANCELLED','REFUNDED')
          GROUP BY 1 ORDER BY 1`,
        this.prisma.$queryRaw<Array<{ bucket: Date; ai: bigint; human: bigint }>>`
          SELECT date_trunc('day', "createdAt") AS bucket,
            COUNT(*) FILTER (WHERE "aiAgentId" IS NOT NULL) AS ai,
            COUNT(*) FILTER (WHERE "aiAgentId" IS NULL) AS human
          FROM "Conversation" WHERE "tenantId" = ${tenantId}::uuid AND "createdAt" >= ${from}
          GROUP BY 1 ORDER BY 1`,
        this.prisma.order.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
          take: 6,
          select: { id: true, number: true, status: true, paymentStatus: true, total: true, currency: true, createdAt: true, source: true, customer: { select: { id: true, name: true } } },
        }),
        this.prisma.conversation.findMany({
          where: { tenantId },
          orderBy: { lastMessageAt: 'desc' },
          take: 6,
          select: { id: true, status: true, handler: true, lastMessageAt: true, lastMessagePreview: true, unreadCount: true, channel: true, customer: { select: { id: true, name: true } } },
        }),
        this.prisma.lead.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
          take: 6,
          select: { id: true, name: true, status: true, source: true, score: true, createdAt: true },
        }),
        this.inventory.lowStockProducts(tenantId, 6),
      ]);
      return {
        kpis: {
          revenue: { value: revenue, change: pct(revenue, prevRevenue) },
          orders: { value: orders, change: pct(orders, prev._count._all) },
          averageOrderValue: { value: orders ? revenue / orders : 0, change: pct(orders ? revenue / orders : 0, prev._count._all ? prevRevenue / prev._count._all : 0) },
          leads: { value: leads, change: pct(leads, prevLeads) },
          newCustomers: { value: customers, change: pct(customers, prevCustomers) },
          totalCustomers: { value: totalCustomers },
          conversations: { value: convs, change: pct(convs, prevConvs) },
          aiConversations: { value: aiConvs, share: convs ? Math.round((aiConvs / convs) * 100) : 0 },
          conversionRate: { value: convs ? Math.round((convWithOrders / convs) * 1000) / 10 : 0 },
          pendingOrders: { value: pending },
          lowStock: { value: lowStock.length },
        },
        charts: {
          sales: fillSeries(series, from, 30, 'day', ['revenue', 'orders']),
          conversations: fillSeries(convSeries, from, 30, 'day', ['ai', 'human']),
        },
        recentOrders,
        recentConversations,
        recentLeads,
        lowStock,
      };
    });
  }

  async sales(tenantId: string, range: Range) {
    return this.cached(tenantId, `sales:${range}`, async () => {
      const { from, prevFrom, days, bucket } = rangeBounds(range);
      const where: Prisma.OrderWhereInput = { tenantId, status: { notIn: EXCLUDED }, createdAt: { gte: from } };
      const [agg, prev, byStatus, bySource, byPayment, series, topProducts] = await Promise.all([
        this.prisma.order.aggregate({ where, _sum: { total: true }, _count: { _all: true } }),
        this.prisma.order.aggregate({ where: { tenantId, status: { notIn: EXCLUDED }, createdAt: { gte: prevFrom, lt: from } }, _sum: { total: true }, _count: { _all: true } }),
        this.prisma.order.groupBy({ by: ['status'], where: { tenantId, createdAt: { gte: from } }, _count: { _all: true }, _sum: { total: true } }),
        this.prisma.order.groupBy({ by: ['source'], where, _count: { _all: true }, _sum: { total: true } }),
        this.prisma.order.groupBy({ by: ['paymentStatus'], where, _count: { _all: true }, _sum: { total: true } }),
        bucket === 'month'
          ? this.prisma.$queryRaw<Array<{ bucket: Date; revenue: Prisma.Decimal; orders: bigint }>>`
              SELECT date_trunc('month', "createdAt") AS bucket, SUM(total) AS revenue, COUNT(*) AS orders FROM "Order"
              WHERE "tenantId" = ${tenantId}::uuid AND "createdAt" >= ${from} AND status NOT IN ('CANCELLED','REFUNDED') GROUP BY 1 ORDER BY 1`
          : this.prisma.$queryRaw<Array<{ bucket: Date; revenue: Prisma.Decimal; orders: bigint }>>`
              SELECT date_trunc('day', "createdAt") AS bucket, SUM(total) AS revenue, COUNT(*) AS orders FROM "Order"
              WHERE "tenantId" = ${tenantId}::uuid AND "createdAt" >= ${from} AND status NOT IN ('CANCELLED','REFUNDED') GROUP BY 1 ORDER BY 1`,
        this.prisma.$queryRaw<Array<{ productId: string | null; name: string; units: bigint; revenue: Prisma.Decimal }>>`
          SELECT i."productId", MAX(i.name) AS name, SUM(i.quantity) AS units, SUM(i.total) AS revenue
          FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId"
          WHERE o."tenantId" = ${tenantId}::uuid AND o."createdAt" >= ${from} AND o.status NOT IN ('CANCELLED','REFUNDED')
          GROUP BY i."productId" ORDER BY revenue DESC LIMIT 8`,
      ]);
      const revenue = Number(agg._sum.total ?? 0);
      const orders = agg._count._all;
      const prevRevenue = Number(prev._sum.total ?? 0);
      return {
        range,
        summary: {
          revenue,
          revenueChange: pct(revenue, prevRevenue),
          orders,
          ordersChange: pct(orders, prev._count._all),
          averageOrderValue: orders ? revenue / orders : 0,
          paidRevenue: Number(byPayment.find((p) => p.paymentStatus === 'PAID')?._sum.total ?? 0),
        },
        series: fillSeries(series, from, days, bucket, ['revenue', 'orders']),
        byStatus: byStatus.map((s) => ({ status: s.status, orders: s._count._all, revenue: Number(s._sum.total ?? 0) })),
        bySource: bySource.map((s) => ({ source: s.source, orders: s._count._all, revenue: Number(s._sum.total ?? 0) })),
        byPaymentStatus: byPayment.map((s) => ({ status: s.paymentStatus, orders: s._count._all, revenue: Number(s._sum.total ?? 0) })),
        topProducts: topProducts.map((p) => ({ productId: p.productId, name: p.name, units: Number(p.units), revenue: Number(p.revenue) })),
      };
    });
  }

  async crm(tenantId: string, range: Range) {
    return this.cached(tenantId, `crm:${range}`, async () => {
      const { from, days, bucket } = rangeBounds(range);
      const [byStatus, bySource, total, won, lost, pipeline, dealOutcomes, series] = await Promise.all([
        this.prisma.lead.groupBy({ by: ['status'], where: { tenantId, createdAt: { gte: from } }, _count: { _all: true } }),
        this.prisma.lead.groupBy({ by: ['source'], where: { tenantId, createdAt: { gte: from } }, _count: { _all: true } }),
        this.prisma.lead.count({ where: { tenantId, createdAt: { gte: from } } }),
        this.prisma.lead.count({ where: { tenantId, createdAt: { gte: from }, status: 'WON' } }),
        this.prisma.lead.count({ where: { tenantId, createdAt: { gte: from }, status: 'LOST' } }),
        this.prisma.$queryRaw<Array<{ stage: string; color: string | null; position: number; deals: bigint; amount: Prisma.Decimal | null; weighted: Prisma.Decimal | null }>>`
          SELECT s.name AS stage, s.color, s.position, COUNT(d.id) AS deals, SUM(d.amount) AS amount, SUM(d.amount * d.probability / 100.0) AS weighted
          FROM "PipelineStage" s
          JOIN "Pipeline" p ON p.id = s."pipelineId" AND p."isDefault" = true
          LEFT JOIN "Deal" d ON d."stageId" = s.id AND d.status = 'OPEN'
          WHERE s."tenantId" = ${tenantId}::uuid
          GROUP BY s.id ORDER BY s.position`,
        this.prisma.deal.groupBy({ by: ['status'], where: { tenantId, OR: [{ closedAt: { gte: from } }, { status: 'OPEN' }] }, _count: { _all: true }, _sum: { amount: true } }),
        bucket === 'month'
          ? this.prisma.$queryRaw<Array<{ bucket: Date; leads: bigint; won: bigint }>>`
              SELECT date_trunc('month', "createdAt") AS bucket, COUNT(*) AS leads, COUNT(*) FILTER (WHERE status = 'WON') AS won
              FROM "Lead" WHERE "tenantId" = ${tenantId}::uuid AND "createdAt" >= ${from} GROUP BY 1 ORDER BY 1`
          : this.prisma.$queryRaw<Array<{ bucket: Date; leads: bigint; won: bigint }>>`
              SELECT date_trunc('day', "createdAt") AS bucket, COUNT(*) AS leads, COUNT(*) FILTER (WHERE status = 'WON') AS won
              FROM "Lead" WHERE "tenantId" = ${tenantId}::uuid AND "createdAt" >= ${from} GROUP BY 1 ORDER BY 1`,
      ]);
      return {
        range,
        summary: {
          leads: total,
          won,
          lost,
          conversionRate: total ? Math.round((won / total) * 1000) / 10 : 0,
          pipelineValue: pipeline.reduce((s, p) => s + Number(p.amount ?? 0), 0),
          weightedPipeline: pipeline.reduce((s, p) => s + Number(p.weighted ?? 0), 0),
        },
        series: fillSeries(series, from, days, bucket, ['leads', 'won']),
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
        bySource: bySource.map((s) => ({ source: s.source ?? 'unknown', count: s._count._all })),
        pipeline: pipeline.map((p) => ({ stage: p.stage, color: p.color, deals: Number(p.deals), amount: Number(p.amount ?? 0) })),
        deals: dealOutcomes.map((d) => ({ status: d.status, count: d._count._all, amount: Number(d._sum.amount ?? 0) })),
      };
    });
  }

  async conversations(tenantId: string, range: Range) {
    return this.cached(tenantId, `conversations:${range}`, async () => {
      const { from, days, bucket } = rangeBounds(range);
      const [total, ai, byStatus, timing, series, handoffs] = await Promise.all([
        this.prisma.conversation.count({ where: { tenantId, createdAt: { gte: from } } }),
        this.prisma.conversation.count({ where: { tenantId, createdAt: { gte: from }, aiAgentId: { not: null } } }),
        this.prisma.conversation.groupBy({ by: ['status'], where: { tenantId, createdAt: { gte: from } }, _count: { _all: true } }),
        this.prisma.$queryRaw<Array<{ first_response: number | null; resolution: number | null }>>`
          SELECT AVG(EXTRACT(EPOCH FROM ("firstResponseAt" - "createdAt"))) AS first_response,
                 AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt"))) AS resolution
          FROM "Conversation" WHERE "tenantId" = ${tenantId}::uuid AND "createdAt" >= ${from}`,
        bucket === 'month'
          ? this.prisma.$queryRaw<Array<{ bucket: Date; inbound: bigint; outbound: bigint }>>`
              SELECT date_trunc('month', "createdAt") AS bucket, COUNT(*) FILTER (WHERE direction = 'INBOUND') AS inbound,
                COUNT(*) FILTER (WHERE direction = 'OUTBOUND' AND type <> 'NOTE' AND "senderType" <> 'SYSTEM') AS outbound
              FROM "Message" WHERE "tenantId" = ${tenantId}::uuid AND "createdAt" >= ${from} GROUP BY 1 ORDER BY 1`
          : this.prisma.$queryRaw<Array<{ bucket: Date; inbound: bigint; outbound: bigint }>>`
              SELECT date_trunc('day', "createdAt") AS bucket, COUNT(*) FILTER (WHERE direction = 'INBOUND') AS inbound,
                COUNT(*) FILTER (WHERE direction = 'OUTBOUND' AND type <> 'NOTE' AND "senderType" <> 'SYSTEM') AS outbound
              FROM "Message" WHERE "tenantId" = ${tenantId}::uuid AND "createdAt" >= ${from} GROUP BY 1 ORDER BY 1`,
        this.prisma.conversation.count({ where: { tenantId, handoffAt: { gte: from } } }),
      ]);
      return {
        range,
        summary: {
          total,
          ai,
          human: total - ai,
          handoffs,
          avgFirstResponseSeconds: timing[0]?.first_response ? Math.round(Number(timing[0].first_response)) : null,
          avgResolutionSeconds: timing[0]?.resolution ? Math.round(Number(timing[0].resolution)) : null,
        },
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
        series: fillSeries(series, from, days, bucket, ['inbound', 'outbound']),
      };
    });
  }

  async ai(tenantId: string, range: Range) {
    return this.cached(tenantId, `ai:${range}`, async () => {
      const { from, days, bucket } = rangeBounds(range);
      const [aiConversations, aiMessages, escalations, resolvedByAi, tools, usage, series] = await Promise.all([
        this.prisma.conversation.count({ where: { tenantId, createdAt: { gte: from }, aiAgentId: { not: null } } }),
        this.prisma.message.count({ where: { tenantId, createdAt: { gte: from }, senderType: MessageSenderType.AI } }),
        this.prisma.aIToolExecution.count({ where: { tenantId, createdAt: { gte: from }, toolName: 'transferToHuman' } }),
        this.prisma.conversation.count({ where: { tenantId, resolvedAt: { gte: from }, aiAgentId: { not: null }, handoffAt: null, handler: ConversationHandler.AI } }),
        this.prisma.aIToolExecution.groupBy({ by: ['toolName'], where: { tenantId, createdAt: { gte: from } }, _count: { _all: true } }),
        this.prisma.aIUsageLog.aggregate({ where: { tenantId, createdAt: { gte: from } }, _sum: { totalTokens: true, estimatedCost: true } }),
        bucket === 'month'
          ? this.prisma.$queryRaw<Array<{ bucket: Date; messages: bigint }>>`
              SELECT date_trunc('month', "createdAt") AS bucket, COUNT(*) AS messages FROM "Message"
              WHERE "tenantId" = ${tenantId}::uuid AND "createdAt" >= ${from} AND "senderType" = 'AI' GROUP BY 1 ORDER BY 1`
          : this.prisma.$queryRaw<Array<{ bucket: Date; messages: bigint }>>`
              SELECT date_trunc('day', "createdAt") AS bucket, COUNT(*) AS messages FROM "Message"
              WHERE "tenantId" = ${tenantId}::uuid AND "createdAt" >= ${from} AND "senderType" = 'AI' GROUP BY 1 ORDER BY 1`,
      ]);
      const ordersByAi = await this.prisma.order.aggregate({ where: { tenantId, source: 'AI', createdAt: { gte: from }, status: { notIn: EXCLUDED } }, _count: { _all: true }, _sum: { total: true } });
      return {
        range,
        summary: {
          aiConversations,
          aiMessages,
          escalations,
          resolvedByAi,
          escalationRate: aiConversations ? Math.round((escalations / aiConversations) * 1000) / 10 : 0,
          toolCalls: tools.reduce((s, t) => s + t._count._all, 0),
          tokens: usage._sum.totalTokens ?? 0,
          estimatedCost: Number(usage._sum.estimatedCost ?? 0),
          aiOrders: ordersByAi._count._all,
          aiRevenue: Number(ordersByAi._sum.total ?? 0),
        },
        tools: tools.map((t) => ({ tool: t.toolName, count: t._count._all })).sort((a, b) => b.count - a.count),
        series: fillSeries(series, from, days, bucket, ['messages']),
      };
    });
  }
}

export type { SeriesRow };
