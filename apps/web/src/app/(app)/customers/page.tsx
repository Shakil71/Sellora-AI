'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { money, relative } from '@/lib/format';
import type { Customer } from '@/lib/types';
import { useSession } from '@/components/session';
import { PageHeader } from '@/components/shared/page';
import { DataTable, Pagination, SearchInput, Toolbar } from '@/components/shared/data-table';
import { Avatar, Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';
import { CustomerFormDialog } from '@/features/customers/customer-form';
import { useListState, useOpenFromQuery } from '@/hooks/use-list-state';

export default function CustomersPage() {
  const router = useRouter();
  const { can, currency } = useSession();
  const [open, setOpen] = React.useState(false);
  useOpenFromQuery(setOpen);
  const list = useListState<{ tag?: string; sort?: string }>({ sort: 'createdAt' });
  const { data, isLoading } = useQuery({
    queryKey: ['customers', list.query],
    queryFn: () => api.get<Paginated<Customer>>('/customers', { ...list.query, pageSize: 20 }),
    placeholderData: (p) => p,
  });
  const tags = useQuery({ queryKey: ['customer-tags'], queryFn: () => api.get<Array<{ tag: string; count: number }>>('/customers/tags') });

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone who has messaged, bought from or been added to your workspace."
        actions={
          can('contacts.create') && (
            <Button onClick={() => setOpen(true)}>
              <Plus /> Add customer
            </Button>
          )
        }
      />
      <Toolbar>
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search name, email or phone" />
        <Select value={list.filters.tag ?? 'all'} onValueChange={(v) => list.setFilter('tag', v === 'all' ? undefined : v)}>
          <SelectTrigger className="sm:w-44" aria-label="Filter by tag">
            <SelectValue placeholder="All tags" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tags</SelectItem>
            {tags.data?.map((t) => (
              <SelectItem key={t.tag} value={t.tag}>
                {t.tag} ({t.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={list.filters.sort ?? 'createdAt'} onValueChange={(v) => list.setFilter('sort', v)}>
          <SelectTrigger className="sm:w-48" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="createdAt">Newest first</SelectItem>
            <SelectItem value="lastInteractionAt">Recently active</SelectItem>
            <SelectItem value="totalSpent">Top spenders</SelectItem>
            <SelectItem value="ordersCount">Most orders</SelectItem>
          </SelectContent>
        </Select>
      </Toolbar>
      <DataTable
        rows={data?.items}
        loading={isLoading}
        onRowClick={(c) => router.push(`/customers/${c.id}`)}
        empty={{
          icon: Users,
          title: list.search || list.filters.tag ? 'No customers match your filters' : 'No customers yet',
          description: list.search ? 'Try a different search.' : 'Customers are created automatically when someone messages you on WhatsApp, or you can add them manually.',
          action: can('contacts.create') && !list.search ? <Button onClick={() => setOpen(true)}><Plus /> Add customer</Button> : undefined,
        }}
        mobileCard={(c) => (
          <div className="flex items-center gap-3">
            <Avatar name={c.name} src={c.avatarUrl} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{c.name}</p>
              <p className="truncate text-xs text-muted-foreground">{c.whatsappNumber ?? c.email ?? c.phone ?? '—'}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium tabular">{money(c.totalSpent, currency)}</p>
              <p className="text-xs text-muted-foreground">{c.ordersCount} orders</p>
            </div>
          </div>
        )}
        columns={[
          {
            key: 'name',
            header: 'Customer',
            cell: (c) => (
              <div className="flex items-center gap-3">
                <Avatar name={c.name} src={c.avatarUrl} size={32} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.company ?? c.email ?? ''}</p>
                </div>
              </div>
            ),
          },
          { key: 'contact', header: 'WhatsApp / phone', cell: (c) => <span className="text-muted-foreground">{c.whatsappNumber ?? c.phone ?? '—'}</span>, hideBelow: 'lg' },
          {
            key: 'tags',
            header: 'Tags',
            hideBelow: 'lg',
            cell: (c) => (
              <div className="flex flex-wrap gap-1">
                {c.tags.slice(0, 3).map((t) => (
                  <Badge key={t} variant="secondary">
                    {t}
                  </Badge>
                ))}
              </div>
            ),
          },
          { key: 'orders', header: 'Orders', align: 'right', cell: (c) => <span className="tabular">{c.ordersCount}</span> },
          { key: 'spent', header: 'Total spent', align: 'right', cell: (c) => <span className="font-medium tabular">{money(c.totalSpent, currency)}</span> },
          { key: 'last', header: 'Last active', align: 'right', hideBelow: 'md', cell: (c) => <span className="text-muted-foreground">{relative(c.lastInteractionAt)}</span> },
        ]}
        footer={data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={list.setPage} label="customers" />}
      />
      <CustomerFormDialog open={open} onOpenChange={setOpen} onSaved={(c) => router.push(`/customers/${c.id}`)} />
    </>
  );
}
