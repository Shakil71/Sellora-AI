'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { AlertTriangle, ArrowRightLeft, Check, Clock, CreditCard, Info, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { date, money, number } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { PageHeader, PageSkeleton } from '@/components/shared/page';
import { Field } from '@/components/shared/form';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Progress,
  Textarea,
} from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';

interface Plan {
  key: string;
  name: string;
  description: string;
  monthlyPrice: number | null;
  highlighted?: boolean;
  features: string[];
  limits: Record<string, number>;
}
interface PlanPayment {
  id: string;
  plan: string;
  amount: string;
  currency: string;
  method: string;
  reference: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote: string | null;
  createdAt: string;
}
interface Billing {
  subscription: {
    plan: string;
    status: string;
    startDate: string;
    renewalDate: string | null;
    provider: string | null;
    lapsed: boolean;
  };
  manualPayment: {
    enabled: boolean;
    instructions: string;
    currency: string;
    prices: Record<string, number | null>;
    pending: PlanPayment | null;
    recent: PlanPayment[];
  };
  plan: Plan;
  usage: {
    period: string;
    metrics: Array<{
      metric: string;
      label: string;
      used: number;
      limit: number;
      percent: number;
      warning: boolean;
    }>;
  };
  plans: Plan[];
  paymentProvider: { key: string; label: string } | null;
}

export default function BillingPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can, refresh, me } = useSession();
  const isPlatformAdmin = me.user.isSuperAdmin;
  const { data, isLoading } = useQuery({
    queryKey: ['billing'],
    queryFn: () => api.get<Billing>('/billing'),
  });
  React.useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('checkout');
    if (status === 'success')
      toast.success('Payment received — your plan will update in a moment.');
    if (status === 'cancelled') toast.info('Checkout cancelled.');
  }, []);
  const [pay, setPay] = React.useState<{ plan: Plan } | null>(null);
  const [payForm, setPayForm] = React.useState({ method: '', reference: '', note: '' });
  const submitPay = useMutation({
    mutationFn: () =>
      api.post('/billing/payments', {
        plan: pay!.plan.key,
        method: payForm.method,
        reference: payForm.reference,
        note: payForm.note || undefined,
      }),
    onSuccess: () => {
      toast.success('Thanks! We will confirm your payment and activate the plan shortly.');
      setPay(null);
      setPayForm({ method: '', reference: '', note: '' });
      qc.invalidateQueries({ queryKey: ['billing'] });
    },
  });
  const change = useMutation({
    mutationFn: (plan: string) =>
      api.post<{ mode: 'updated' | 'checkout'; url?: string }>('/billing/change-plan', { plan }),
    onSuccess: (r) => {
      if (r.mode === 'checkout' && r.url) window.location.href = r.url;
      else {
        toast.success('Plan updated');
        qc.invalidateQueries({ queryKey: ['billing'] });
        refresh();
      }
    },
  });
  /** Platform administrators assign any plan directly, no payment needed. */
  const assign = useMutation({
    mutationFn: (plan: string) => api.patch(`/admin/tenants/${me.workspace!.id}`, { plan }),
    onSuccess: (_r, plan) => {
      toast.success(
        `${me.workspace!.name} is now on the ${data?.plans.find((p) => p.key === plan)?.name ?? plan} plan`,
      );
      qc.invalidateQueries({ queryKey: ['billing'] });
      refresh();
    },
    // Errors are shown once by the global mutation handler.
  });
  if (isLoading || !data) return <PageSkeleton />;
  const manage = can('billing.manage');
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Settings' }, { label: 'Billing' }]}
        title="Billing & usage"
        description={`Usage for ${data.usage.period}. Limits reset monthly for messages.`}
      />
      <div className="mb-6 grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Current plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-2xl font-semibold">{data.plan.name}</p>
              <Badge variant={data.subscription.status === 'ACTIVE' ? 'success' : 'warning'}>
                {data.subscription.status.toLowerCase()}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{data.plan.description}</p>
            <p className="text-sm">
              Since {date(data.subscription.startDate)}
              {data.subscription.renewalDate && ` · renews ${date(data.subscription.renewalDate)}`}
            </p>
            {data.subscription.lapsed && (
              <p className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Your {data.plan.name} plan has
                expired, so Free limits apply. Renew below to restore it.
              </p>
            )}
            {data.manualPayment.pending && (
              <p className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
                <Clock className="mt-0.5 size-3.5 shrink-0" /> Waiting for confirmation of your{' '}
                {data.manualPayment.pending.method} payment ({data.manualPayment.pending.reference}).
              </p>
            )}
            {isPlatformAdmin ? (
              <div className="space-y-2 rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs">
                <p className="flex gap-2 font-medium text-foreground">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" /> You are the
                  platform administrator.
                </p>
                <p className="text-muted-foreground">
                  Switch this workspace to any plan below without payment. To change other
                  businesses&apos; plans, use Platform admin.
                </p>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/admin">Open Platform admin</Link>
                </Button>
              </div>
            ) : (
              !data.paymentProvider &&
              !data.manualPayment.enabled && (
                <p className="flex gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" /> Online payments are not set up yet.
                  To upgrade, contact the platform administrator; they will switch your plan after
                  payment.
                </p>
              )
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
            {data.usage.metrics.map((m) => (
              <div key={m.metric}>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span>{m.label}</span>
                  <span className={cn('tabular', m.warning && 'font-medium text-warning')}>
                    {number(m.used)} {m.limit === -1 ? '' : `/ ${number(m.limit)}`}
                  </span>
                </div>
                <Progress
                  value={m.limit === -1 ? 0 : m.percent}
                  indicatorClassName={
                    m.percent >= 100 ? 'bg-destructive' : m.warning ? 'bg-warning' : undefined
                  }
                  aria-label={`${m.label} used`}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <h2 className="mb-3 text-base font-semibold">Plans</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {data.plans.map((p) => {
          const current = p.key === data.subscription.plan;
          return (
            <Card
              key={p.key}
              className={cn(
                'flex flex-col',
                p.highlighted && 'border-primary/50 ring-1 ring-primary/20',
              )}
            >
              <CardHeader>
                <div className="w-full">
                  <CardTitle className="flex items-center justify-between">
                    {p.name}
                    {p.highlighted && <Badge>Popular</Badge>}
                  </CardTitle>
                  <CardDescription className="mt-1">{p.description}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <p className="text-2xl font-semibold">
                  {p.monthlyPrice === null
                    ? 'Custom'
                    : data.manualPayment.enabled && data.manualPayment.prices[p.key]
                      ? money(data.manualPayment.prices[p.key]!, data.manualPayment.currency)
                      : `$${p.monthlyPrice}`}
                  {p.monthlyPrice !== null && (
                    <span className="text-sm font-normal text-muted-foreground"> /mo</span>
                  )}
                </p>
                <ul className="flex-1 space-y-1.5 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {f}
                    </li>
                  ))}
                </ul>
                {current && !isPlatformAdmin && manage && data.manualPayment.enabled && !data.paymentProvider && p.key !== 'FREE' && !data.manualPayment.pending && (data.subscription.lapsed || !data.subscription.renewalDate || new Date(data.subscription.renewalDate).getTime() - Date.now() < 7 * 86_400_000) ? (
                  <Button onClick={() => setPay({ plan: p })}>
                    <CreditCard /> Renew
                  </Button>
                ) : current ? (
                  <Button variant="outline" disabled>
                    Current plan
                  </Button>
                ) : isPlatformAdmin ? (
                  <Button
                    variant={p.highlighted ? 'default' : 'outline'}
                    loading={assign.isPending && assign.variables === p.key}
                    disabled={assign.isPending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Switch to ${p.name}?`,
                        description: `${me.workspace!.name} moves to the ${p.name} plan immediately. No payment is taken.`,
                        confirmLabel: `Switch to ${p.name}`,
                      });
                      if (ok) assign.mutate(p.key);
                    }}
                  >
                    <ArrowRightLeft /> Switch to {p.name}
                  </Button>
                ) : manage &&
                  p.key !== 'ENTERPRISE' &&
                  (p.key === 'FREE' || data.paymentProvider) ? (
                  <Button
                    variant={p.highlighted ? 'default' : 'outline'}
                    loading={change.isPending && change.variables === p.key}
                    onClick={async () => {
                      if (
                        p.key === 'FREE' &&
                        !(await confirm({
                          title: 'Downgrade to Free?',
                          description:
                            'Features above the Free limits will be blocked until you upgrade again.',
                          confirmLabel: 'Downgrade',
                        }))
                      )
                        return;
                      change.mutate(p.key);
                    }}
                  >
                    <CreditCard /> {p.key === 'FREE' ? 'Downgrade' : 'Upgrade'}
                  </Button>
                ) : manage && p.key !== 'ENTERPRISE' && p.key !== 'FREE' && data.manualPayment.enabled && data.manualPayment.prices[p.key] ? (
                  <Button
                    variant={p.highlighted ? 'default' : 'outline'}
                    disabled={Boolean(data.manualPayment.pending)}
                    onClick={() => setPay({ plan: p })}
                  >
                    <CreditCard /> Pay &amp; upgrade
                  </Button>
                ) : (
                  <Button variant="outline" disabled>
                    {p.key === 'ENTERPRISE' ? 'Contact sales' : 'Contact admin to upgrade'}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {data.manualPayment.recent.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Plan payments</CardTitle>
          </CardHeader>
          <CardContent className="divide-y pt-2">
            {data.manualPayment.recent.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="font-medium">{r.plan}</span>
                <span className="text-muted-foreground">
                  {r.method} · {r.reference} · {date(r.createdAt)}
                </span>
                {r.reviewNote && <span className="text-xs text-muted-foreground">“{r.reviewNote}”</span>}
                <span className="ml-auto tabular">{money(r.amount, r.currency)}</span>
                <Badge variant={r.status === 'APPROVED' ? 'success' : r.status === 'REJECTED' ? 'destructive' : 'warning'}>
                  {r.status.toLowerCase()}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <Dialog open={Boolean(pay)} onOpenChange={(o) => !o && setPay(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pay for the {pay?.plan.name} plan</DialogTitle>
            <DialogDescription>
              Send {pay && data.manualPayment.prices[pay.plan.key] ? money(data.manualPayment.prices[pay.plan.key]!, data.manualPayment.currency) : 'the plan price'}{' '}
              using the details below, then enter the transaction ID. We activate your plan for one month once we confirm it.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-lg border bg-muted/50 p-3 text-sm whitespace-pre-line">{data.manualPayment.instructions}</p>
          <Field label="Paid with" htmlFor="pp-method" required hint="For example bKash, Nagad, Rocket or Bank transfer.">
            <Input id="pp-method" value={payForm.method} maxLength={40} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })} />
          </Field>
          <Field label="Transaction ID" htmlFor="pp-ref" required>
            <Input id="pp-ref" value={payForm.reference} maxLength={60} className="font-mono" onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} />
          </Field>
          <Field label="Note (optional)" htmlFor="pp-note">
            <Textarea id="pp-note" rows={2} maxLength={500} value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPay(null)}>
              Cancel
            </Button>
            <Button onClick={() => submitPay.mutate()} loading={submitPay.isPending} disabled={payForm.method.trim().length < 2 || payForm.reference.trim().length < 4}>
              Submit payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
