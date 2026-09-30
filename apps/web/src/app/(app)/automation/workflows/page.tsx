'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Copy, Plus, Workflow, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { WORKFLOW_TRIGGERS } from '@sellora/shared';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { WORKFLOW_STATUS } from '@/lib/status';
import { useSession } from '@/components/session';
import { EmptyState, PageHeader, StatusBadge } from '@/components/shared/page';
import { Card, CardContent, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { WORKFLOW_TEMPLATES } from '@/features/automation/templates';
import { useOpenFromQuery } from '@/hooks/use-list-state';

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  triggerType: string;
  runCount: number;
  failureCount: number;
  lastRunAt: string | null;
  stepCount: number;
  updatedAt: string;
}

const triggerLabel = (k: string) => WORKFLOW_TRIGGERS.find((t) => t.key === k)?.label ?? k;

export default function WorkflowsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useSession();
  const [open, setOpen] = React.useState(false);
  useOpenFromQuery(setOpen);
  const { data, isLoading } = useQuery({ queryKey: ['workflows'], queryFn: () => api.get<WorkflowRow[]>('/workflows') });
  const create = useMutation({
    mutationFn: (templateId: string) => api.post<{ id: string }>('/workflows', WORKFLOW_TEMPLATES.find((t) => t.id === templateId)!.draft),
    onSuccess: (w) => {
      qc.invalidateQueries({ queryKey: ['workflows'] });
      router.push(`/automation/workflows/${w.id}`);
    },
  });
  const duplicate = useMutation({
    mutationFn: (id: string) => api.post<{ id: string }>(`/workflows/${id}/duplicate`),
    onSuccess: () => {
      toast.success('Workflow duplicated');
      qc.invalidateQueries({ queryKey: ['workflows'] });
    },
  });
  return (
    <>
      <PageHeader
        title="Workflows"
        description="Automate follow-ups, routing and customer messages. Workflows run in the background with retries and full run logs."
        actions={
          can('automation.create') && (
            <Button onClick={() => setOpen(true)}>
              <Plus /> New workflow
            </Button>
          )
        }
      />
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
      ) : !data?.length ? (
        <Card>
          <EmptyState icon={Workflow} title="No workflows yet" description="Start from a template — follow up new leads, thank customers after payment or win back inactive buyers." action={can('automation.create') ? <Button onClick={() => setOpen(true)}><Plus /> New workflow</Button> : undefined} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((w) => (
            <Card key={w.id} className="flex flex-col transition-colors hover:border-primary/40">
              <Link href={`/automation/workflows/${w.id}`} className="flex-1 rounded-t-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold">{w.name}</p>
                    <StatusBadge map={WORKFLOW_STATUS} value={w.status} />
                  </div>
                  <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">{w.description ?? 'No description'}</p>
                  <p className="flex items-center gap-1.5 text-xs">
                    <Zap className="size-3.5 text-primary" /> {triggerLabel(w.triggerType)} · {w.stepCount} steps
                  </p>
                </CardContent>
              </Link>
              <div className="flex items-center gap-3 border-t px-5 py-2.5 text-xs text-muted-foreground">
                <span>{w.runCount} runs</span>
                {w.failureCount > 0 && (
                  <span className="flex items-center gap-1 text-destructive">
                    <AlertTriangle className="size-3" /> {w.failureCount} failed
                  </span>
                )}
                <span className="ml-auto">{w.lastRunAt ? `Last run ${relative(w.lastRunAt)}` : 'Never run'}</span>
                {can('automation.create') && (
                  <Button variant="ghost" size="icon-sm" aria-label={`Duplicate ${w.name}`} onClick={() => duplicate.mutate(w.id)}>
                    <Copy />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Create a workflow</DialogTitle>
            <DialogDescription>Pick a template. You can change every step in the builder.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {WORKFLOW_TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => create.mutate(t.id)}
                disabled={create.isPending}
                className="rounded-xl border p-4 text-left transition hover:border-primary hover:bg-primary/5 disabled:opacity-60"
              >
                <p className="font-medium">{t.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
