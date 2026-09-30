import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface SearchHit {
  type: 'customer' | 'lead' | 'conversation' | 'product' | 'order' | 'deal';
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

/** Global search (Cmd/Ctrl+K). Each entity type is only searched when the user may view it. */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(tenantId: string, q: string, permissions: Set<string>): Promise<{ query: string; results: SearchHit[] }> {
    const term = q.trim();
    if (term.length < 2) return { query: term, results: [] };
    const ci = { contains: term, mode: 'insensitive' as const };
    const tasks: Array<Promise<SearchHit[]>> = [];

    if (permissions.has('contacts.view')) {
      tasks.push(
        this.prisma.customer
          .findMany({ where: { tenantId, OR: [{ name: ci }, { email: ci }, { phone: { contains: term } }, { whatsappNumber: { contains: term } }] }, take: 5, select: { id: true, name: true, email: true, whatsappNumber: true } })
          .then((rows) => rows.map((r) => ({ type: 'customer' as const, id: r.id, title: r.name, subtitle: r.email ?? r.whatsappNumber ?? undefined, href: `/customers/${r.id}` }))),
      );
    }
    if (permissions.has('crm.leads.view')) {
      tasks.push(
        this.prisma.lead
          .findMany({ where: { tenantId, OR: [{ name: ci }, { email: ci }, { company: ci }] }, take: 5, select: { id: true, name: true, status: true } })
          .then((rows) => rows.map((r) => ({ type: 'lead' as const, id: r.id, title: r.name, subtitle: r.status, href: `/leads/${r.id}` }))),
      );
    }
    if (permissions.has('conversations.view')) {
      tasks.push(
        this.prisma.conversation
          .findMany({
            where: { tenantId, OR: [{ customer: { name: ci } }, { lastMessagePreview: ci }] },
            take: 5,
            orderBy: { lastMessageAt: 'desc' },
            select: { id: true, lastMessagePreview: true, customer: { select: { name: true } } },
          })
          .then((rows) => rows.map((r) => ({ type: 'conversation' as const, id: r.id, title: r.customer.name, subtitle: r.lastMessagePreview ?? undefined, href: `/inbox?conversation=${r.id}` }))),
      );
    }
    if (permissions.has('products.view')) {
      tasks.push(
        this.prisma.product
          .findMany({ where: { tenantId, OR: [{ name: ci }, { sku: ci }] }, take: 5, select: { id: true, name: true, sku: true } })
          .then((rows) => rows.map((r) => ({ type: 'product' as const, id: r.id, title: r.name, subtitle: r.sku, href: `/products/${r.id}` }))),
      );
    }
    if (permissions.has('orders.view')) {
      tasks.push(
        this.prisma.order
          .findMany({ where: { tenantId, OR: [{ number: ci }, { customer: { name: ci } }] }, take: 5, orderBy: { createdAt: 'desc' }, select: { id: true, number: true, status: true, customer: { select: { name: true } } } })
          .then((rows) => rows.map((r) => ({ type: 'order' as const, id: r.id, title: r.number, subtitle: `${r.customer.name} · ${r.status}`, href: `/orders/${r.id}` }))),
      );
    }
    if (permissions.has('crm.deals.view')) {
      tasks.push(
        this.prisma.deal
          .findMany({ where: { tenantId, name: ci }, take: 5, select: { id: true, name: true, pipelineId: true, stage: { select: { name: true } } } })
          .then((rows) => rows.map((r) => ({ type: 'deal' as const, id: r.id, title: r.name, subtitle: r.stage.name, href: `/pipelines?pipeline=${r.pipelineId}&deal=${r.id}` }))),
      );
    }
    const results = (await Promise.all(tasks)).flat();
    return { query: term, results };
  }
}
