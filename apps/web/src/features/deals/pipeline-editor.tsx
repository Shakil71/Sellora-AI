'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input, Label, Switch } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';
import { Field } from '@/components/shared/form';
import type { Pipeline, Stage } from './deal-form';

type Draft = Partial<Stage> & { name: string; probability: number; type: 'OPEN' | 'WON' | 'LOST'; color: string | null; key: string };

const COLORS = ['#64748b', '#0ea5e9', '#6366f1', '#8b5cf6', '#f59e0b', '#f97316', '#10b981', '#ef4444'];

export function PipelineEditorDialog({ open, onOpenChange, pipeline, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; pipeline?: Pipeline | null; onSaved?: (p: Pipeline) => void }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState('');
  const [isDefault, setIsDefault] = React.useState(false);
  const [stages, setStages] = React.useState<Draft[]>([]);
  React.useEffect(() => {
    if (!open) return;
    setName(pipeline?.name ?? 'New pipeline');
    setIsDefault(pipeline?.isDefault ?? false);
    setStages(
      pipeline?.stages.map((s) => ({ ...s, key: s.id })) ?? [
        { key: 'a', name: 'New', probability: 10, type: 'OPEN', color: COLORS[0]! },
        { key: 'b', name: 'Qualified', probability: 50, type: 'OPEN', color: COLORS[2]! },
        { key: 'c', name: 'Won', probability: 100, type: 'WON', color: COLORS[6]! },
        { key: 'd', name: 'Lost', probability: 0, type: 'LOST', color: COLORS[7]! },
      ],
    );
  }, [open, pipeline]);
  const update = (i: number, patch: Partial<Draft>) => setStages((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) =>
    setStages((s) => {
      const next = [...s];
      const [x] = next.splice(i, 1);
      next.splice(i + d, 0, x!);
      return next;
    });
  const save = useMutation({
    mutationFn: () => {
      const body = { name, isDefault, stages: stages.map((s) => ({ id: s.id, name: s.name, probability: Number(s.probability), type: s.type, color: s.color ?? undefined })) };
      return pipeline ? api.patch<Pipeline>(`/pipelines/${pipeline.id}`, body) : api.post<Pipeline>('/pipelines', body);
    },
    onSuccess: (p) => {
      toast.success('Pipeline saved');
      qc.invalidateQueries({ queryKey: ['pipelines'] });
      qc.invalidateQueries({ queryKey: ['pipeline-board'] });
      onOpenChange(false);
      onSaved?.(p);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{pipeline ? 'Edit pipeline' : 'New pipeline'}</DialogTitle>
          <DialogDescription>Stages define how deals move from first contact to a result.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Pipeline name" htmlFor="p-name">
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="flex h-9 items-center gap-2">
              <Switch id="p-default" checked={isDefault} onCheckedChange={setIsDefault} />
              <Label htmlFor="p-default">Default pipeline</Label>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Stages</p>
            {stages.map((s, i) => (
              <div key={s.key} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-lg border p-2 sm:grid-cols-[auto_1fr_90px_120px_auto]">
                <input type="color" value={s.color ?? '#64748b'} onChange={(e) => update(i, { color: e.target.value })} className="size-8 cursor-pointer rounded border-0 bg-transparent" aria-label="Stage color" />
                <Input value={s.name} onChange={(e) => update(i, { name: e.target.value })} aria-label="Stage name" />
                <Input type="number" min={0} max={100} value={s.probability} onChange={(e) => update(i, { probability: Number(e.target.value) })} aria-label="Win probability %" className="hidden sm:block" />
                <Select value={s.type} onValueChange={(v) => update(i, { type: v as Draft['type'] })}>
                  <SelectTrigger className="hidden sm:flex" aria-label="Stage type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OPEN">Open</SelectItem>
                    <SelectItem value="WON">Won</SelectItem>
                    <SelectItem value="LOST">Lost</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex">
                  <Button variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon-sm" disabled={i === stages.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                    <ArrowDown />
                  </Button>
                  <Button variant="ghost" size="icon-sm" disabled={stages.length <= 2} onClick={() => setStages((x) => x.filter((_, j) => j !== i))} aria-label="Remove stage">
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setStages((s) => [...s, { key: `n${Date.now()}`, name: 'New stage', probability: 50, type: 'OPEN', color: COLORS[s.length % COLORS.length]! }])}>
              <Plus /> Add stage
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim() || stages.length < 2}>
            Save pipeline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
