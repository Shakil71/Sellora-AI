import { Injectable } from '@nestjs/common';
import { CategoryStatus, Prisma, ProductStatus, StockStatus } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UsageService } from '../billing/usage.service';
import { InventoryService } from './inventory.service';
import { paginate, sortBy, toPaginated } from '../../common/pagination';
import { ConflictError, ensureFound, ValidationError } from '../../common/errors';
import { slugify } from '../../common/utils/text.util';
import type { Actor } from '../../common/auth-context';

const money = z.number().min(0).max(1e10);

export const productSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    sku: z
      .string()
      .trim()
      .min(1, 'SKU is required')
      .max(64)
      .regex(/^[A-Za-z0-9._\-/]+$/, 'SKU can contain letters, numbers, dot, dash, underscore and slash'),
    description: z.string().trim().max(10000).nullable().optional(),
    price: money,
    salePrice: money.nullable().optional(),
    cost: money.nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    images: z.array(z.string().url().max(500)).max(10).optional(),
    status: z.nativeEnum(ProductStatus).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
    aiNotes: z.string().trim().max(5000).nullable().optional(),
    attributes: z.record(z.string().max(60), z.string().max(300)).nullable().optional(),
    trackInventory: z.boolean().optional(),
    initialStock: z.number().int().min(0).max(10_000_000).optional(),
    lowStockThreshold: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((v) => v.salePrice === undefined || v.salePrice === null || v.salePrice <= v.price, {
    message: 'Sale price must be lower than the regular price',
    path: ['salePrice'],
  });
export type ProductInput = z.infer<typeof productSchema>;

export const productUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  sku: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._\-/]+$/).optional(),
  description: z.string().trim().max(10000).nullable().optional(),
  price: money.optional(),
  salePrice: money.nullable().optional(),
  cost: money.nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  images: z.array(z.string().url().max(500)).max(10).optional(),
  status: z.nativeEnum(ProductStatus).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  aiNotes: z.string().trim().max(5000).nullable().optional(),
  attributes: z.record(z.string().max(60), z.string().max(300)).nullable().optional(),
  trackInventory: z.boolean().optional(),
});

export const productListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  categoryId: z.string().uuid().optional(),
  status: z.nativeEnum(ProductStatus).optional(),
  stockStatus: z.nativeEnum(StockStatus).optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).nullable().optional(),
  imageUrl: z.string().url().max(500).nullable().optional(),
  status: z.nativeEnum(CategoryStatus).optional(),
  position: z.number().int().min(0).max(10000).optional(),
});

const productInclude = {
  category: { select: { id: true, name: true } },
  inventory: { select: { onHand: true, reserved: true, lowStockThreshold: true, status: true } },
} satisfies Prisma.ProductInclude;

type ProductWithInventory = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

export function effectivePrice(p: { price: Prisma.Decimal | number; salePrice: Prisma.Decimal | number | null }): number {
  const price = Number(p.price);
  const sale = p.salePrice === null ? null : Number(p.salePrice);
  return sale !== null && sale >= 0 && sale < price ? sale : price;
}

function withAvailability(p: ProductWithInventory) {
  return {
    ...p,
    effectivePrice: effectivePrice(p),
    available: p.inventory ? p.inventory.onHand - p.inventory.reserved : null,
  };
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly usage: UsageService,
    private readonly inventory: InventoryService,
  ) {}

  async list(tenantId: string, q: z.infer<typeof productListSchema>) {
    const where: Prisma.ProductWhereInput = {
      tenantId,
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.stockStatus ? { inventory: { status: q.stockStatus } } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { sku: { contains: q.search, mode: 'insensitive' } },
              { tags: { has: q.search.toLowerCase() } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: sortBy(q.sort, ['name', 'createdAt', 'price', 'sku', 'updatedAt'] as const, 'createdAt', q.order),
        ...paginate(q),
      }),
      this.prisma.product.count({ where }),
    ]);
    return toPaginated(items.map(withAvailability), total, q);
  }

  async get(tenantId: string, id: string) {
    const product = ensureFound(await this.prisma.product.findFirst({ where: { id, tenantId }, include: productInclude }), 'Product');
    const [recentMovements, salesAgg] = await Promise.all([
      this.prisma.inventoryMovement.findMany({ where: { tenantId, productId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.orderItem.aggregate({
        where: { tenantId, productId: id, order: { status: { notIn: ['CANCELLED', 'REFUNDED'] } } },
        _sum: { quantity: true, total: true },
      }),
    ]);
    return {
      ...withAvailability(product),
      recentMovements,
      sales: { units: salesAgg._sum.quantity ?? 0, revenue: Number(salesAgg._sum.total ?? 0) },
    };
  }

  private async assertCategory(tenantId: string, categoryId?: string | null) {
    if (!categoryId) return;
    ensureFound(await this.prisma.category.findFirst({ where: { id: categoryId, tenantId } }), 'Category');
  }

  async create(actor: Actor, input: ProductInput) {
    await this.usage.assertWithin(actor.tenantId, 'products');
    await this.assertCategory(actor.tenantId, input.categoryId);
    const dup = await this.prisma.product.findFirst({ where: { tenantId: actor.tenantId, sku: input.sku } });
    if (dup) throw new ConflictError(`SKU ${input.sku} is already used by "${dup.name}".`);
    const { initialStock, lowStockThreshold, ...data } = input;
    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          ...data,
          attributes: data.attributes ?? undefined,
          images: data.images ?? [],
          tags: (data.tags ?? []).map((t) => t.toLowerCase()),
          tenantId: actor.tenantId,
        },
      });
      await this.inventory.initialize(tx, actor.tenantId, created.id, initialStock ?? 0, lowStockThreshold ?? 5, actor);
      return created;
    });
    await this.audit.log(actor, { action: 'product.created', entityType: 'Product', entityId: product.id, metadata: { name: product.name, sku: product.sku } });
    return this.get(actor.tenantId, product.id);
  }

  async update(actor: Actor, id: string, input: z.infer<typeof productUpdateSchema>) {
    const current = ensureFound(await this.prisma.product.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Product');
    await this.assertCategory(actor.tenantId, input.categoryId);
    if (input.sku && input.sku !== current.sku) {
      const dup = await this.prisma.product.findFirst({ where: { tenantId: actor.tenantId, sku: input.sku, id: { not: id } } });
      if (dup) throw new ConflictError(`SKU ${input.sku} is already used by "${dup.name}".`);
    }
    const price = input.price ?? Number(current.price);
    const sale = input.salePrice === undefined ? (current.salePrice === null ? null : Number(current.salePrice)) : input.salePrice;
    if (sale !== null && sale > price) throw new ValidationError('Sale price must be lower than the regular price');
    await this.prisma.product.update({
      where: { id },
      data: {
        ...input,
        attributes: input.attributes === null ? Prisma.JsonNull : input.attributes,
        ...(input.tags ? { tags: input.tags.map((t) => t.toLowerCase()) } : {}),
      },
    });
    const changes: Record<string, unknown> = { fields: Object.keys(input) };
    if (input.price !== undefined && input.price !== Number(current.price)) changes.price = { from: Number(current.price), to: input.price };
    await this.audit.log(actor, { action: 'product.updated', entityType: 'Product', entityId: id, metadata: changes });
    return this.get(actor.tenantId, id);
  }

  async remove(actor: Actor, id: string) {
    const product = ensureFound(await this.prisma.product.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Product');
    const openOrders = await this.prisma.orderItem.count({
      where: { productId: id, order: { status: { in: ['PENDING', 'CONFIRMED', 'PROCESSING', 'PACKED'] } } },
    });
    if (openOrders) throw new ValidationError('This product is part of open orders. Archive it instead.');
    await this.prisma.product.delete({ where: { id } });
    await this.audit.log(actor, { action: 'product.deleted', entityType: 'Product', entityId: id, metadata: { name: product.name, sku: product.sku } });
    return { deleted: true };
  }

  /** Fast lookup used by pickers, AI tools and global search. */
  async search(tenantId: string, term: string, opts: { onlyActive?: boolean; take?: number } = {}) {
    const words = term.trim().split(/\s+/).filter((w) => w.length > 1).slice(0, 5);
    const where: Prisma.ProductWhereInput = {
      tenantId,
      ...(opts.onlyActive ? { status: ProductStatus.ACTIVE } : {}),
      ...(term.trim()
        ? {
            OR: [
              { name: { contains: term.trim(), mode: 'insensitive' } },
              { sku: { equals: term.trim(), mode: 'insensitive' } },
              ...words.map((w) => ({ name: { contains: w, mode: 'insensitive' as const } })),
              ...words.map((w) => ({ tags: { has: w.toLowerCase() } })),
              { category: { name: { contains: term.trim(), mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const items = await this.prisma.product.findMany({ where, include: productInclude, take: opts.take ?? 10, orderBy: { name: 'asc' } });
    return items.map(withAvailability);
  }

  // ------------------------------------------------------------- categories

  async listCategories(tenantId: string) {
    const categories = await this.prisma.category.findMany({
      where: { tenantId },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true } } },
    });
    return categories.map(({ _count, ...c }) => ({ ...c, productCount: _count.products }));
  }

  private async uniqueCategorySlug(tenantId: string, name: string, excludeId?: string) {
    const base = slugify(name);
    let slug = base;
    for (let i = 2; i < 100; i++) {
      const exists = await this.prisma.category.findFirst({ where: { tenantId, slug, ...(excludeId ? { id: { not: excludeId } } : {}) } });
      if (!exists) return slug;
      slug = `${base}-${i}`;
    }
    return `${base}-${Date.now()}`;
  }

  async createCategory(actor: Actor, input: z.infer<typeof categorySchema>) {
    const category = await this.prisma.category.create({
      data: { ...input, tenantId: actor.tenantId, slug: await this.uniqueCategorySlug(actor.tenantId, input.name) },
    });
    await this.audit.log(actor, { action: 'category.created', entityType: 'Category', entityId: category.id, metadata: { name: category.name } });
    return category;
  }

  async updateCategory(actor: Actor, id: string, input: Partial<z.infer<typeof categorySchema>>) {
    ensureFound(await this.prisma.category.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Category');
    const category = await this.prisma.category.update({
      where: { id },
      data: { ...input, ...(input.name ? { slug: await this.uniqueCategorySlug(actor.tenantId, input.name, id) } : {}) },
    });
    await this.audit.log(actor, { action: 'category.updated', entityType: 'Category', entityId: id });
    return category;
  }

  async removeCategory(actor: Actor, id: string) {
    const category = ensureFound(await this.prisma.category.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Category');
    await this.prisma.category.delete({ where: { id } });
    await this.audit.log(actor, { action: 'category.deleted', entityType: 'Category', entityId: id, metadata: { name: category.name } });
    return { deleted: true };
  }
}
