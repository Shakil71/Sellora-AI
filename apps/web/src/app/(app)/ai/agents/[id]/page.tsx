'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { money, number } from '@/lib/format';
import { ErrorState, PageHeader, PageSkeleton, StatCard } from '@/components/shared/page';
import { AgentEditor, type AgentDetail } from '@/features/ai/agent-editor';
import { AiNotConfigured } from '@/features/ai/ai-not-configured';

export default function AgentPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['ai-agent', id], queryFn: () => api.get<AgentDetail>(`/ai/agents/${id}`) });
  const list = useQuery({ queryKey: ['ai-agents'], queryFn: () => api.get<{ aiConfigured: boolean }>('/ai/agents') });
  if (isLoading) return <PageSkeleton />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'AI agents', href: '/ai/agents' }, { label: data.name }]} title={data.name} description={data.description ?? undefined} />
      {list.data && !list.data.aiConfigured && <AiNotConfigured />}
      {data.stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Conversations (30d)" value={number(data.stats.conversations30d)} tone="ai" />
          <StatCard label="Handoffs (30d)" value={number(data.stats.handoffs30d)} />
          <StatCard label="Tokens (30d)" value={number(data.stats.tokens30d)} />
          <StatCard label="Estimated cost (30d)" value={money(data.stats.cost30d, 'USD')} />
        </div>
      )}
      <AgentEditor agent={data} />
    </>
  );
}
