'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, Inbox, RotateCcw, Server, Trash2, Wallet, X } from 'lucide-react';
import { toast } from 'sonner';
import { PLAN_KEYS } from '@sellora/shared';
import { api, type Paginated } from '@/lib/api';
import { date, money, number, relative } from '@/lib/format';
import { useSession } from '@/components/session';
import { EmptyState, PageHeader, StatCard } from '@/components/shared/page';
import { Field } from '@/components/shared/form';
import { DataTable, Pagination, SearchInput, Toolbar } from '@/components/shared/data-table';
import { Badge, Card, CardContent, CardHeader, CardTitle, Input, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@/components/ui/primitives';
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

interface PlanPaymentRow {
  id: string;
  plan: string;
  amount: string;
  currency: string;
  method: string;
  reference: string;
  note: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote: string | null;
  createdAt: string;
  tenant: { id: string; name: string; email: string | null };
}
interface BillingSettings {
  currency: string;
  prices: Record<string, number>;
  instructions: string;
}
const PAID_PLANS = ['STARTER', 'PRO', 'BUSINESS'];

function PlanPayments() {
  const qc = useQueryClient();
  const [status, setStatus] = React.useState<'PENDING' | 'ALL'>('PENDING');
  const { data, isLoading } = useQuery({
    queryKey: ['admin-plan-payments', status],
    queryFn: () => api.get<Paginated<PlanPaymentRow> & { pending: number }>('/admin/plan-payments', { pageSize: 50, ...(status === 'PENDING' ? { status: 'PENDING' } : {}) }),
  });
  const review = useMutation({
    mutationFn: (v: { id: string; action: 'approve' | 'reject'; note?: string }) => api.post(`/admin/plan-payments/${v.id}/${v.action}`, { note: v.note }),
    onSuccess: (_r, v) => {
      toast.success(v.action === 'approve' ? 'Payment approved. The plan is active.' : 'Payment rejected');
      qc.invalidateQueries({ queryKey: ['admin-plan-payments'] });
      qc.invalidateQueries({ queryKey: ['admin-tenants'] });
    },
  });
  const settings = useQuery({ queryKey: ['admin-billing-settings'], queryFn: () => api.get<BillingSettings>('/admin/billing-settings') });
  const [form, setForm] = React.useState<BillingSettings | null>(null);
  React.useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => api.put('/admin/billing-settings', form),
    onSuccess: () => {
      toast.success('Billing settings saved');
      qc.invalidateQueries({ queryKey: ['admin-billing-settings'] });
    },
  });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>How customers pay you</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <p className="text-sm text-muted-foreground">
            Add your bKash, Nagad or bank details and monthly prices. Customers see this on their Billing page, pay you, and submit the transaction ID for you to confirm below.
          </p>
          {form && (
            <>
              <Field label="Payment instructions" htmlFor="bs-ins" hint="Leave empty to turn manual plan payments off.">
                <Textarea id="bs-ins" rows={4} maxLength={2000} placeholder={'bKash Personal: 01XXXXXXXXX\nBank: ___, A/C ___'} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Currency" htmlFor="bs-cur">
                  <Input id="bs-cur" value={form.currency} maxLength={3} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
                </Field>
                {PAID_PLANS.map((p) => (
                  <Field key={p} label={`${p} / month`} htmlFor={`bs-${p}`}>
                    <Input
                      id={`bs-${p}`}
                      type="number"
                      min={0}
                      value={form.prices[p] ?? ''}
                      onChange={(e) => {
                        const prices = { ...form.prices };
                        if (e.target.value) prices[p] = Number(e.target.value);
                        else delete prices[p];
                        setForm({ ...form, prices });
                      }}
                    />
                  </Field>
                ))}
              </div>
              <Button onClick={() => save.mutate()} loading={save.isPending}>
                Save billing settings
              </Button>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Plan payments
            <span className="flex gap-2">
              <Button size="sm" variant={status === 'PENDING' ? 'default' : 'outline'} onClick={() => setStatus('PENDING')}>
                Pending ({data?.pending ?? 0})
              </Button>
              <Button size="sm" variant={status === 'ALL' ? 'default' : 'outline'} onClick={() => setStatus('ALL')}>
                All
              </Button>
            </span>
          </CardTitle>
        </CardHeader>
        {isLoading ? null : !data?.items.length ? (
          <EmptyState icon={Wallet} title="No payments to review" description="When a customer submits a bKash, Nagad or bank payment it appears here." />
        ) : (
          <ul className="divide-y">
            {data.items.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {r.tenant.name} · {r.plan}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.method} · <span className="font-mono">{r.reference}</span> · {relative(r.createdAt)}
                    {r.note ? ` · “${r.note}”` : ''}
                  </p>
                </div>
                <span className="font-medium tabular">{money(r.amount, r.currency)}</span>
                {r.status === 'PENDING' ? (
                  <>
                    <Button size="sm" onClick={() => review.mutate({ id: r.id, action: 'approve' })} disabled={review.isPending}>
                      <Check /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={review.isPending}
                      onClick={() => {
                        const note = window.prompt('Reason shown to the customer (optional)') ?? undefined;
                        review.mutate({ id: r.id, action: 'reject', note: note || undefined });
                      }}
                    >
                      <X /> Reject
                    </Button>
                  </>
                ) : (
                  <Badge variant={r.status === 'APPROVED' ? 'success' : 'destructive'}>{r.status.toLowerCase()}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
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
          <TabsTrigger value="payments">Plan payments</TabsTrigger>
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
        <TabsContent value="payments">
          <PlanPayments />
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
