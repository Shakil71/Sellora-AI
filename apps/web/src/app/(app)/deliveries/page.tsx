'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Truck } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { date } from '@/lib/format';
import { DELIVERY_STATUS } from '@/lib/status';
import { PageHeader, StatusBadge } from '@/components/shared/page';
import { DataTable, FilterChips, Pagination, SearchInput, Toolbar } from '@/components/shared/data-table';
import { useListState } from '@/hooks/use-list-state';

interface Delivery {
  id: string;
  status: string;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  recipientName: string | null;
  city: string | null;
  country: string | null;
  scheduledAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  order: { id: string; number: string; status: string; customer: { id: string; name: string } };
}

export default function DeliveriesPage() {
  const router = useRouter();
  const list = useListState<{ status?: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ['deliveries', list.query],
    queryFn: () => api.get<Paginated<Delivery> & { statusCounts: Record<string, number> }>('/deliveries', { ...list.query, pageSize: 25 }),
    placeholderData: (p) => p,
  });
  const counts = data?.statusCounts ?? {};
  return (
    <>
      <PageHeader title="Deliveries" description="Shipments for your orders. Updating a delivery keeps the order status in sync." />
      <Toolbar>
        <FilterChips
          value={list.filters.status ?? 'ALL'}
          onChange={(v) => list.setFilter('status', v === 'ALL' ? undefined : v)}
          options={[{ value: 'ALL', label: 'All' }, ...Object.entries(DELIVERY_STATUS).map(([k, v]) => ({ value: k, label: v.label, count: counts[k] ?? 0 }))]}
        />
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Order, recipient or tracking" className="sm:ml-auto" />
      </Toolbar>
      <DataTable
        rows={data?.items}
        loading={isLoading}
        onRowClick={(d) => router.push(`/orders/${d.order.id}`)}
        empty={{ icon: Truck, title: 'No deliveries yet', description: 'Create a delivery from an order to track shipping.' }}
        mobileCard={(d) => (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium">{d.order.number}</p>
              <p className="truncate text-xs text-muted-foreground">
                {d.recipientName ?? d.order.customer.name} · {d.carrier ?? 'No carrier'}
              </p>
            </div>
            <StatusBadge map={DELIVERY_STATUS} value={d.status} />
          </div>
        )}
        columns={[
          { key: 'order', header: 'Order', cell: (d) => <span className="font-medium">{d.order.number}</span> },
          { key: 'recipient', header: 'Recipient', cell: (d) => d.recipientName ?? d.order.customer.name },
          { key: 'dest', header: 'Destination', hideBelow: 'md', cell: (d) => <span className="text-muted-foreground">{[d.city, d.country].filter(Boolean).join(', ') || '—'}</span> },
          { key: 'carrier', header: 'Carrier', hideBelow: 'lg', cell: (d) => d.carrier ?? '—' },
          {
            key: 'tracking',
            header: 'Tracking',
            hideBelow: 'lg',
            cell: (d) =>
              d.trackingUrl ? (
                <a href={d.trackingUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">
                  {d.trackingNumber ?? 'Track'}
                </a>
              ) : (
                <span className="text-muted-foreground">{d.trackingNumber ?? '—'}</span>
              ),
          },
          { key: 'shipped', header: 'Shipped', hideBelow: 'md', cell: (d) => <span className="text-muted-foreground">{date(d.shippedAt)}</span> },
          { key: 'status', header: 'Status', cell: (d) => <StatusBadge map={DELIVERY_STATUS} value={d.status} /> },
        ]}
        footer={data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={list.setPage} label="deliveries" />}
      />
    </>
  );
}
