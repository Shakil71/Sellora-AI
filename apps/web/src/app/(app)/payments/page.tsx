'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CreditCard } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { dateTime, money, titleCase } from '@/lib/format';
import { PAYMENT_STATUS } from '@/lib/status';
import { useSession } from '@/components/session';
import { PageHeader, StatCard, StatusBadge } from '@/components/shared/page';
import { DataTable, FilterChips, Pagination, SearchInput, Toolbar } from '@/components/shared/data-table';
import { useListState } from '@/hooks/use-list-state';

interface Payment {
  id: string;
  amount: string;
  refundedAmount: string;
  currency: string;
  status: string;
  method: string;
  provider: string;
  providerRef: string | null;
  paidAt: string | null;
  createdAt: string;
  order: { id: string; number: string; customer: { id: string; name: string } } | null;
}

export default function PaymentsPage() {
  const router = useRouter();
  const { currency } = useSession();
  const list = useListState<{ status?: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ['payments', list.query],
    queryFn: () => api.get<Paginated<Payment> & { summary: Array<{ status: string; count: number; amount: number; refunded: number }> }>('/payments', { ...list.query, pageSize: 25 }),
    placeholderData: (p) => p,
  });
  const s = (k: string) => data?.summary.find((x) => x.status === k);
  const collected = (s('PAID')?.amount ?? 0) + (s('PARTIALLY_REFUNDED')?.amount ?? 0) - (s('PARTIALLY_REFUNDED')?.refunded ?? 0);
  return (
    <>
      <PageHeader title="Payments" description="Payments recorded against orders. Payment methods are configurable in workspace settings." />
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Collected" loading={isLoading} value={money(collected, currency)} />
        <StatCard label="Pending" loading={isLoading} value={money(s('PENDING')?.amount ?? 0, currency)} hint={`${s('PENDING')?.count ?? 0} payments`} />
        <StatCard label="Refunded" loading={isLoading} value={money((s('REFUNDED')?.refunded ?? 0) + (s('PARTIALLY_REFUNDED')?.refunded ?? 0), currency)} />
      </div>
      <Toolbar>
        <FilterChips
          value={list.filters.status ?? 'ALL'}
          onChange={(v) => list.setFilter('status', v === 'ALL' ? undefined : v)}
          options={[{ value: 'ALL', label: 'All' }, ...Object.entries(PAYMENT_STATUS).map(([k, v]) => ({ value: k, label: k === 'PENDING' ? 'Pending' : v.label }))]}
        />
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Order number or reference" className="sm:ml-auto" />
      </Toolbar>
      <DataTable
        rows={data?.items}
        loading={isLoading}
        onRowClick={(p) => p.order && router.push(`/orders/${p.order.id}`)}
        empty={{ icon: CreditCard, title: 'No payments yet', description: 'Record payments from an order page.' }}
        mobileCard={(p) => (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium">{p.order?.number ?? 'Payment'}</p>
              <p className="truncate text-xs text-muted-foreground">
                {titleCase(p.method)} · {p.order?.customer.name}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="font-medium tabular">{money(p.amount, p.currency)}</span>
              <StatusBadge map={PAYMENT_STATUS} value={p.status} />
            </div>
          </div>
        )}
        columns={[
          { key: 'date', header: 'Date', cell: (p) => <span className="text-muted-foreground">{dateTime(p.paidAt ?? p.createdAt)}</span> },
          { key: 'order', header: 'Order', cell: (p) => <span className="font-medium">{p.order?.number ?? '—'}</span> },
          { key: 'customer', header: 'Customer', hideBelow: 'md', cell: (p) => p.order?.customer.name ?? '—' },
          { key: 'method', header: 'Method', hideBelow: 'md', cell: (p) => titleCase(p.method) },
          { key: 'ref', header: 'Reference', hideBelow: 'lg', cell: (p) => <span className="text-muted-foreground">{p.providerRef ?? '—'}</span> },
          { key: 'status', header: 'Status', cell: (p) => <StatusBadge map={PAYMENT_STATUS} value={p.status} /> },
          { key: 'amount', header: 'Amount', align: 'right', cell: (p) => <span className="font-medium tabular">{money(p.amount, p.currency)}</span> },
        ]}
        footer={data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={list.setPage} label="payments" />}
      />
    </>
  );
}
