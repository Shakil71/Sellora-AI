import { Injectable } from '@nestjs/common';
import { InventoryMovementType, NotificationType, Prisma, StockStatus } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppException, ensureFound, ValidationError } from '../../common/errors';
import { paginate, toPaginated } from '../../common/pagination';
import type { Actor } from '../../common/auth-context';

type Tx = Prisma.TransactionClient;

export interface StockLine {
  productId: string;
  quantity: number;
  name?: string;
}

export interface StockAlert {
  tenantId: string;
  productId: string;
  productName: string;
  available: number;
  status: StockStatus;
}

export const adjustSchema = z.object({
  mode: z.enum(['add', 'remove', 'set']),
  quantity: z.number().int().min(0).max(10_000_000),
  reason: z.string().trim().max(200).optional(),
  lowStockThreshold: z.number().int().min(0).max(1_000_000).optional(),
});

export const inventoryListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  status: z.nativeEnum(StockStatus).optional(),
});

export function computeStockStatus(onHand: number, reserved: number, threshold: number): StockStatus {
  const available = onHand - reserved;
  if (available <= 0) return StockStatus.OUT_OF_STOCK;
  if (available <= threshold) return StockStatus.LOW_STOCK;
  return StockStatus.IN_STOCK;
}

export class InsufficientStockError extends AppException {
  constructor(items: Array<{ name: string; available: number; requested: number }>) {
    super(
      'INSUFFICIENT_STOCK',
      `Not enough stock for ${items.map((i) => `${i.name} (available ${Math.max(0, i.available)}, requested ${i.requested})`).join(', ')}`,
      409,
      { items },
    );
  }
}

/**
 * Stock management. All quantity changes are atomic SQL updates guarded by
 * availability checks, and each change is recorded as an InventoryMovement.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(tenantId: string, q: z.infer<typeof inventoryListSchema>) {
    const where: Prisma.InventoryWhereInput = {
      tenantId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? { product: { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { sku: { contains: q.search, mode: 'insensitive' } }] } }
        : {}),
    };
    const [items, total, counts] = await Promise.all([
      this.prisma.inventory.findMany({
        where,
        include: { product: { select: { id: true, name: true, sku: true, images: true, status: true, price: true } } },
        orderBy: [{ status: 'desc' }, { updatedAt: 'desc' }],
        ...paginate(q),
      }),
      this.prisma.inventory.count({ where }),
      this.prisma.inventory.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
    ]);
    return {
      ...toPaginated(items.map((i) => ({ ...i, available: i.onHand - i.reserved })), total, q),
      statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    };
  }

  async movements(tenantId: string, q: { page: number; pageSize: number; productId?: string; type?: InventoryMovementType }) {
    const where: Prisma.InventoryMovementWhereInput = {
      tenantId,
      ...(q.productId ? { productId: q.productId } : {}),
      ...(q.type ? { type: q.type } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        include: { product: { select: { id: true, name: true, sku: true } } },
        orderBy: { createdAt: 'desc' },
        ...paginate(q),
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);
    return toPaginated(items, total, q);
  }

  /** Creates the inventory row for a product (initial stock recorded as a movement). */
  async initialize(tx: Tx, tenantId: string, productId: string, onHand: number, threshold: number, actor?: Actor) {
    const status = computeStockStatus(onHand, 0, threshold);
    await tx.inventory.create({ data: { tenantId, productId, onHand, reserved: 0, lowStockThreshold: threshold, status } });
    if (onHand > 0) {
      await tx.inventoryMovement.create({
        data: {
          tenantId,
          productId,
          type: InventoryMovementType.INITIAL,
          quantity: onHand,
          onHandAfter: onHand,
          reservedAfter: 0,
          reason: 'Initial stock',
          actorId: actor?.userId,
          actorName: actor?.name,
        },
      });
    }
  }

  private async ensureRow(tx: Tx, tenantId: string, productId: string) {
    const existing = await tx.inventory.findUnique({ where: { productId } });
    if (existing) {
      if (existing.tenantId !== tenantId) throw new ValidationError('Product not found');
      return existing;
    }
    return tx.inventory.create({ data: { tenantId, productId, status: StockStatus.OUT_OF_STOCK } });
  }

  private async afterChange(
    tx: Tx,
    tenantId: string,
    productId: string,
    type: InventoryMovementType,
    quantity: number,
    meta: { reason?: string; reference?: string; actor?: Partial<Actor> },
    alerts: StockAlert[],
  ) {
    const row = await tx.inventory.findUniqueOrThrow({ where: { productId }, include: { product: { select: { name: true } } } });
    const status = computeStockStatus(row.onHand, row.reserved, row.lowStockThreshold);
    if (status !== row.status) await tx.inventory.update({ where: { productId }, data: { status } });
    if (status !== StockStatus.IN_STOCK && status !== row.status) {
      alerts.push({ tenantId, productId, productName: row.product.name, available: row.onHand - row.reserved, status });
    }
    await tx.inventoryMovement.create({
      data: {
        tenantId,
        productId,
        type,
        quantity,
        onHandAfter: row.onHand,
        reservedAfter: row.reserved,
        reason: meta.reason,
        reference: meta.reference,
        actorId: meta.actor?.userId ?? undefined,
        actorName: meta.actor?.name ?? undefined,
      },
    });
  }

  /** Sends low/out-of-stock notifications and automation events (call after commit). */
  async dispatchAlerts(alerts: StockAlert[]) {
    for (const a of alerts) {
      await this.notifications.notify(a.tenantId, { permission: 'inventory.update' }, {
        type: NotificationType.LOW_INVENTORY,
        title: a.status === StockStatus.OUT_OF_STOCK ? `${a.productName} is out of stock` : `${a.productName} is running low`,
        body: `${Math.max(0, a.available)} available`,
        link: `/inventory?search=${encodeURIComponent(a.productName)}`,
      });
      await this.events.emit(a.tenantId, 'inventory.low', { productId: a.productId, available: a.available, status: a.status });
    }
  }

  /** Reserves stock for an order. Throws InsufficientStockError unless backorders are allowed. */
  async reserve(tx: Tx, tenantId: string, lines: StockLine[], reference: string, allowBackorders: boolean, alerts: StockAlert[], actor?: Partial<Actor>) {
    const shortages: Array<{ name: string; available: number; requested: number }> = [];
    for (const line of lines) {
      const row = await this.ensureRow(tx, tenantId, line.productId);
      const updated = allowBackorders
        ? await tx.$executeRaw`UPDATE "Inventory" SET reserved = reserved + ${line.quantity}, "updatedAt" = NOW() WHERE "productId" = ${line.productId}::uuid AND "tenantId" = ${tenantId}::uuid`
        : await tx.$executeRaw`UPDATE "Inventory" SET reserved = reserved + ${line.quantity}, "updatedAt" = NOW() WHERE "productId" = ${line.productId}::uuid AND "tenantId" = ${tenantId}::uuid AND ("onHand" - reserved) >= ${line.quantity}`;
      if (updated === 0) {
        shortages.push({ name: line.name ?? 'product', available: row.onHand - row.reserved, requested: line.quantity });
        continue;
      }
      await this.afterChange(tx, tenantId, line.productId, InventoryMovementType.RESERVATION, line.quantity, { reference, reason: 'Reserved for order', actor }, alerts);
    }
    if (shortages.length) throw new InsufficientStockError(shortages);
  }

  async release(tx: Tx, tenantId: string, lines: StockLine[], reference: string, alerts: StockAlert[], actor?: Partial<Actor>) {
    for (const line of lines) {
      await tx.$executeRaw`UPDATE "Inventory" SET reserved = GREATEST(0, reserved - ${line.quantity}), "updatedAt" = NOW() WHERE "productId" = ${line.productId}::uuid AND "tenantId" = ${tenantId}::uuid`;
      await this.afterChange(tx, tenantId, line.productId, InventoryMovementType.RELEASE, -line.quantity, { reference, reason: 'Reservation released', actor }, alerts);
    }
  }

  /** Converts a reservation into a sale (stock leaves the warehouse). */
  async commit(tx: Tx, tenantId: string, lines: StockLine[], reference: string, alerts: StockAlert[], actor?: Partial<Actor>) {
    for (const line of lines) {
      await tx.$executeRaw`UPDATE "Inventory" SET "onHand" = "onHand" - ${line.quantity}, reserved = GREATEST(0, reserved - ${line.quantity}), "updatedAt" = NOW() WHERE "productId" = ${line.productId}::uuid AND "tenantId" = ${tenantId}::uuid`;
      await this.afterChange(tx, tenantId, line.productId, InventoryMovementType.SALE, -line.quantity, { reference, reason: 'Order fulfilled', actor }, alerts);
    }
  }

  /** Deducts stock immediately (inventory mode "deduct"). */
  async deduct(tx: Tx, tenantId: string, lines: StockLine[], reference: string, allowBackorders: boolean, alerts: StockAlert[], actor?: Partial<Actor>) {
    const shortages: Array<{ name: string; available: number; requested: number }> = [];
    for (const line of lines) {
      const row = await this.ensureRow(tx, tenantId, line.productId);
      const updated = allowBackorders
        ? await tx.$executeRaw`UPDATE "Inventory" SET "onHand" = "onHand" - ${line.quantity}, "updatedAt" = NOW() WHERE "productId" = ${line.productId}::uuid AND "tenantId" = ${tenantId}::uuid`
        : await tx.$executeRaw`UPDATE "Inventory" SET "onHand" = "onHand" - ${line.quantity}, "updatedAt" = NOW() WHERE "productId" = ${line.productId}::uuid AND "tenantId" = ${tenantId}::uuid AND ("onHand" - reserved) >= ${line.quantity}`;
      if (updated === 0) {
        shortages.push({ name: line.name ?? 'product', available: row.onHand - row.reserved, requested: line.quantity });
        continue;
      }
      await this.afterChange(tx, tenantId, line.productId, InventoryMovementType.SALE, -line.quantity, { reference, reason: 'Order placed', actor }, alerts);
    }
    if (shortages.length) throw new InsufficientStockError(shortages);
  }

  /** Puts stock back (cancelled after shipment, refunds with restock). */
  async restock(tx: Tx, tenantId: string, lines: StockLine[], reference: string, alerts: StockAlert[], actor?: Partial<Actor>) {
    for (const line of lines) {
      await tx.$executeRaw`UPDATE "Inventory" SET "onHand" = "onHand" + ${line.quantity}, "updatedAt" = NOW() WHERE "productId" = ${line.productId}::uuid AND "tenantId" = ${tenantId}::uuid`;
      await this.afterChange(tx, tenantId, line.productId, InventoryMovementType.RETURN, line.quantity, { reference, reason: 'Returned to stock', actor }, alerts);
    }
  }

  /** Manual stock adjustment from the Inventory screen. */
  async adjust(actor: Actor, productId: string, input: z.infer<typeof adjustSchema>) {
    const product = ensureFound(await this.prisma.product.findFirst({ where: { id: productId, tenantId: actor.tenantId } }), 'Product');
    const alerts: StockAlert[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      const row = await this.ensureRow(tx, actor.tenantId, productId);
      const delta = input.mode === 'add' ? input.quantity : input.mode === 'remove' ? -input.quantity : input.quantity - row.onHand;
      if (row.onHand + delta < 0) throw new ValidationError(`Cannot remove more than the ${row.onHand} units on hand.`);
      await tx.inventory.update({
        where: { productId },
        data: {
          onHand: { increment: delta },
          ...(input.lowStockThreshold !== undefined ? { lowStockThreshold: input.lowStockThreshold } : {}),
        },
      });
      if (delta !== 0 || input.lowStockThreshold !== undefined) {
        await this.afterChange(
          tx,
          actor.tenantId,
          productId,
          input.mode === 'add' ? InventoryMovementType.PURCHASE : InventoryMovementType.ADJUSTMENT,
          delta,
          { reason: input.reason ?? (input.mode === 'set' ? 'Stock count' : undefined), actor },
          alerts,
        );
      }
      return tx.inventory.findUniqueOrThrow({ where: { productId } });
    });
    await this.dispatchAlerts(alerts);
    await this.audit.log(actor, {
      action: 'inventory.adjusted',
      entityType: 'Product',
      entityId: productId,
      metadata: { product: product.name, mode: input.mode, quantity: input.quantity, onHand: result.onHand },
    });
    return { ...result, available: result.onHand - result.reserved };
  }

  async availability(tenantId: string, productId: string) {
    const row = await this.prisma.inventory.findFirst({ where: { productId, tenantId } });
    if (!row) return { onHand: 0, reserved: 0, available: 0, status: StockStatus.OUT_OF_STOCK, lowStockThreshold: 0 };
    return { onHand: row.onHand, reserved: row.reserved, available: row.onHand - row.reserved, status: row.status, lowStockThreshold: row.lowStockThreshold };
  }

  /** Periodic scan so alerts also fire for thresholds edited in bulk (worker). */
  async lowStockProducts(tenantId: string, take = 10) {
    const rows = await this.prisma.inventory.findMany({
      where: { tenantId, status: { in: [StockStatus.LOW_STOCK, StockStatus.OUT_OF_STOCK] }, product: { status: 'ACTIVE', trackInventory: true } },
      include: { product: { select: { id: true, name: true, sku: true, images: true } } },
      orderBy: { updatedAt: 'desc' },
      take,
    });
    return rows.map((r) => ({ ...r, available: r.onHand - r.reserved }));
  }
}
