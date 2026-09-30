'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Clock, KanbanSquare, Plus, Settings2, User } from 'lucide-react';
import { api } from '@/lib/api';
import { money, relative } from '@/lib/format';
import { PRIORITY } from '@/lib/status';
import { cn } from '@/lib/utils';
import { useSession } from '@/components/session';
import { EmptyState, PageHeader, StatusBadge } from '@/components/shared/page';
import { SearchInput } from '@/components/shared/data-table';
import { Avatar, Card, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';
import { DealFormDialog, type Deal, type Pipeline, type Stage } from '@/features/deals/deal-form';
import { PipelineEditorDialog } from '@/features/deals/pipeline-editor';

interface Board {
  pipeline: Pipeline;
  stages: Array<Stage & { deals: Deal[]; totalAmount: number; count: number }>;
}

function DealCard({ deal, onClick, dragging }: { deal: Deal; onClick?: () => void; dragging?: boolean }) {
  const { currency } = useSession();
  return (
    <div
      onClick={onClick}
      className={cn('rounded-lg border bg-card p-3 text-left shadow-xs transition-shadow hover:shadow-md', dragging && 'rotate-1 shadow-lg ring-2 ring-primary/30')}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-medium">{deal.name}</p>
        <StatusBadge map={PRIORITY} value={deal.priority} className="shrink-0" />
      </div>
      <p className="mt-1 text-sm font-semibold tabular">{money(deal.amount, currency)}</p>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        {deal.customer && (
          <span className="flex min-w-0 items-center gap-1">
            <User className="size-3 shrink-0" />
            <span className="truncate">{deal.customer.name}</span>
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <Clock className="size-3" /> {relative(deal.lastActivityAt)}
        </span>
        {deal.assignedUser && <Avatar name={deal.assignedUser.name} src={deal.assignedUser.avatarUrl} size={20} />}
      </div>
    </div>
  );
}

function SortableDeal({ deal, onOpen, disabled }: { deal: Deal; onOpen: () => void; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id, data: { stageId: deal.stageId }, disabled });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && 'opacity-40')} {...attributes} {...listeners}>
      <DealCard deal={deal} onClick={onOpen} />
    </div>
  );
}

function Column({ stage, children, onAdd, canCreate }: { stage: Board['stages'][number]; children: React.ReactNode; onAdd: () => void; canCreate: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage.id}`, data: { stageId: stage.id } });
  const { currency } = useSession();
  return (
    <section aria-label={stage.name} className="flex w-[280px] shrink-0 flex-col rounded-xl bg-muted/50 sm:w-[300px]">
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className="size-2.5 rounded-full" style={{ background: stage.color ?? 'var(--muted-foreground)' }} aria-hidden />
        <h2 className="truncate text-sm font-semibold">{stage.name}</h2>
        <span className="rounded-full bg-card px-1.5 text-xs text-muted-foreground tabular">{stage.count}</span>
        <span className="ml-auto text-xs font-medium text-muted-foreground tabular">{money(stage.totalAmount, currency, { compact: true })}</span>
      </header>
      <div ref={setNodeRef} className={cn('flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 scrollbar-thin', isOver && 'rounded-lg bg-primary/5')}>
        {children}
        {canCreate && (
          <button onClick={onAdd} className="flex h-9 items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground hover:border-primary hover:text-primary">
            <Plus className="size-3.5" /> Add deal
          </button>
        )}
      </div>
    </section>
  );
}

function PipelinesInner() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const router = useRouter();
  const { can } = useSession();
  const [search, setSearch] = React.useState('');
  const [dealDialog, setDealDialog] = React.useState<{ open: boolean; deal?: Deal | null; stageId?: string }>({ open: false });
  const [editor, setEditor] = React.useState<{ open: boolean; pipeline?: Pipeline | null }>({ open: false });
  const [activeDeal, setActiveDeal] = React.useState<Deal | null>(null);

  const pipelines = useQuery({ queryKey: ['pipelines'], queryFn: () => api.get<Pipeline[]>('/pipelines') });
  const pipelineId = params.get('pipeline') ?? pipelines.data?.[0]?.id;
  const board = useQuery({
    queryKey: ['pipeline-board', pipelineId, search],
    queryFn: () => api.get<Board>(`/pipelines/${pipelineId}/board`, { search: search || undefined }),
    enabled: Boolean(pipelineId),
  });

  const move = useMutation({
    mutationFn: (v: { dealId: string; stageId: string; index: number }) => api.post(`/deals/${v.dealId}/move`, { stageId: v.stageId, index: v.index }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['pipeline-board', pipelineId, search] });
      const prev = qc.getQueryData<Board>(['pipeline-board', pipelineId, search]);
      if (prev) {
        const deal = prev.stages.flatMap((s) => s.deals).find((d) => d.id === v.dealId);
        if (deal) {
          const next: Board = {
            ...prev,
            stages: prev.stages.map((s) => {
              let deals = s.deals.filter((d) => d.id !== v.dealId);
              if (s.id === v.stageId) {
                deals = [...deals];
                deals.splice(v.index, 0, { ...deal, stageId: v.stageId });
              }
              return { ...s, deals, count: deals.length, totalAmount: deals.reduce((a, d) => a + Number(d.amount), 0) };
            }),
          };
          qc.setQueryData(['pipeline-board', pipelineId, search], next);
        }
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['pipeline-board', pipelineId, search], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['pipeline-board', pipelineId] }),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const onDragStart = (e: DragStartEvent) => setActiveDeal(board.data?.stages.flatMap((s) => s.deals).find((d) => d.id === e.active.id) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setActiveDeal(null);
    if (!e.over || !board.data) return;
    const dealId = String(e.active.id);
    const overData = e.over.data.current as { stageId?: string } | undefined;
    const targetStage = overData?.stageId ?? String(e.over.id).replace('stage:', '');
    const stage = board.data.stages.find((s) => s.id === targetStage);
    if (!stage) return;
    const without = stage.deals.filter((d) => d.id !== dealId);
    const overIndex = without.findIndex((d) => d.id === e.over!.id);
    const index = overIndex >= 0 ? overIndex : without.length;
    const current = board.data.stages.find((s) => s.deals.some((d) => d.id === dealId));
    const currentIndex = current?.deals.findIndex((d) => d.id === dealId);
    if (current?.id === targetStage && currentIndex === index) return;
    move.mutate({ dealId, stageId: targetStage, index });
  };

  const pipeline = board.data?.pipeline ?? pipelines.data?.find((p) => p.id === pipelineId);

  return (
    <div className="flex h-[calc(100dvh-3.5rem-3rem)] min-h-[520px] flex-col">
      <PageHeader
        title="Pipelines"
        description="Drag deals between stages. Won and lost stages close the deal automatically."
        actions={
          <>
            {pipelines.data && pipelines.data.length > 0 && (
              <Select value={pipelineId} onValueChange={(v) => router.replace(`/pipelines?pipeline=${v}`)}>
                <SelectTrigger className="w-48" aria-label="Pipeline">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pipelines.data.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {can('crm.pipelines.manage') && (
              <>
                <Button variant="outline" size="icon" onClick={() => setEditor({ open: true, pipeline })} aria-label="Edit pipeline" disabled={!pipeline}>
                  <Settings2 />
                </Button>
                <Button variant="outline" onClick={() => setEditor({ open: true, pipeline: null })}>
                  <Plus /> Pipeline
                </Button>
              </>
            )}
            {can('crm.deals.create') && pipeline && (
              <Button onClick={() => setDealDialog({ open: true })}>
                <Plus /> Deal
              </Button>
            )}
          </>
        }
      />
      <div className="mb-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Filter deals" />
      </div>
      {board.isLoading || pipelines.isLoading ? (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-96 w-[280px] shrink-0 rounded-xl" />
          ))}
        </div>
      ) : !pipeline ? (
        <Card>
          <EmptyState icon={KanbanSquare} title="No pipeline yet" description="Create a pipeline to track deals." />
        </Card>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveDeal(null)}>
          <div className="-mx-4 flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-3 scrollbar-thin sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            {board.data?.stages.map((stage) => (
              <Column key={stage.id} stage={stage} canCreate={can('crm.deals.create')} onAdd={() => setDealDialog({ open: true, stageId: stage.id })}>
                <SortableContext items={stage.deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
                  {stage.deals.map((deal) => (
                    <SortableDeal key={deal.id} deal={deal} disabled={!can('crm.deals.update')} onOpen={() => setDealDialog({ open: true, deal })} />
                  ))}
                </SortableContext>
              </Column>
            ))}
          </div>
          <DragOverlay>{activeDeal && <DealCard deal={activeDeal} dragging />}</DragOverlay>
        </DndContext>
      )}
      {pipeline && <DealFormDialog open={dealDialog.open} onOpenChange={(o) => setDealDialog((d) => ({ ...d, open: o }))} pipeline={pipeline} deal={dealDialog.deal} defaultStageId={dealDialog.stageId} />}
      <PipelineEditorDialog open={editor.open} onOpenChange={(o) => setEditor((e) => ({ ...e, open: o }))} pipeline={editor.pipeline} onSaved={(p) => router.replace(`/pipelines?pipeline=${p.id}`)} />
    </div>
  );
}

export default function PipelinesPage() {
  return (
    <React.Suspense>
      <PipelinesInner />
    </React.Suspense>
  );
}
