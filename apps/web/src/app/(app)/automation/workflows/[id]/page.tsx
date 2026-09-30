'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { ErrorState } from '@/components/shared/page';
import { Skeleton } from '@/components/ui/primitives';
import type { WorkflowDetail } from '@/features/automation/workflow-builder';

// React Flow is heavy; load the builder only on this route.
const WorkflowBuilder = dynamic(() => import('@/features/automation/workflow-builder').then((m) => m.WorkflowBuilder), {
  ssr: false,
  loading: () => <Skeleton className="m-6 h-[70vh] rounded-xl" />,
});

export default function WorkflowPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  React.useEffect(() => {
    if (id === 'new') router.replace('/automation/workflows?new=1');
  }, [id, router]);
  if (id === 'new') return null;
  return <WorkflowLoader id={id} />;
}

function WorkflowLoader({ id }: { id: string }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['workflow', id], queryFn: () => api.get<WorkflowDetail>(`/workflows/${id}`) });
  if (isLoading) return <Skeleton className="m-6 h-[70vh] rounded-xl" />;
  if (error || !data)
    return (
      <div className="p-6">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  return <WorkflowBuilder key={`${data.id}-${data.status}`} workflow={data} />;
}
