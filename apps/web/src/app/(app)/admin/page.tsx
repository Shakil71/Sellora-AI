'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Inbox, RotateCcw, Server, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PLAN_KEYS } from '@sellora/shared';
import { api, type Paginated } from '@/lib/api';
import { date, number, relative } from '@/lib/format';
import { useSession } from '@/components/session';
import { EmptyState, PageHeader, StatCard } from '@/components/shared/page';
import { DataTable, Pagination, SearchInput, Toolbar } from '@/components/shared/data-table';
import { Badge, Card, CardContent, CardHeader, CardTitle, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';
import { useListState } from '@/hooks/use-list-state';

interface Overview {
  tenants: number;
  users: number;
  orders: number;
  messages: number;
  queues: Array<{ name: string; waiting?: number; active?: number; delayed?: number; failed?: number; completed?: number; workers?: number | null; error?: string }>;
}
interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  isDemo: boolean;
  subscription: { plan: string; status: string } | null;
  _count: { members: number; orders: number; conversations: number };
}
interface DeadJob {
  id: string;
  queue: string;
  jobName: string;
  error: string;
  attemptsMade: number;
  failedAt: string;
}

export default function AdminPage() {
  const qc = useQueryClient();
  const { me } = useSession();
  const list = useListState();
  const overview = useQuery({ queryKey: ['admin-overview'], queryFn: () => api.get<Overview>('/admin/overview'), enabled: me.user.isSuperAdmin, refetchInterval: 15_000 });
  const tenants = useQuery({ queryKey: ['admin-tenants', list.query], queryFn: () => api.get<Paginated<TenantRow>>('/admin/tenants', { ...list.query }), enabled: me.user.isSuperAdmin, placeholderData: (p) => p });
  const dead = useQuery({ queryKey: ['admin-dead'], queryFn: () => api.get<Paginated<DeadJob>>('/admin/dead-letter'), enabled: me.user.isSuperAdmin });
  const update = useMutation({
    mutationFn: (v: { id: string; plan?: string; status?: string }) => api.patch(`/admin/tenants/${v.id}`, { plan: v.plan, status: v.status }),
    onSuccess: () => {
      toast.success('Workspace updated');
      qc.invalidateQueries({ queryKey: ['admin-tenants'] });
    },
  });
  const retry = useMutation({ mutationFn: (id: string) => api.post(`/admin/dead-letter/${id}/retry`), onSuccess: () => { toast.success('Job re-queued'); qc.invalidateQueries({ queryKey: ['admin-dead'] }); } });
  const drop = useMutation({ mutationFn: (id: string) => api.delete(`/admin/dead-letter/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-dead'] }) });

  if (!me.user.isSuperAdmin) return <EmptyState title="Platform administrators only" description="You don't have access to this area." />;
  return (
    <>
      <PageHeader title="Platform admin" description="Workspaces, plans and background job health across the installation." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Workspaces" value={number(overview.data?.tenants)} loading={overview.isLoading} icon={Building2} />
        <StatCard label="Users" value={number(overview.data?.users)} loading={overview.isLoading} />
        <StatCard label="Orders" value={number(overview.data?.orders)} loading={overview.isLoading} />
        <StatCard label="Messages" value={number(overview.data?.messages)} loading={overview.isLoading} />
      </div>
      <Tabs defaultValue="tenants">
        <TabsList>
          <TabsTrigger value="tenants">Workspaces</TabsTrigger>
          <TabsTrigger value="queues">Queues</TabsTrigger>
          <TabsTrigger value="dead">Dead letter ({dead.data?.meta.total ?? 0})</TabsTrigger>
        </TabsList>
        <TabsContent value="tenants">
          <Toolbar>
            <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search workspaces" />
          </Toolbar>
          <DataTable
            rows={tenants.data?.items}
            loading={tenants.isLoading}
            empty={{ icon: Building2, title: 'No workspaces' }}
            mobileCard={(t) => (
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.subscription?.plan}</p>
                </div>
                <Badge variant={t.status === 'ACTIVE' ? 'success' : 'destructive'}>{t.status.toLowerCase()}</Badge>
              </div>
            )}
            columns={[
              { key: 'name', header: 'Workspace', cell: (t) => <span className="font-medium">{t.name} {t.isDemo && <Badge variant="warning">demo</Badge>}</span> },
              { key: 'created', header: 'Created', hideBelow: 'md', cell: (t) => <span className="text-muted-foreground">{date(t.createdAt)}</span> },
              { key: 'usage', header: 'Members / orders', hideBelow: 'lg', cell: (t) => <span className="tabular">{t._count.members} / {t._count.orders}</span> },
              {
                key: 'plan',
                header: 'Plan',
                cell: (t) => (
                  <Select value={t.subscription?.plan ?? 'FREE'} onValueChange={(plan) => update.mutate({ id: t.id, plan })}>
                    <SelectTrigger size="sm" className="w-32" aria-label={`Plan for ${t.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLAN_KEYS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                cell: (t) => (
                  <Button variant="outline" size="sm" onClick={() => update.mutate({ id: t.id, status: t.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' })}>
                    {t.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                  </Button>
                ),
              },
            ]}
            footer={tenants.data && <Pagination page={tenants.data.meta.page} totalPages={tenants.data.meta.totalPages} total={tenants.data.meta.total} onPage={list.setPage} label="workspaces" />}
          />
        </TabsContent>
        <TabsContent value="queues">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {overview.data?.queues.map((q) => (
              <Card key={q.name}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Server className="size-4" /> {q.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2 pt-3 text-sm">
                  {q.error ? (
                    <p className="col-span-2 text-destructive">{q.error}</p>
                  ) : (
                    <>
                      <span className="text-muted-foreground">Waiting</span><span className="text-right tabular">{q.waiting}</span>
                      <span className="text-muted-foreground">Active</span><span className="text-right tabular">{q.active}</span>
                      <span className="text-muted-foreground">Delayed</span><span className="text-right tabular">{q.delayed}</span>
                      <span className="text-muted-foreground">Failed</span><span className="text-right tabular">{q.failed}</span>
                      {q.workers !== null && (
                        <>
                          <span className="text-muted-foreground">Workers</span>
                          <span className={q.workers ? 'text-right text-success tabular' : 'text-right text-destructive tabular'}>{q.workers}</span>
                        </>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="dead">
          <Card>
            {!dead.data?.items.length ? (
              <EmptyState icon={Inbox} title="No failed jobs" description="Jobs that exhaust all retries are kept here for inspection and manual retry." />
            ) : (
              <ul className="divide-y">
                {dead.data.items.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm">
                        {j.queue} · {j.jobName}
                      </p>
                      <p className="line-clamp-2 text-xs text-destructive">{j.error}</p>
                      <p className="text-xs text-muted-foreground">
                        {j.attemptsMade} attempts · failed {relative(j.failedAt)}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => retry.mutate(j.id)}>
                      <RotateCcw /> Retry
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Discard job" onClick={() => drop.mutate(j.id)}>
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
