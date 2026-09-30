'use client';

import { useQuery } from '@tanstack/react-query';
import { Bot, Clock, MessagesSquare, Timer, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import { duration, number } from '@/lib/format';
import { CONVERSATION_STATUS } from '@/lib/status';
import { ErrorState, PageHeader, StatCard } from '@/components/shared/page';
import { BarList, TimeSeriesCard } from '@/components/shared/charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { RangePicker, useRange } from '@/features/analytics/range';

interface ConvAnalytics {
  summary: { total: number; ai: number; human: number; handoffs: number; avgFirstResponseSeconds: number | null; avgResolutionSeconds: number | null };
  byStatus: Array<{ status: string; count: number }>;
  series: Array<{ date: string; inbound: number; outbound: number }>;
}

export default function ConversationAnalyticsPage() {
  const [range, setRange] = useRange();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['analytics', 'conversations', range], queryFn: () => api.get<ConvAnalytics>('/analytics/conversations', { range }) });
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const s = data?.summary;
  return (
    <>
      <PageHeader title="Conversation analytics" description="Volume, AI vs human handling and how fast customers get answers." actions={<RangePicker value={range} onChange={setRange} />} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Conversations" icon={MessagesSquare} loading={isLoading} value={number(s?.total)} />
        <StatCard label="Started with AI" icon={Bot} tone="ai" loading={isLoading} value={number(s?.ai)} hint={s?.total ? `${Math.round(((s.ai ?? 0) / s.total) * 100)}%` : undefined} />
        <StatCard label="Human only" icon={UserRound} loading={isLoading} value={number(s?.human)} hint={`${s?.handoffs ?? 0} handoffs`} />
        <StatCard label="Avg. first response" icon={Clock} loading={isLoading} value={duration(s?.avgFirstResponseSeconds)} />
        <StatCard label="Avg. resolution" icon={Timer} loading={isLoading} value={duration(s?.avgResolutionSeconds)} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <TimeSeriesCard
          className="xl:col-span-2"
          title="Messages"
          description="Inbound from customers vs replies from your team and AI"
          loading={isLoading}
          data={data?.series}
          series={[
            { key: 'inbound', label: 'Inbound', color: 'chart-1' },
            { key: 'outbound', label: 'Replies', color: 'chart-2' },
          ]}
        />
        <Card>
          <CardHeader>
            <CardTitle>By status</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <BarList loading={isLoading} items={(data?.byStatus ?? []).map((x) => ({ label: CONVERSATION_STATUS[x.status]?.label ?? x.status, value: x.count }))} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
