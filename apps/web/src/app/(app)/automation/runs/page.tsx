'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { WORKFLOW_TRIGGERS } from '@sellora/shared';
import { api, type Paginated } from '@/lib/api';
import { dateTime, relative } from '@/lib/format';
import { RUN_STATUS } from '@/lib/status';
import { PageHeader, StatusBadge } from '@/components/shared/page';
import { DataTable, FilterChips, Pagination, Toolbar } from '@/components/shared/data-table';
import { useListState } from '@/hooks/use-list-state';

interface Run {
  id: string;
  status: string;
  triggerType: string;
  error: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  workflow: { id: string; name: string };
  _count: { steps: number };
}

export default function RunsPage() {
  const router = useRouter();
  const list = useListState<{ status?: string; workflowId?: string }>({}, ['workflowId', 'status']);
  const { data, isLoading } = useQuery({
    queryKey: ['workflow-runs', list.query],
    queryFn: () => api.get<Paginated<Run> & { statusCounts: Record<string, number> }>('/workflows/runs', { ...list.query, pageSize: 25 }),
    placeholderData: (p) => p,
    refetchInterval: 10_000,
  });
  const counts = data?.statusCounts ?? {};
  return (
    <>
      <PageHeader title="Workflow runs" description="Every execution with step-by-step logs. Failed runs are retried automatically and can be retried manually." />
      <Toolbar>
        <FilterChips
          value={list.filters.status ?? 'ALL'}
          onChange={(v) => list.setFilter('status', v === 'ALL' ? undefined : v)}
          options={[{ value: 'ALL', label: 'All' }, ...Object.entries(RUN_STATUS).map(([k, v]) => ({ value: k, label: v.label, count: counts[k] ?? 0 }))]}
        />
      </Toolbar>
      <DataTable
        rows={data?.items}
        loading={isLoading}
        onRowClick={(r) => router.push(`/automation/runs/${r.id}`)}
        empty={{ icon: Play, title: 'No runs yet', description: 'Runs appear when an active workflow is triggered or run manually.' }}
        mobileCard={(r) => (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{r.workflow.name}</p>
              <p className="text-xs text-muted-foreground">{relative(r.createdAt)}</p>
            </div>
            <StatusBadge map={RUN_STATUS} value={r.status} />
          </div>
        )}
        columns={[
          { key: 'workflow', header: 'Workflow', cell: (r) => <span className="font-medium">{r.workflow.name}</span> },
          { key: 'trigger', header: 'Trigger', hideBelow: 'md', cell: (r) => <span className="text-muted-foreground">{WORKFLOW_TRIGGERS.find((t) => t.key === r.triggerType)?.label ?? r.triggerType}</span> },
          { key: 'started', header: 'Started', cell: (r) => <span className="text-muted-foreground">{dateTime(r.startedAt ?? r.createdAt)}</span> },
          { key: 'steps', header: 'Steps', align: 'right', hideBelow: 'lg', cell: (r) => <span className="tabular">{r._count.steps}</span> },
          { key: 'status', header: 'Status', cell: (r) => <StatusBadge map={RUN_STATUS} value={r.status} /> },
          { key: 'error', header: 'Error', hideBelow: 'lg', cell: (r) => <span className="line-clamp-1 max-w-xs text-xs text-destructive">{r.error ?? ''}</span> },
        ]}
        footer={data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={list.setPage} label="runs" />}
      />
    </>
  );
}
