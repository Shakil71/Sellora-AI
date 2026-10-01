import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { InventoryMovementType } from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';
import { Auth, CurrentActor, RawResponse, RequirePermissions, TenantId } from '../../common/decorators';
import type { Actor, AuthContext } from '../../common/auth-context';
import { zBody, ZodPipe } from '../../common/zod.pipe';
import { categorySchema, productListSchema, productSchema, ProductsService, productUpdateSchema } from './products.service';
import { adjustSchema, inventoryListSchema, InventoryService } from './inventory.service';
import { createOrderSchema, orderListSchema, OrdersService, orderStatusSchema, updateOrderSchema } from './orders.service';
import { methodsQuerySchema, paymentListSchema, PaymentsService, paymentStatusSchema, recordPaymentSchema, refundSchema, requestPaymentSchema } from './payments.service';
import { invoiceListSchema, InvoicesService } from './invoices.service';
import { deliveryListSchema, DeliveriesService, deliverySchema, deliveryUpdateSchema } from './deliveries.service';
import { AppException } from '../../common/errors';

const uuid = new ParseUUIDPipe();

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions('products.view')
  list(@TenantId() tenantId: string, @Query(new ZodPipe(productListSchema)) q: z.infer<typeof productListSchema>) {
    return this.products.list(tenantId, q);
  }

  @Get('search')
  @RequirePermissions('products.view')
  search(@TenantId() tenantId: string, @Query('q') q = '', @Query('active') active?: string) {
    return this.products.search(tenantId, String(q).slice(0, 100), { onlyActive: active === 'true', take: 15 });
  }

  @Get(':id')
  @RequirePermissions('products.view')
  get(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.products.get(tenantId, id);
  }

  @Post()
  @RequirePermissions('products.create')
  create(@CurrentActor() actor: Actor, @Body(zBody(productSchema)) body: z.infer<typeof productSchema>) {
    return this.products.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('products.update')
  update(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(productUpdateSchema)) body: z.infer<typeof productUpdateSchema>) {
    return this.products.update(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions('products.delete')
  remove(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.products.remove(actor, id);
  }
}

@Controller('categories')
export class CategoriesController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions('products.view')
  list(@TenantId() tenantId: string) {
    return this.products.listCategories(tenantId);
  }

  @Post()
  @RequirePermissions('products.create')
  create(@CurrentActor() actor: Actor, @Body(zBody(categorySchema)) body: z.infer<typeof categorySchema>) {
    return this.products.createCategory(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('products.update')
  update(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(categorySchema.partial())) body: Partial<z.infer<typeof categorySchema>>) {
    return this.products.updateCategory(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions('products.delete')
  remove(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.products.removeCategory(actor, id);
  }
}

const movementsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  productId: z.string().uuid().optional(),
  type: z.nativeEnum(InventoryMovementType).optional(),
});

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @RequirePermissions('inventory.view')
  list(@TenantId() tenantId: string, @Query(new ZodPipe(inventoryListSchema)) q: z.infer<typeof inventoryListSchema>) {
    return this.inventory.list(tenantId, q);
  }

  @Get('movements')
  @RequirePermissions('inventory.view')
  movements(@TenantId() tenantId: string, @Query(new ZodPipe(movementsQuery)) q: z.infer<typeof movementsQuery>) {
    return this.inventory.movements(tenantId, q);
  }

  @Post(':productId/adjust')
  @RequirePermissions('inventory.update')
  adjust(@CurrentActor() actor: Actor, @Param('productId', uuid) productId: string, @Body(zBody(adjustSchema)) body: z.infer<typeof adjustSchema>) {
    return this.inventory.adjust(actor, productId, body);
  }
}

const quoteSchema = z.object({
  items: createOrderSchema.shape.items,
  discount: z.number().min(0).optional(),
  shipping: z.number().min(0).optional(),
  city: z.string().max(80).nullable().optional(),
  country: z.string().max(80).nullable().optional(),
});

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermissions('orders.view')
  list(@TenantId() tenantId: string, @Query(new ZodPipe(orderListSchema)) q: z.infer<typeof orderListSchema>) {
    return this.orders.list(tenantId, q);
  }

  @Post('quote')
  @RequirePermissions('orders.create')
  async quote(@TenantId() tenantId: string, @Auth() auth: AuthContext, @Body(zBody(quoteSchema)) body: z.infer<typeof quoteSchema>) {
    const { lines, totals, deliveryZone } = await this.orders.quote(tenantId, body, auth.permissions.has('orders.update'));
    return {
      totals,
      deliveryZone,
      lines: lines.map((l, i) => ({ productId: l.product.id, name: l.product.name, sku: l.product.sku, unitPrice: l.unitPrice, quantity: l.quantity, total: totals.lines[i]!.total })),
    };
  }

  @Get(':id')
  @RequirePermissions('orders.view')
  get(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.orders.get(tenantId, id);
  }

  @Post()
  @RequirePermissions('orders.create')
  create(@CurrentActor() actor: Actor, @Auth() auth: AuthContext, @Body(zBody(createOrderSchema)) body: z.infer<typeof createOrderSchema>) {
    const source = auth.kind === 'api_key' ? 'API' : 'MANUAL';
    return this.orders.create(actor, body, { source, allowPriceOverride: auth.permissions.has('orders.update') });
  }

  @Patch(':id')
  @RequirePermissions('orders.update')
  update(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(updateOrderSchema)) body: z.infer<typeof updateOrderSchema>) {
    return this.orders.update(actor, id, body);
  }

  @Post(':id/status')
  @RequirePermissions('orders.update')
  status(@CurrentActor() actor: Actor, @Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(zBody(orderStatusSchema)) body: z.infer<typeof orderStatusSchema>) {
    if ((body.status === 'CANCELLED' || body.status === 'REFUNDED') && !auth.permissions.has('orders.cancel')) {
      throw new AppException('PERMISSION_DENIED', 'You do not have permission to cancel or refund orders.', 403);
    }
    return this.orders.changeStatus(actor, id, body);
  }
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermissions('orders.view')
  list(@TenantId() tenantId: string, @Query(new ZodPipe(paymentListSchema)) q: z.infer<typeof paymentListSchema>) {
    return this.payments.list(tenantId, q);
  }

  @Get('methods')
  @RequirePermissions('orders.view')
  methods(@TenantId() tenantId: string, @Query(new ZodPipe(methodsQuerySchema)) q: z.infer<typeof methodsQuerySchema>) {
    return this.payments.methods(tenantId, q);
  }

  /** Creates a payment link (online gateways) or payment instructions (manual methods) for an order. */
  @Post('request')
  @RequirePermissions('orders.update')
  request(@CurrentActor() actor: Actor, @Body(zBody(requestPaymentSchema)) body: z.infer<typeof requestPaymentSchema>) {
    return this.payments.requestPayment(actor, body);
  }

  @Post()
  @RequirePermissions('orders.update')
  record(@CurrentActor() actor: Actor, @Body(zBody(recordPaymentSchema)) body: z.infer<typeof recordPaymentSchema>) {
    return this.payments.record(actor, body);
  }

  @Post(':id/status')
  @RequirePermissions('orders.update')
  setStatus(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(paymentStatusSchema)) body: z.infer<typeof paymentStatusSchema>) {
    return this.payments.setStatus(actor, id, body.status);
  }

  @Post(':id/refund')
  @RequirePermissions('orders.cancel')
  refund(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(refundSchema)) body: z.infer<typeof refundSchema>) {
    return this.payments.refund(actor, id, body);
  }
}

const invoiceCreateSchema = z.object({ orderId: z.string().uuid() });

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermissions('orders.view')
  list(@TenantId() tenantId: string, @Query(new ZodPipe(invoiceListSchema)) q: z.infer<typeof invoiceListSchema>) {
    return this.invoices.list(tenantId, q);
  }

  @Get(':id')
  @RequirePermissions('orders.view')
  get(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.invoices.get(tenantId, id);
  }

  @Get(':id/pdf')
  @RequirePermissions('orders.view')
  @RawResponse()
  async pdf(@TenantId() tenantId: string, @Param('id', uuid) id: string, @Res() res: Response) {
    const { buffer, filename } = await this.invoices.pdf(tenantId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  }

  @Post()
  @RequirePermissions('orders.create')
  create(@CurrentActor() actor: Actor, @Body(zBody(invoiceCreateSchema)) body: z.infer<typeof invoiceCreateSchema>) {
    return this.invoices.createFromOrder(actor, body.orderId);
  }

  @Post(':id/void')
  @RequirePermissions('orders.cancel')
  void(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.invoices.void(actor, id);
  }
}

@Controller('deliveries')
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  @Get()
  @RequirePermissions('orders.view')
  list(@TenantId() tenantId: string, @Query(new ZodPipe(deliveryListSchema)) q: z.infer<typeof deliveryListSchema>) {
    return this.deliveries.list(tenantId, q);
  }

  @Post()
  @RequirePermissions('orders.update')
  create(@CurrentActor() actor: Actor, @Body(zBody(deliverySchema)) body: z.infer<typeof deliverySchema>) {
    return this.deliveries.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('orders.update')
  update(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(deliveryUpdateSchema)) body: z.infer<typeof deliveryUpdateSchema>) {
    return this.deliveries.update(actor, id, body);
  }
}
