import { Injectable } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, Prisma } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { formatMoney } from '@sellora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TenantsService } from '../tenants/tenants.service';
import { OrdersService } from './orders.service';
import { paginate, toPaginated } from '../../common/pagination';
import { ConflictError, ensureFound, ValidationError } from '../../common/errors';
import type { Actor } from '../../common/auth-context';

export const invoiceListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  status: z.nativeEnum(InvoiceStatus).optional(),
  paymentStatus: z.nativeEnum(PaymentStatus).optional(),
});

const invoiceInclude = {
  customer: { select: { id: true, name: true, email: true, phone: true, whatsappNumber: true, company: true, addressLine: true, city: true, country: true, postalCode: true } },
  items: true,
  order: { select: { id: true, number: true, status: true } },
  payments: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.InvoiceInclude;

/** Renders invoices to PDF. Swap implementation to change the layout engine. */
export interface InvoicePdfRenderer {
  render(invoice: Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>, business: { name: string; email?: string | null; phone?: string | null; address?: string | null; website?: string | null }, locale: string): Promise<Buffer>;
}

class PdfKitInvoiceRenderer implements InvoicePdfRenderer {
  render(invoice: Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>, business: { name: string; email?: string | null; phone?: string | null; address?: string | null; website?: string | null }, locale: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Invoice ${invoice.number}`, Author: business.name } });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const money = (v: Prisma.Decimal | number) => formatMoney(Number(v), invoice.currency, locale);
      const brand = '#0f766e';
      const muted = '#71717a';

      doc.fillColor(brand).fontSize(20).font('Helvetica-Bold').text(business.name, 48, 48);
      doc.fillColor(muted).fontSize(9).font('Helvetica');
      [business.address, business.email, business.phone, business.website].filter(Boolean).forEach((l) => doc.text(String(l)));
      doc.fillColor('#18181b').fontSize(22).font('Helvetica-Bold').text('INVOICE', 350, 48, { align: 'right' });
      doc.fontSize(10).font('Helvetica').fillColor(muted);
      doc.text(`Invoice #: ${invoice.number}`, 350, 78, { align: 'right' });
      doc.text(`Issued: ${invoice.issueDate.toLocaleDateString(locale)}`, { align: 'right' });
      if (invoice.dueDate) doc.text(`Due: ${invoice.dueDate.toLocaleDateString(locale)}`, { align: 'right' });
      if (invoice.order) doc.text(`Order: ${invoice.order.number}`, { align: 'right' });
      doc.text(`Status: ${invoice.paymentStatus.replace('_', ' ')}`, { align: 'right' });

      doc.moveDown(2);
      const billY = 160;
      doc.fillColor(muted).fontSize(9).text('BILL TO', 48, billY);
      doc.fillColor('#18181b').fontSize(11).font('Helvetica-Bold').text(invoice.customer.name, 48, billY + 14);
      doc.font('Helvetica').fontSize(9).fillColor('#3f3f46');
      [invoice.customer.company, invoice.customer.addressLine, [invoice.customer.city, invoice.customer.postalCode, invoice.customer.country].filter(Boolean).join(', '), invoice.customer.email, invoice.customer.phone ?? invoice.customer.whatsappNumber]
        .filter(Boolean)
        .forEach((l) => doc.text(String(l)));

      let y = 260;
      const cols = { desc: 48, qty: 330, price: 380, total: 470 };
      doc.rect(48, y, 499, 22).fill('#f4f4f5');
      doc.fillColor('#3f3f46').fontSize(9).font('Helvetica-Bold');
      doc.text('Description', cols.desc + 8, y + 7);
      doc.text('Qty', cols.qty, y + 7, { width: 40, align: 'right' });
      doc.text('Unit price', cols.price, y + 7, { width: 80, align: 'right' });
      doc.text('Amount', cols.total, y + 7, { width: 70, align: 'right' });
      y += 30;
      doc.font('Helvetica').fillColor('#18181b');
      for (const item of invoice.items) {
        if (y > 700) {
          doc.addPage();
          y = 60;
        }
        doc.text(item.description + (item.sku ? `  (${item.sku})` : ''), cols.desc + 8, y, { width: 270 });
        doc.text(String(item.quantity), cols.qty, y, { width: 40, align: 'right' });
        doc.text(money(item.unitPrice), cols.price, y, { width: 80, align: 'right' });
        doc.text(money(item.total), cols.total, y, { width: 70, align: 'right' });
        y += 22;
        doc.moveTo(48, y - 6).lineTo(547, y - 6).strokeColor('#e4e4e7').lineWidth(0.5).stroke();
      }
      y += 8;
      const row = (label: string, value: string, bold = false) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor(bold ? '#18181b' : '#3f3f46');
        doc.text(label, 340, y, { width: 120, align: 'right' });
        doc.text(value, cols.total, y, { width: 70, align: 'right' });
        y += bold ? 20 : 16;
      };
      row('Subtotal', money(invoice.subtotal));
      if (Number(invoice.discountTotal) > 0) row('Discount', `-${money(invoice.discountTotal)}`);
      if (Number(invoice.taxTotal) > 0) row('Tax', money(invoice.taxTotal));
      if (Number(invoice.shippingTotal) > 0) row('Shipping', money(invoice.shippingTotal));
      row('Total', money(invoice.total), true);
      if (Number(invoice.amountPaid) > 0) {
        row('Paid', money(invoice.amountPaid));
        row('Balance due', money(Number(invoice.total) - Number(invoice.amountPaid)), true);
      }
      if (invoice.notes) {
        doc.moveDown(2).font('Helvetica').fontSize(9).fillColor(muted).text('Notes', 48, y + 20);
        doc.fillColor('#3f3f46').text(invoice.notes, 48, y + 34, { width: 499 });
      }
      doc.fontSize(8).fillColor(muted).text(`Thank you for your business — ${business.name}`, 48, 780, { align: 'center', width: 499 });
      doc.end();
    });
  }
}

@Injectable()
export class InvoicesService {
  private readonly renderer: InvoicePdfRenderer = new PdfKitInvoiceRenderer();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenants: TenantsService,
    private readonly orders: OrdersService,
  ) {}

  async list(tenantId: string, q: z.infer<typeof invoiceListSchema>) {
    const where: Prisma.InvoiceWhereInput = {
      tenantId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.paymentStatus ? { paymentStatus: q.paymentStatus } : {}),
      ...(q.search
        ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { customer: { name: { contains: q.search, mode: 'insensitive' } } }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: { customer: { select: { id: true, name: true } }, order: { select: { id: true, number: true } } },
        orderBy: { issueDate: 'desc' },
        ...paginate(q),
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return toPaginated(items, total, q);
  }

  async get(tenantId: string, id: string) {
    const invoice = ensureFound(await this.prisma.invoice.findFirst({ where: { id, tenantId }, include: invoiceInclude }), 'Invoice');
    const tenant = await this.tenants.getCurrent(tenantId);
    return {
      ...invoice,
      business: {
        name: tenant.businessName ?? tenant.name,
        logoUrl: tenant.logoUrl,
        email: tenant.email,
        phone: tenant.phone,
        address: tenant.address,
        website: tenant.website,
      },
      locale: tenant.locale,
    };
  }

  async createFromOrder(actor: Actor, orderId: string) {
    const order = ensureFound(await this.prisma.order.findFirst({ where: { id: orderId, tenantId: actor.tenantId }, include: { items: true, invoice: true } }), 'Order');
    if (order.invoice) throw new ConflictError(`Invoice ${order.invoice.number} already exists for this order.`);
    if (order.status === 'CANCELLED') throw new ValidationError('Cannot invoice a cancelled order.');
    const settings = await this.tenants.commerceSettings(actor.tenantId);
    const invoice = await this.prisma.$transaction(async (tx) => {
      const number = await this.orders.nextNumber(tx, actor.tenantId, 'invoice', settings.invoicePrefix);
      const created = await tx.invoice.create({
        data: {
          tenantId: actor.tenantId,
          number,
          orderId: order.id,
          customerId: order.customerId,
          currency: order.currency,
          dueDate: new Date(Date.now() + settings.invoiceDueDays * 86400_000),
          subtotal: order.subtotal,
          discountTotal: order.discountTotal,
          taxTotal: order.taxTotal,
          shippingTotal: order.shippingTotal,
          total: order.total,
          amountPaid: order.amountPaid,
          paymentStatus: order.paymentStatus,
          items: {
            create: order.items.map((i) => ({
              tenantId: actor.tenantId,
              description: i.name,
              sku: i.sku,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              discount: i.discount,
              total: i.total,
            })),
          },
        },
      });
      await tx.payment.updateMany({ where: { orderId: order.id, invoiceId: null }, data: { invoiceId: created.id } });
      return created;
    });
    await this.audit.log(actor, { action: 'invoice.created', entityType: 'Invoice', entityId: invoice.id, metadata: { number: invoice.number, order: order.number } });
    return this.get(actor.tenantId, invoice.id);
  }

  async void(actor: Actor, id: string) {
    const invoice = ensureFound(await this.prisma.invoice.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Invoice');
    if (invoice.paymentStatus === PaymentStatus.PAID) throw new ValidationError('Paid invoices cannot be voided. Refund the payment first.');
    await this.prisma.invoice.update({ where: { id }, data: { status: InvoiceStatus.VOID } });
    await this.audit.log(actor, { action: 'invoice.voided', entityType: 'Invoice', entityId: id, metadata: { number: invoice.number } });
    return this.get(actor.tenantId, id);
  }

  async pdf(tenantId: string, id: string) {
    const invoice = await this.get(tenantId, id);
    const buffer = await this.renderer.render(invoice, invoice.business, invoice.locale);
    return { buffer, filename: `${invoice.number}.pdf` };
  }
}
