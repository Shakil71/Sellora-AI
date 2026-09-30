'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Handshake, KanbanSquare } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { date, money } from '@/lib/format';
import { PRIORITY } from '@/lib/status';
import { useSession } from '@/components/session';
import { PageHeader, StatCard, StatusBadge } from '@/components/shared/page';
import { DataTable, FilterChips, Pagination, SearchInput, Toolbar } from '@/components/shared/data-table';
import { Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { useListState } from '@/hooks/use-list-state';
import type { Deal } from '@/features/deals/deal-form';

type Row = Deal & { pipeline: { id: string; name: string } };

export default function DealsPage() {
  const router = useRouter();
  const { currency } = useSession();
  const list = useListState<{ status?: string }>({ status: 'OPEN' });
  const { data, isLoading } = useQuery({
    queryKey: ['deals', list.query],
    queryFn: () => api.get<Paginated<Row> & { summary: Array<{ status: string; count: number; amount: number }> }>('/deals', { ...list.query, pageSize: 25 }),
    placeholderData: (p) => p,
  });
  const sum = (s: string) => data?.summary.find((x) => x.status === s);
  return (
    <>
      <PageHeader
        title="Deals"
        description="Every opportunity across your pipelines."
        actions={
          <Button variant="outline" asChild>
            <Link href="/pipelines">
              <KanbanSquare /> Board view
            </Link>
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Open pipeline" loading={isLoading} value={money(sum('OPEN')?.amount ?? 0, currency)} hint={`${sum('OPEN')?.count ?? 0} open deals`} />
        <StatCard label="Won" loading={isLoading} value={money(sum('WON')?.amount ?? 0, currency)} hint={`${sum('WON')?.count ?? 0} deals`} />
        <StatCard label="Lost" loading={isLoading} value={money(sum('LOST')?.amount ?? 0, currency)} hint={`${sum('LOST')?.count ?? 0} deals`} />
      </div>
      <Toolbar>
        <FilterChips
          value={list.filters.status ?? 'ALL'}
          onChange={(v) => list.setFilter('status', v === 'ALL' ? undefined : v)}
          options={[
            { value: 'OPEN', label: 'Open' },
            { value: 'WON', label: 'Won' },
            { value: 'LOST', label: 'Lost' },
            { value: 'ALL', label: 'All' },
          ]}
        />
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search deals or customers" className="sm:ml-auto" />
      </Toolbar>
      <DataTable
        rows={data?.items}
        loading={isLoading}
        onRowClick={(d) => router.push(`/pipelines?pipeline=${d.pipelineId}`)}
        empty={{ icon: Handshake, title: 'No deals', description: 'Create deals from the pipeline board or by converting leads.' }}
        mobileCard={(d) => (
          <div className="space-y-1">
            <div className="flex justify-between gap-2">
              <p className="truncate font-medium">{d.name}</p>
              <span className="font-medium tabular">{money(d.amount, currency)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {d.stage.name} · {d.customer?.name ?? 'No customer'}
            </p>
          </div>
        )}
        columns={[
          { key: 'name', header: 'Deal', cell: (d) => <span className="font-medium">{d.name}</span> },
          { key: 'customer', header: 'Customer', hideBelow: 'md', cell: (d) => d.customer?.name ?? <span className="text-muted-foreground">—</span> },
          { key: 'stage', header: 'Stage', cell: (d) => <Badge variant="outline">{d.stage.name}</Badge> },
          { key: 'pipeline', header: 'Pipeline', hideBelow: 'lg', cell: (d) => <span className="text-muted-foreground">{d.pipeline.name}</span> },
          { key: 'priority', header: 'Priority', hideBelow: 'lg', cell: (d) => <StatusBadge map={PRIORITY} value={d.priority} /> },
          { key: 'close', header: 'Expected close', hideBelow: 'md', cell: (d) => <span className="text-muted-foreground">{date(d.expectedCloseDate)}</span> },
          { key: 'amount', header: 'Amount', align: 'right', cell: (d) => <span className="font-medium tabular">{money(d.amount, currency)}</span> },
        ]}
        footer={data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={list.setPage} label="deals" />}
      />
    </>
  );
}
