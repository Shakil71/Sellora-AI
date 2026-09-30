'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Bot, Plus, ShoppingCart } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { date, money } from '@/lib/format';
import { ORDER_SOURCE, ORDER_STATUS, PAYMENT_STATUS } from '@/lib/status';
import type { Order } from '@/lib/types';
import { useSession } from '@/components/session';
import { PageHeader, StatusBadge } from '@/components/shared/page';
import { DataTable, FilterChips, Pagination, SearchInput, Toolbar } from '@/components/shared/data-table';
import { Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';
import { useListState } from '@/hooks/use-list-state';

export default function OrdersPage() {
  const router = useRouter();
  const { can } = useSession();
  const list = useListState<{ status?: string; paymentStatus?: string; source?: string; customerId?: string }>({}, ['status', 'customerId', 'search']);
  const { data, isLoading } = useQuery({
    queryKey: ['orders', list.query],
    queryFn: () => api.get<Paginated<Order> & { statusCounts: Record<string, number> }>('/orders', { ...list.query, pageSize: 20 }),
    placeholderData: (p) => p,
  });
  const counts = data?.statusCounts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        title="Orders"
        description="Orders from WhatsApp, your AI agent, your team and the API."
        actions={
          can('orders.create') && (
            <Button asChild>
              <Link href="/orders/new">
                <Plus /> New order
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-3">
        <FilterChips
          value={list.filters.status ?? 'ALL'}
          onChange={(v) => list.setFilter('status', v === 'ALL' ? undefined : v)}
          options={[{ value: 'ALL', label: 'All', count: total }, ...Object.entries(ORDER_STATUS).map(([k, v]) => ({ value: k, label: v.label, count: counts[k] ?? 0 }))]}
        />
      </div>
      <Toolbar>
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Order number or customer" />
        <Select value={list.filters.paymentStatus ?? 'all'} onValueChange={(v) => list.setFilter('paymentStatus', v === 'all' ? undefined : v)}>
          <SelectTrigger className="sm:w-44" aria-label="Payment">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any payment</SelectItem>
            {Object.entries(PAYMENT_STATUS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={list.filters.source ?? 'all'} onValueChange={(v) => list.setFilter('source', v === 'all' ? undefined : v)}>
          <SelectTrigger className="sm:w-40" aria-label="Source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any source</SelectItem>
            {Object.entries(ORDER_SOURCE).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Toolbar>
      <DataTable
        rows={data?.items}
        loading={isLoading}
        onRowClick={(o) => router.push(`/orders/${o.id}`)}
        empty={{
          icon: ShoppingCart,
          title: 'No orders found',
          description: 'When customers order through WhatsApp or your team creates an order, it appears here.',
          action: can('orders.create') ? <Button asChild><Link href="/orders/new"><Plus /> New order</Link></Button> : undefined,
        }}
        mobileCard={(o) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{o.number}</p>
              <span className="font-semibold tabular">{money(o.total, o.currency)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs text-muted-foreground">
                {o.customer.name} · {date(o.createdAt)}
              </p>
              <StatusBadge map={ORDER_STATUS} value={o.status} />
            </div>
          </div>
        )}
        columns={[
          {
            key: 'number',
            header: 'Order',
            cell: (o) => (
              <span className="flex items-center gap-2 font-medium">
                {o.number}
                {o.source === 'AI' && (
                  <Badge variant="ai">
                    <Bot /> AI
                  </Badge>
                )}
              </span>
            ),
          },
          { key: 'customer', header: 'Customer', cell: (o) => o.customer.name },
          { key: 'date', header: 'Date', hideBelow: 'md', cell: (o) => <span className="text-muted-foreground">{date(o.createdAt)}</span> },
          { key: 'items', header: 'Items', align: 'right', hideBelow: 'lg', cell: (o) => <span className="tabular">{o._count?.items ?? '—'}</span> },
          { key: 'status', header: 'Status', cell: (o) => <StatusBadge map={ORDER_STATUS} value={o.status} /> },
          {
            key: 'payment',
            header: 'Payment',
            hideBelow: 'md',
            cell: (o) => (Number(o.amountPaid) > 0 && o.paymentStatus === 'PENDING' ? <Badge variant="warning">Partially paid</Badge> : <StatusBadge map={PAYMENT_STATUS} value={o.paymentStatus} />),
          },
          { key: 'total', header: 'Total', align: 'right', cell: (o) => <span className="font-medium tabular">{money(o.total, o.currency)}</span> },
        ]}
        footer={data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={list.setPage} label="orders" />}
      />
    </>
  );
}
