'use client';

import { useQuery } from '@tanstack/react-query';
import { AI_TOOLS } from '@sellora/shared';
import { ArrowRightLeft, Bot, CheckCircle2, Coins, MessageSquare, ShoppingBag, Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import { money, number } from '@/lib/format';
import { useSession } from '@/components/session';
import { ErrorState, PageHeader, StatCard } from '@/components/shared/page';
import { BarList, BarSeriesCard } from '@/components/shared/charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { RangePicker, useRange } from '@/features/analytics/range';

interface AiAnalytics {
  summary: {
    aiConversations: number;
    aiMessages: number;
    escalations: number;
    resolvedByAi: number;
    escalationRate: number;
    toolCalls: number;
    tokens: number;
    estimatedCost: number;
    aiOrders: number;
    aiRevenue: number;
  };
  tools: Array<{ tool: string; count: number }>;
  series: Array<{ date: string; messages: number }>;
}

export default function AiAnalyticsPage() {
  const { currency } = useSession();
  const [range, setRange] = useRange();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['analytics', 'ai', range], queryFn: () => api.get<AiAnalytics>('/analytics/ai', { range }) });
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const s = data?.summary;
  return (
    <>
      <PageHeader title="AI analytics" description="How much work your AI agents handle and what it costs." actions={<RangePicker value={range} onChange={setRange} />} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="AI conversations" icon={Bot} tone="ai" loading={isLoading} value={number(s?.aiConversations)} />
        <StatCard label="AI messages sent" icon={MessageSquare} loading={isLoading} value={number(s?.aiMessages)} />
        <StatCard label="Resolved by AI" icon={CheckCircle2} loading={isLoading} value={number(s?.resolvedByAi)} hint="without a human handoff" />
        <StatCard label="Escalations" icon={ArrowRightLeft} loading={isLoading} value={number(s?.escalations)} hint={`${s?.escalationRate ?? 0}% of AI conversations`} />
        <StatCard label="Orders placed by AI" icon={ShoppingBag} loading={isLoading} value={number(s?.aiOrders)} hint={money(s?.aiRevenue ?? 0, currency)} />
        <StatCard label="Tool calls" icon={Wrench} loading={isLoading} value={number(s?.toolCalls)} />
        <StatCard label="Tokens" icon={Coins} loading={isLoading} value={number(s?.tokens)} />
        <StatCard label="Estimated cost" icon={Coins} loading={isLoading} value={money(s?.estimatedCost ?? 0, 'USD')} hint="based on configured prices" />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <BarSeriesCard title="AI messages per day" loading={isLoading} data={data?.series} dataKey="messages" label="AI messages" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Most used tools</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <BarList loading={isLoading} items={(data?.tools ?? []).map((t) => ({ label: AI_TOOLS.find((x) => x.name === t.tool)?.label ?? t.tool, value: t.count }))} empty="No tool calls yet" />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
