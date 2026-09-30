'use client';

import { useQuery } from '@tanstack/react-query';
import { Percent, Target, Trophy, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { money, number } from '@/lib/format';
import { LEAD_STATUS } from '@/lib/status';
import { useSession } from '@/components/session';
import { ErrorState, PageHeader, StatCard } from '@/components/shared/page';
import { BarList, TimeSeriesCard } from '@/components/shared/charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { RangePicker, useRange } from '@/features/analytics/range';

interface CrmAnalytics {
  summary: { leads: number; won: number; lost: number; conversionRate: number; pipelineValue: number; weightedPipeline: number };
  series: Array<{ date: string; leads: number; won: number }>;
  byStatus: Array<{ status: string; count: number }>;
  bySource: Array<{ source: string; count: number }>;
  pipeline: Array<{ stage: string; color: string | null; deals: number; amount: number }>;
  deals: Array<{ status: string; count: number; amount: number }>;
}

export default function CrmAnalyticsPage() {
  const { currency } = useSession();
  const [range, setRange] = useRange();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['analytics', 'crm', range], queryFn: () => api.get<CrmAnalytics>('/analytics/crm', { range }) });
  const m = (v: number) => money(v, currency, { compact: true });
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const deal = (s: string) => data?.deals.find((d) => d.status === s);
  return (
    <>
      <PageHeader title="CRM analytics" description="Lead flow, conversion and the value of your open pipeline." actions={<RangePicker value={range} onChange={setRange} />} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="New leads" icon={Target} loading={isLoading} value={number(data?.summary.leads)} />
        <StatCard label="Lead conversion" icon={Percent} loading={isLoading} value={`${data?.summary.conversionRate ?? 0}%`} hint={`${data?.summary.won ?? 0} won · ${data?.summary.lost ?? 0} lost`} />
        <StatCard label="Open pipeline" icon={TrendingUp} loading={isLoading} value={m(data?.summary.pipelineValue ?? 0)} hint={`${m(data?.summary.weightedPipeline ?? 0)} weighted`} />
        <StatCard label="Deals won" icon={Trophy} loading={isLoading} value={m(deal('WON')?.amount ?? 0)} hint={`${deal('WON')?.count ?? 0} deals`} />
      </div>
      <div className="mb-4 grid gap-4 xl:grid-cols-5">
        <TimeSeriesCard
          className="xl:col-span-3"
          title="Leads created vs won"
          loading={isLoading}
          data={data?.series}
          series={[
            { key: 'leads', label: 'Leads', color: 'chart-1' },
            { key: 'won', label: 'Won', color: 'chart-2' },
          ]}
        />
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Pipeline by stage (default pipeline)</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <BarList loading={isLoading} items={(data?.pipeline ?? []).map((p) => ({ label: p.stage, value: p.amount, secondary: `${p.deals} deals` }))} valueFormat={m} empty="No open deals" />
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Leads by status</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <BarList loading={isLoading} items={(data?.byStatus ?? []).map((s) => ({ label: LEAD_STATUS[s.status]?.label ?? s.status, value: s.count }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Leads by source</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <BarList loading={isLoading} items={(data?.bySource ?? []).map((s) => ({ label: s.source, value: s.count }))} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
