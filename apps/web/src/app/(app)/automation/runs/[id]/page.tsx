'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, RotateCcw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { WORKFLOW_ACTIONS, WORKFLOW_CONDITIONS, WORKFLOW_TRIGGERS } from '@sellora/shared';
import { api } from '@/lib/api';
import { dateTime, duration } from '@/lib/format';
import { RUN_STATUS } from '@/lib/status';
import { useSession } from '@/components/session';
import { DetailRow, ErrorState, PageHeader, PageSkeleton, StatusBadge } from '@/components/shared/page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

interface RunDetail {
  id: string;
  status: string;
  triggerType: string;
  triggerPayload: Record<string, unknown>;
  error: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  workflow: { id: string; name: string; nodes: Array<{ key: string; label: string | null; subtype: string; type: string }> };
  steps: Array<{ id: string; nodeKey: string; nodeType: string; subtype: string; status: string; output: unknown; error: string | null; startedAt: string; finishedAt: string }>;
}

const labelOf = (type: string, subtype: string) =>
  [...WORKFLOW_TRIGGERS, ...WORKFLOW_CONDITIONS, ...WORKFLOW_ACTIONS].find((i) => i.key === subtype)?.label ?? `${type.toLowerCase()} ${subtype}`;

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useSession();
  const { data: run, isLoading, error, refetch } = useQuery({
    queryKey: ['workflow-run', id],
    queryFn: () => api.get<RunDetail>(`/workflows/runs/${id}`),
    refetchInterval: (q) => (['QUEUED', 'RUNNING', 'WAITING'].includes(q.state.data?.status ?? '') ? 3000 : false),
  });
  const retry = useMutation({
    mutationFn: () => api.post(`/workflows/runs/${id}/retry`),
    onSuccess: () => {
      toast.success('Retry queued');
      qc.invalidateQueries({ queryKey: ['workflow-run', id] });
    },
  });
  if (isLoading) return <PageSkeleton />;
  if (error || !run) return <ErrorState error={error} onRetry={() => refetch()} />;
  const total = run.startedAt && run.finishedAt ? (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000 : null;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Workflow runs', href: '/automation/runs' }, { label: run.workflow.name }]}
        title={
          <span className="flex items-center gap-2">
            Run of {run.workflow.name} <StatusBadge map={RUN_STATUS} value={run.status} />
          </span>
        }
        description={dateTime(run.createdAt)}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/automation/workflows/${run.workflow.id}`}>Open workflow</Link>
            </Button>
            {can('automation.execute') && run.status === 'FAILED' && (
              <Button onClick={() => retry.mutate()} loading={retry.isPending}>
                <RotateCcw /> Retry
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Steps</CardTitle>
          </CardHeader>
          <CardContent>
            {run.error && <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{run.error}</p>}
            {!run.steps.length ? (
              <p className="text-sm text-muted-foreground">{['QUEUED', 'RUNNING'].includes(run.status) ? 'Waiting for the worker to pick up this run…' : 'No steps were executed (the trigger conditions did not lead to any step).'}</p>
            ) : (
              <ol className="space-y-3">
                {run.steps.map((s) => (
                  <li key={s.id} className="flex gap-3">
                    {s.status === 'SUCCEEDED' ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" /> : s.status === 'FAILED' ? <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" /> : <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" />}
                    <div className="min-w-0 flex-1 rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">{run.workflow.nodes.find((n) => n.key === s.nodeKey)?.label || labelOf(s.nodeType, s.subtype)}</p>
                        <span className="text-xs text-muted-foreground">{dateTime(s.startedAt)}</span>
                      </div>
                      {s.error && <p className="mt-1 text-sm text-destructive">{s.error}</p>}
                      {s.output !== null && s.output !== undefined && (
                        <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-[11px] text-muted-foreground">{JSON.stringify(s.output, null, 2)}</pre>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <DetailRow label="Trigger">{labelOf('TRIGGER', run.triggerType)}</DetailRow>
                <DetailRow label="Attempts">{run.attempts}</DetailRow>
                <DetailRow label="Duration">{duration(total)}</DetailRow>
                <DetailRow label="Finished">{dateTime(run.finishedAt)}</DetailRow>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Trigger data</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded bg-muted p-3 text-[11px]">{JSON.stringify(run.triggerPayload, null, 2)}</pre>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
