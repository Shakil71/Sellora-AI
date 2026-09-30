'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, History, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { date, money, relative } from '@/lib/format';
import { LEAD_STATUS, TASK_STATUS } from '@/lib/status';
import type { Lead } from '@/lib/types';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { DetailRow, EmptyState, ErrorState, PageHeader, PageSkeleton, StatusBadge } from '@/components/shared/page';
import { Badge, Card, CardContent, CardHeader, CardTitle, Input, Progress, Switch, Label } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/overlays';
import { LeadFormDialog } from '@/features/leads/lead-form';
import { ActivityTimeline } from '@/features/activity-timeline';
import { Field, MoneyInput } from '@/components/shared/form';

type Detail = Lead & {
  deals: Array<{ id: string; name: string; amount: string; pipelineId: string; stage: { name: string; color: string | null } }>;
  tasks: Array<{ id: string; title: string; status: string; dueDate: string | null }>;
  activity: Array<{ id: string; type: string; description: string; actorName: string | null; createdAt: string }>;
};

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can, currency } = useSession();
  const [edit, setEdit] = React.useState(false);
  const [convertOpen, setConvertOpen] = React.useState(false);
  const [createDeal, setCreateDeal] = React.useState(true);
  const [dealAmount, setDealAmount] = React.useState<number | null>(null);
  const [dealName, setDealName] = React.useState('');
  const { data: l, isLoading, error, refetch } = useQuery({ queryKey: ['lead', id], queryFn: () => api.get<Detail>(`/leads/${id}`) });

  const setStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/leads/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead', id] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
  const convert = useMutation({
    mutationFn: () => api.post<{ customerId: string; dealId?: string }>(`/leads/${id}/convert`, { createDeal, dealName: dealName || undefined, amount: dealAmount ?? undefined }),
    onSuccess: (r) => {
      toast.success('Lead converted');
      setConvertOpen(false);
      qc.invalidateQueries({ queryKey: ['lead', id] });
      router.push(`/customers/${r.customerId}`);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/leads/${id}`),
    onSuccess: () => {
      toast.success('Lead deleted');
      qc.invalidateQueries({ queryKey: ['leads'] });
      router.push('/leads');
    },
  });

  if (isLoading) return <PageSkeleton />;
  if (error || !l) return <ErrorState error={error} onRetry={() => refetch()} />;
  const statuses = Object.keys(LEAD_STATUS);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Leads', href: '/leads' }, { label: l.name }]}
        title={l.name}
        description={l.company ?? l.source ?? undefined}
        actions={
          <>
            {can(['crm.leads.update', 'contacts.create']) && !l.customerId && (
              <Button
                onClick={() => {
                  setDealName(`${l.company ?? l.name} deal`);
                  setDealAmount(l.value ? Number(l.value) : null);
                  setConvertOpen(true);
                }}
              >
                <ArrowRightLeft /> Convert
              </Button>
            )}
            {can('crm.leads.update') && (
              <Button variant="outline" onClick={() => setEdit(true)}>
                <Pencil /> Edit
              </Button>
            )}
            {can('crm.leads.delete') && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete lead"
                onClick={async () => (await confirm({ title: 'Delete this lead?', destructive: true, confirmLabel: 'Delete' })) && remove.mutate()}
              >
                <Trash2 />
              </Button>
            )}
          </>
        }
      />
      <Card className="mb-4 p-3">
        <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">Stage</p>
        <div className="flex gap-1 overflow-x-auto scrollbar-thin" role="radiogroup" aria-label="Lead status">
          {statuses.map((s) => {
            const active = l.status === s;
            return (
              <button
                key={s}
                role="radio"
                aria-checked={active}
                disabled={!can('crm.leads.update') || setStatus.isPending}
                onClick={() => setStatus.mutate(s)}
                className={`h-8 shrink-0 rounded-md px-3 text-xs font-medium transition-colors ${
                  active ? (s === 'LOST' ? 'bg-muted text-foreground' : s === 'WON' ? 'bg-success text-white' : 'bg-primary text-primary-foreground') : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
              >
                {LEAD_STATUS[s]!.label}
              </button>
            );
          })}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <DetailRow label="Status">
                <StatusBadge map={LEAD_STATUS} value={l.status} />
              </DetailRow>
              <DetailRow label="Score">
                <span className="flex items-center justify-end gap-2">
                  <Progress value={l.score} className="h-1.5 w-20" /> {l.score}
                </span>
              </DetailRow>
              <DetailRow label="Value">{l.value ? money(l.value, currency) : '—'}</DetailRow>
              <DetailRow label="Email">{l.email ?? '—'}</DetailRow>
              <DetailRow label="Phone">{l.phone ?? '—'}</DetailRow>
              <DetailRow label="Source">{l.source ?? '—'}</DetailRow>
              <DetailRow label="Owner">{l.assignedUser?.name ?? 'Unassigned'}</DetailRow>
              <DetailRow label="Customer">{l.customer ? <Link className="text-primary hover:underline" href={`/customers/${l.customer.id}`}>{l.customer.name}</Link> : '—'}</DetailRow>
              <DetailRow label="Created">{date(l.createdAt)}</DetailRow>
              <DetailRow label="Last activity">{relative(l.lastActivityAt)}</DetailRow>
            </dl>
            {l.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {l.tags.map((t) => (
                  <Badge key={t} variant="secondary">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
            {l.notes && <p className="mt-3 rounded-lg bg-muted/60 p-3 text-sm whitespace-pre-line">{l.notes}</p>}
          </CardContent>
        </Card>
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Deals</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              {!l.deals.length ? (
                <p className="text-sm text-muted-foreground">No deals yet. Converting the lead can create one in your pipeline.</p>
              ) : (
                <ul className="space-y-2">
                  {l.deals.map((d) => (
                    <li key={d.id}>
                      <Link href={`/pipelines?pipeline=${d.pipelineId}`} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/40">
                        <span className="truncate">{d.name}</span>
                        <span className="flex items-center gap-2">
                          <Badge variant="outline">{d.stage.name}</Badge>
                          <span className="font-medium tabular">{money(d.amount, currency)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tasks</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              {!l.tasks.length ? (
                <p className="text-sm text-muted-foreground">No tasks for this lead.</p>
              ) : (
                <ul className="space-y-2">
                  {l.tasks.map((t) => (
                    <li key={t.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                      <span>{t.title}</span>
                      <StatusBadge map={TASK_STATUS} value={t.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>{l.activity.length ? <ActivityTimeline items={l.activity} /> : <EmptyState compact icon={History} title="No activity yet" />}</CardContent>
          </Card>
        </div>
      </div>
      <LeadFormDialog open={edit} onOpenChange={setEdit} lead={l} />
      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert lead</DialogTitle>
            <DialogDescription>Creates a customer from this lead and optionally opens a deal in your default pipeline.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="create-deal">Create a deal</Label>
              <Switch id="create-deal" checked={createDeal} onCheckedChange={setCreateDeal} />
            </div>
            {createDeal && (
              <>
                <Field label="Deal name" htmlFor="deal-name">
                  <Input id="deal-name" value={dealName} onChange={(e) => setDealName(e.target.value)} />
                </Field>
                <Field label="Amount" htmlFor="deal-amount">
                  <MoneyInput id="deal-amount" currency={currency} value={dealAmount} onChange={setDealAmount} />
                </Field>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => convert.mutate()} loading={convert.isPending}>
              Convert lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
