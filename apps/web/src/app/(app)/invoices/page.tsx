'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { date, money } from '@/lib/format';
import { PAYMENT_STATUS } from '@/lib/status';
import { PageHeader, StatusBadge } from '@/components/shared/page';
import { DataTable, Pagination, SearchInput, Toolbar, FilterChips } from '@/components/shared/data-table';
import { Badge } from '@/components/ui/primitives';
import { useListState } from '@/hooks/use-list-state';

interface Invoice {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  currency: string;
  issueDate: string;
  dueDate: string | null;
  total: string;
  amountPaid: string;
  customer: { id: string; name: string };
  order: { id: string; number: string } | null;
}

export default function InvoicesPage() {
  const router = useRouter();
  const list = useListState<{ paymentStatus?: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ['invoices', list.query],
    queryFn: () => api.get<Paginated<Invoice>>('/invoices', { ...list.query, pageSize: 20 }),
    placeholderData: (p) => p,
  });
  return (
    <>
      <PageHeader title="Invoices" description="Printable invoices generated from orders. Create one from any order page." />
      <Toolbar>
        <FilterChips
          value={list.filters.paymentStatus ?? 'ALL'}
          onChange={(v) => list.setFilter('paymentStatus', v === 'ALL' ? undefined : v)}
          options={[{ value: 'ALL', label: 'All' }, { value: 'PENDING', label: 'Unpaid' }, { value: 'PAID', label: 'Paid' }, { value: 'REFUNDED', label: 'Refunded' }]}
        />
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Invoice number or customer" className="sm:ml-auto" />
      </Toolbar>
      <DataTable
        rows={data?.items}
        loading={isLoading}
        onRowClick={(i) => router.push(`/invoices/${i.id}`)}
        empty={{ icon: Receipt, title: 'No invoices yet', description: 'Open an order and choose "Create invoice".' }}
        mobileCard={(i) => (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium">{i.number}</p>
              <p className="truncate text-xs text-muted-foreground">
                {i.customer.name} · {date(i.issueDate)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="font-medium tabular">{money(i.total, i.currency)}</span>
              <StatusBadge map={PAYMENT_STATUS} value={i.paymentStatus} />
            </div>
          </div>
        )}
        columns={[
          { key: 'number', header: 'Invoice', cell: (i) => <span className="font-medium">{i.number}</span> },
          { key: 'customer', header: 'Customer', cell: (i) => i.customer.name },
          { key: 'order', header: 'Order', hideBelow: 'lg', cell: (i) => <span className="text-muted-foreground">{i.order?.number ?? '—'}</span> },
          { key: 'issued', header: 'Issued', hideBelow: 'md', cell: (i) => <span className="text-muted-foreground">{date(i.issueDate)}</span> },
          { key: 'due', header: 'Due', hideBelow: 'md', cell: (i) => <span className="text-muted-foreground">{date(i.dueDate)}</span> },
          { key: 'status', header: 'Status', cell: (i) => (i.status === 'VOID' ? <Badge variant="muted">Void</Badge> : <StatusBadge map={PAYMENT_STATUS} value={i.paymentStatus} />) },
          { key: 'total', header: 'Total', align: 'right', cell: (i) => <span className="font-medium tabular">{money(i.total, i.currency)}</span> },
        ]}
        footer={data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={list.setPage} label="invoices" />}
      />
    </>
  );
}
