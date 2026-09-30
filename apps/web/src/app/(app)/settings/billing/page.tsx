'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CreditCard, Info } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { date, number } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { PageHeader, PageSkeleton } from '@/components/shared/page';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Progress } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

interface Plan {
  key: string;
  name: string;
  description: string;
  monthlyPrice: number | null;
  highlighted?: boolean;
  features: string[];
  limits: Record<string, number>;
}
interface Billing {
  subscription: { plan: string; status: string; startDate: string; renewalDate: string | null; provider: string | null };
  plan: Plan;
  usage: { period: string; metrics: Array<{ metric: string; label: string; used: number; limit: number; percent: number; warning: boolean }> };
  plans: Plan[];
  paymentProvider: { key: string; label: string } | null;
}

export default function BillingPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can, refresh } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ['billing'], queryFn: () => api.get<Billing>('/billing') });
  React.useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('checkout');
    if (status === 'success') toast.success('Payment received — your plan will update in a moment.');
    if (status === 'cancelled') toast.info('Checkout cancelled.');
  }, []);
  const change = useMutation({
    mutationFn: (plan: string) => api.post<{ mode: 'updated' | 'checkout'; url?: string }>('/billing/change-plan', { plan }),
    onSuccess: (r) => {
      if (r.mode === 'checkout' && r.url) window.location.href = r.url;
      else {
        toast.success('Plan updated');
        qc.invalidateQueries({ queryKey: ['billing'] });
        refresh();
      }
    },
  });
  if (isLoading || !data) return <PageSkeleton />;
  const manage = can('billing.manage');
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Settings' }, { label: 'Billing' }]} title="Billing & usage" description={`Usage for ${data.usage.period}. Limits reset monthly for messages.`} />
      <div className="mb-6 grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Current plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-2xl font-semibold">{data.plan.name}</p>
              <Badge variant={data.subscription.status === 'ACTIVE' ? 'success' : 'warning'}>{data.subscription.status.toLowerCase()}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{data.plan.description}</p>
            <p className="text-sm">
              Since {date(data.subscription.startDate)}
              {data.subscription.renewalDate && ` · renews ${date(data.subscription.renewalDate)}`}
            </p>
            {!data.paymentProvider && (
              <p className="flex gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" /> Online payments are not configured on this server. Paid plans are assigned by the platform administrator.
              </p>
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
                <Progress value={m.limit === -1 ? 0 : m.percent} indicatorClassName={m.percent >= 100 ? 'bg-destructive' : m.warning ? 'bg-warning' : undefined} aria-label={`${m.label} used`} />
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
            <Card key={p.key} className={cn('flex flex-col', p.highlighted && 'border-primary/50 ring-1 ring-primary/20')}>
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
                  {p.monthlyPrice === null ? 'Custom' : `$${p.monthlyPrice}`}
                  {p.monthlyPrice !== null && <span className="text-sm font-normal text-muted-foreground"> /mo</span>}
                </p>
                <ul className="flex-1 space-y-1.5 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {f}
                    </li>
                  ))}
                </ul>
                {current ? (
                  <Button variant="outline" disabled>
                    Current plan
                  </Button>
                ) : manage && p.key !== 'ENTERPRISE' && (p.key === 'FREE' || data.paymentProvider) ? (
                  <Button
                    variant={p.highlighted ? 'default' : 'outline'}
                    loading={change.isPending && change.variables === p.key}
                    onClick={async () => {
                      if (p.key === 'FREE' && !(await confirm({ title: 'Downgrade to Free?', description: 'Features above the Free limits will be blocked until you upgrade again.', confirmLabel: 'Downgrade' }))) return;
                      change.mutate(p.key);
                    }}
                  >
                    <CreditCard /> {p.key === 'FREE' ? 'Downgrade' : 'Upgrade'}
                  </Button>
                ) : (
                  <Button variant="outline" disabled>
                    {p.key === 'ENTERPRISE' ? 'Contact sales' : 'Ask your administrator'}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
