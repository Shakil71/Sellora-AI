'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, Target } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { money, relative } from '@/lib/format';
import { LEAD_STATUS } from '@/lib/status';
import type { Lead } from '@/lib/types';
import { useSession } from '@/components/session';
import { PageHeader, StatusBadge } from '@/components/shared/page';
import { DataTable, FilterChips, Pagination, SearchInput, Toolbar } from '@/components/shared/data-table';
import { Avatar, Progress } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { LeadFormDialog } from '@/features/leads/lead-form';
import { useListState, useOpenFromQuery } from '@/hooks/use-list-state';
import { useMembers } from '@/components/shared/pickers';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';

export default function LeadsPage() {
  const router = useRouter();
  const { can, currency } = useSession();
  const [open, setOpen] = React.useState(false);
  useOpenFromQuery(setOpen);
  const members = useMembers();
  const list = useListState<{ status?: string; assignedUserId?: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ['leads', list.query],
    queryFn: () => api.get<Paginated<Lead> & { statusCounts: Record<string, number> }>('/leads', { ...list.query, pageSize: 20 }),
    placeholderData: (p) => p,
  });
  const counts = data?.statusCounts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        title="Leads"
        description="Potential customers captured by your team and your AI sales agent."
        actions={
          can('crm.leads.create') && (
            <Button onClick={() => setOpen(true)}>
              <Plus /> New lead
            </Button>
          )
        }
      />
      <div className="mb-3">
        <FilterChips
          value={list.filters.status ?? 'ALL'}
          onChange={(v) => list.setFilter('status', v === 'ALL' ? undefined : v)}
          options={[{ value: 'ALL', label: 'All', count: total }, ...Object.entries(LEAD_STATUS).map(([k, v]) => ({ value: k, label: v.label, count: counts[k] ?? 0 }))]}
        />
      </div>
      <Toolbar>
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search leads" />
        <Select value={list.filters.assignedUserId ?? 'all'} onValueChange={(v) => list.setFilter('assignedUserId', v === 'all' ? undefined : v)}>
          <SelectTrigger className="sm:w-48" aria-label="Filter by owner">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All owners</SelectItem>
            {members.data?.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Toolbar>
      <DataTable
        rows={data?.items}
        loading={isLoading}
        onRowClick={(l) => router.push(`/leads/${l.id}`)}
        empty={{
          icon: Target,
          title: 'No leads found',
          description: 'Your AI agent creates leads when customers show interest. You can also add leads manually.',
          action: can('crm.leads.create') ? <Button onClick={() => setOpen(true)}><Plus /> New lead</Button> : undefined,
        }}
        mobileCard={(l) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-medium">{l.name}</p>
              <StatusBadge map={LEAD_STATUS} value={l.status} />
            </div>
            <p className="text-xs text-muted-foreground">
              {l.company ?? l.source ?? '—'} · {relative(l.createdAt)}
            </p>
          </div>
        )}
        columns={[
          {
            key: 'name',
            header: 'Lead',
            cell: (l) => (
              <div className="min-w-0">
                <p className="truncate font-medium">{l.name}</p>
                <p className="truncate text-xs text-muted-foreground">{l.company ?? l.email ?? l.phone ?? ''}</p>
              </div>
            ),
          },
          { key: 'status', header: 'Status', cell: (l) => <StatusBadge map={LEAD_STATUS} value={l.status} /> },
          {
            key: 'score',
            header: 'Score',
            hideBelow: 'lg',
            cell: (l) => (
              <div className="flex w-28 items-center gap-2">
                <Progress value={l.score} className="h-1.5" aria-label={`Score ${l.score}`} />
                <span className="w-6 text-xs tabular">{l.score}</span>
              </div>
            ),
          },
          { key: 'value', header: 'Value', align: 'right', hideBelow: 'md', cell: (l) => <span className="tabular">{l.value ? money(l.value, currency) : '—'}</span> },
          { key: 'source', header: 'Source', hideBelow: 'lg', cell: (l) => <span className="text-muted-foreground">{l.source ?? '—'}</span> },
          {
            key: 'owner',
            header: 'Owner',
            hideBelow: 'md',
            cell: (l) => (l.assignedUser ? <span className="flex items-center gap-2"><Avatar name={l.assignedUser.name} size={22} />{l.assignedUser.name}</span> : <span className="text-muted-foreground">Unassigned</span>),
          },
          { key: 'created', header: 'Created', align: 'right', cell: (l) => <span className="text-muted-foreground">{relative(l.createdAt)}</span> },
        ]}
        footer={data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={list.setPage} label="leads" />}
      />
      <LeadFormDialog open={open} onOpenChange={setOpen} onSaved={(l) => router.push(`/leads/${l.id}`)} />
    </>
  );
}
