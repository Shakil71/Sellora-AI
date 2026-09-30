'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gauge, Wrench } from 'lucide-react';
import { AI_TOOLS } from '@sellora/shared';
import { api, type Paginated } from '@/lib/api';
import { dateTime, money, number, titleCase } from '@/lib/format';
import { TOOL_STATUS } from '@/lib/status';
import { PageHeader, StatCard, StatusBadge } from '@/components/shared/page';
import { BarList, TimeSeriesCard } from '@/components/shared/charts';
import { DataTable, FilterChips, Pagination, Toolbar } from '@/components/shared/data-table';
import { Card, CardContent, CardHeader, CardTitle, Progress } from '@/components/ui/primitives';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/overlays';
import { useListState } from '@/hooks/use-list-state';

interface Usage {
  totals: { requests: number; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCost: number };
  byPurpose: Array<{ purpose: string; requests: number; tokens: number; cost: number }>;
  byAgent: Array<{ agentId: string; name: string; requests: number; tokens: number; cost: number }>;
  daily: Array<{ day: string; tokens: number; cost: number; calls: number }>;
  tools: Array<{ tool: string; status: string; count: number }>;
  aiMessagesQuota?: { used: number; limit: number; percent: number };
}
interface ToolRun {
  id: string;
  toolName: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  durationMs: number;
  createdAt: string;
  agent: { id: string; name: string } | null;
  conversation: { id: string; customer: { name: string } } | null;
}

const label = (name: string) => AI_TOOLS.find((t) => t.name === name)?.label ?? name;

export default function AiUsagePage() {
  const [days, setDays] = React.useState('30');
  const [selected, setSelected] = React.useState<ToolRun | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['ai-usage', days], queryFn: () => api.get<Usage>('/ai/usage', { days }) });
  const list = useListState<{ status?: string }>();
  const runs = useQuery({ queryKey: ['tool-runs', list.query], queryFn: () => api.get<Paginated<ToolRun>>('/ai/tool-executions', { ...list.query, pageSize: 20 }), placeholderData: (p) => p });
  const toolTotals = Object.entries(
    (data?.tools ?? []).reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.tool]: (acc[t.tool] ?? 0) + t.count }), {}),
  ).sort((a, b) => b[1] - a[1]);
  const quota = data?.aiMessagesQuota;

  return (
    <>
      <PageHeader
        title="AI usage"
        description="Tokens, estimated cost and every tool call made by your AI agents. Costs are estimates based on configured per-token prices."
        actions={<FilterChips value={days} onChange={setDays} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="AI requests" value={number(data?.totals.requests)} loading={isLoading} tone="ai" icon={Gauge} />
        <StatCard label="Tokens" value={number(data?.totals.totalTokens)} loading={isLoading} hint={data ? `${number(data.totals.promptTokens)} in · ${number(data.totals.completionTokens)} out` : undefined} />
        <StatCard label="Estimated cost" value={money(data?.totals.estimatedCost ?? 0, 'USD')} loading={isLoading} />
        <StatCard
          label="AI messages this month"
          value={quota ? `${number(quota.used)}${quota.limit === -1 ? '' : ` / ${number(quota.limit)}`}` : '—'}
          loading={isLoading}
          hint={quota && quota.limit !== -1 ? <Progress value={quota.percent} className="h-1.5 w-24" aria-label="Quota used" /> : 'Unlimited'}
        />
      </div>
      <div className="mb-6 grid gap-4 xl:grid-cols-3">
        <TimeSeriesCard
          className="xl:col-span-2"
          title="Tokens per day"
          loading={isLoading}
          data={data?.daily.map((d) => ({ date: d.day, tokens: d.tokens }))}
          series={[{ key: 'tokens', label: 'Tokens', color: 'chart-2' }]}
          emptyText="Usage appears once your agents start replying."
        />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="size-4" /> Tool calls
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <BarList loading={isLoading} items={toolTotals.map(([tool, count]) => ({ label: label(tool), value: count }))} empty="No tool calls yet" />
          </CardContent>
        </Card>
      </div>
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By agent</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <BarList loading={isLoading} items={(data?.byAgent ?? []).map((a) => ({ label: a.name, value: a.tokens, secondary: money(a.cost, 'USD') }))} valueFormat={(v) => `${number(v)} tokens`} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By purpose</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <BarList loading={isLoading} items={(data?.byPurpose ?? []).map((p) => ({ label: titleCase(p.purpose), value: p.tokens, secondary: `${p.requests} calls` }))} valueFormat={(v) => `${number(v)} tokens`} />
          </CardContent>
        </Card>
      </div>
      <h2 className="mb-3 text-base font-semibold">Tool execution log</h2>
      <Toolbar>
        <FilterChips value={list.filters.status ?? 'ALL'} onChange={(v) => list.setFilter('status', v === 'ALL' ? undefined : v)} options={[{ value: 'ALL', label: 'All' }, ...Object.entries(TOOL_STATUS).map(([k, v]) => ({ value: k, label: v.label }))]} />
      </Toolbar>
      <DataTable
        rows={runs.data?.items}
        loading={runs.isLoading}
        onRowClick={setSelected}
        empty={{ icon: Wrench, title: 'No tool calls yet', description: 'Every action an AI agent takes is logged here.' }}
        mobileCard={(r) => (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium">{label(r.toolName)}</p>
              <p className="truncate text-xs text-muted-foreground">{r.conversation?.customer.name ?? 'Playground'} · {dateTime(r.createdAt)}</p>
            </div>
            <StatusBadge map={TOOL_STATUS} value={r.status} />
          </div>
        )}
        columns={[
          { key: 'when', header: 'When', cell: (r) => <span className="text-muted-foreground">{dateTime(r.createdAt)}</span> },
          { key: 'tool', header: 'Tool', cell: (r) => <span className="font-medium">{label(r.toolName)}</span> },
          { key: 'agent', header: 'Agent', hideBelow: 'md', cell: (r) => r.agent?.name ?? '—' },
          { key: 'customer', header: 'Customer', hideBelow: 'lg', cell: (r) => r.conversation?.customer.name ?? <span className="text-muted-foreground">Playground</span> },
          { key: 'status', header: 'Result', cell: (r) => <StatusBadge map={TOOL_STATUS} value={r.status} /> },
          { key: 'ms', header: 'Duration', align: 'right', hideBelow: 'md', cell: (r) => <span className="tabular text-muted-foreground">{r.durationMs} ms</span> },
        ]}
        footer={runs.data && <Pagination page={runs.data.meta.page} totalPages={runs.data.meta.totalPages} total={runs.data.meta.total} onPage={list.setPage} label="tool calls" />}
      />
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{selected && label(selected.toolName)}</SheetTitle>
          </SheetHeader>
          <SheetBody className="space-y-4">
            {selected?.error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{selected.error}</p>}
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Input</p>
              <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{JSON.stringify(selected?.input, null, 2)}</pre>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Output</p>
              <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{JSON.stringify(selected?.output, null, 2)}</pre>
            </div>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
