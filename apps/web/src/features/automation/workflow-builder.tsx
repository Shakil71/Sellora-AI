'use client';

import * as React from 'react';
import '@xyflow/react/dist/style.css';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { ArrowLeft, GitBranch, Pause, Play, Plus, Save, Trash2, Zap, CirclePlay, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { WORKFLOW_ACTIONS, WORKFLOW_CONDITIONS, WORKFLOW_TRIGGERS } from '@sellora/shared';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { CatalogField, CatalogItem } from '@/lib/types';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { StatusBadge } from '@/components/shared/page';
import { WORKFLOW_STATUS } from '@/lib/status';
import { Button } from '@/components/ui/button';
import { Badge, Input, Textarea } from '@/components/ui/primitives';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/overlays';
import { Field, TagInput } from '@/components/shared/form';
import { AgentSelect, CustomerPicker, MemberSelect, ProductPicker } from '@/components/shared/pickers';

type NodeType = 'TRIGGER' | 'CONDITION' | 'ACTION';
interface StepData extends Record<string, unknown> {
  type: NodeType;
  subtype: string;
  label?: string | null;
  config: Record<string, unknown>;
}
export interface WorkflowDetail {
  id: string;
  name: string;
  description: string | null;
  status: string;
  triggerType: string;
  nodes: Array<{ key: string; type: NodeType; subtype: string; label: string | null; config: Record<string, unknown>; positionX: number; positionY: number }>;
  edges: Array<{ sourceKey: string; targetKey: string; sourceHandle: string | null }>;
}

const CATALOG: Record<NodeType, readonly CatalogItem[]> = {
  TRIGGER: WORKFLOW_TRIGGERS as unknown as CatalogItem[],
  CONDITION: WORKFLOW_CONDITIONS as unknown as CatalogItem[],
  ACTION: WORKFLOW_ACTIONS as unknown as CatalogItem[],
};
const find = (type: NodeType, subtype: string) => CATALOG[type].find((i) => i.key === subtype);

const STYLE: Record<NodeType, { icon: typeof Zap; label: string; accent: string }> = {
  TRIGGER: { icon: Zap, label: 'Trigger', accent: 'bg-primary/10 text-primary' },
  CONDITION: { icon: GitBranch, label: 'Condition', accent: 'bg-warning/15 text-[color-mix(in_oklch,var(--warning)_60%,var(--foreground))]' },
  ACTION: { icon: CirclePlay, label: 'Action', accent: 'bg-ai-soft text-ai' },
};

function missingFields(data: StepData): string[] {
  const item = find(data.type, data.subtype);
  if (!item) return ['Unknown step'];
  return item.fields.filter((f) => f.required && (data.config[f.key] === undefined || data.config[f.key] === '' || (Array.isArray(data.config[f.key]) && !(data.config[f.key] as unknown[]).length))).map((f) => f.label);
}

function StepNode({ data, selected }: NodeProps<Node<StepData>>) {
  const s = STYLE[data.type];
  const item = find(data.type, data.subtype);
  const missing = missingFields(data);
  return (
    <div className={cn('w-60 rounded-xl border bg-card shadow-sm transition-shadow', selected && 'ring-2 ring-primary/50 shadow-md')}>
      {data.type !== 'TRIGGER' && <Handle type="target" position={Position.Top} className="!size-3 !border-2 !border-card !bg-muted-foreground" />}
      <div className="flex items-start gap-2.5 p-3">
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', s.accent)}>
          <s.icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{s.label}</p>
          <p className="truncate text-sm font-medium">{data.label || item?.label || data.subtype}</p>
          {missing.length > 0 && (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-destructive">
              <AlertCircle className="size-3" /> Needs {missing[0]}
            </p>
          )}
        </div>
      </div>
      {data.type === 'CONDITION' ? (
        <div className="flex justify-between px-4 pb-1.5 text-[10px] font-medium">
          <span className="text-success">Yes</span>
          <span className="text-muted-foreground">No</span>
          <Handle id="yes" type="source" position={Position.Bottom} style={{ left: '25%' }} className="!size-3 !border-2 !border-card !bg-success" />
          <Handle id="no" type="source" position={Position.Bottom} style={{ left: '75%' }} className="!size-3 !border-2 !border-card !bg-muted-foreground" />
        </div>
      ) : (
        <Handle type="source" position={Position.Bottom} className="!size-3 !border-2 !border-card !bg-primary" />
      )}
    </div>
  );
}

const nodeTypes = { step: StepNode };

function FieldInput({ field, value, onChange, currency }: { field: CatalogField; value: unknown; onChange: (v: unknown) => void; currency: string }) {
  const id = `f-${field.key}`;
  switch (field.type) {
    case 'textarea':
      return <Textarea id={id} rows={4} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />;
    case 'number':
      return <Input id={id} type="number" value={value === undefined || value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
    case 'time':
      return <Input id={id} type="time" value={String(value ?? field.defaultValue ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <Select value={value ? String(value) : undefined} onValueChange={onChange}>
          <SelectTrigger id={id}>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'user':
      return <MemberSelect id={id} value={(value as string) || null} onChange={(v) => onChange(v ?? '')} placeholder="Select member" />;
    case 'agent':
      return <AgentSelect id={id} value={(value as string) || null} onChange={(v) => onChange(v ?? '')} />;
    case 'product':
      return <ProductPicker id={id} value={(value as string) || null} currency={currency} onChange={(v) => onChange(v ?? '')} onlyActive={false} />;
    case 'tags':
      return <TagInput id={id} value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} placeholder="Type and press Enter" />;
    default:
      return <Input id={id} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />;
  }
}

function ConfigPanel({ node, onChange, onDelete }: { node: Node<StepData>; onChange: (d: Partial<StepData>) => void; onDelete: () => void }) {
  const { currency } = useSession();
  const item = find(node.data.type, node.data.subtype);
  const options = CATALOG[node.data.type];
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Badge variant={node.data.type === 'TRIGGER' ? 'default' : node.data.type === 'CONDITION' ? 'warning' : 'ai'}>{STYLE[node.data.type].label}</Badge>
        {node.data.type !== 'TRIGGER' && (
          <Button variant="ghost" size="sm" className="ml-auto text-destructive" onClick={onDelete}>
            <Trash2 /> Remove
          </Button>
        )}
      </div>
      <Field label={node.data.type === 'TRIGGER' ? 'When…' : node.data.type === 'CONDITION' ? 'Check' : 'Do'} htmlFor="step-subtype">
        <Select value={node.data.subtype} onValueChange={(v) => onChange({ subtype: v, config: {} })}>
          <SelectTrigger id="step-subtype">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.key} value={o.key}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {item && <p className="text-sm text-muted-foreground">{item.description}</p>}
      <Field label="Label (optional)" htmlFor="step-label">
        <Input id="step-label" value={node.data.label ?? ''} onChange={(e) => onChange({ label: e.target.value || null })} placeholder={item?.label} />
      </Field>
      {item?.fields.map((f) => (
        <Field key={f.key} label={f.label} htmlFor={`f-${f.key}`} required={f.required} hint={f.help}>
          <FieldInput field={f} value={node.data.config[f.key] ?? f.defaultValue} currency={currency} onChange={(v) => onChange({ config: { ...node.data.config, [f.key]: v } })} />
        </Field>
      ))}
      {node.data.type === 'ACTION' && ['send_whatsapp_message', 'create_task', 'notify_team'].includes(node.data.subtype) && (
        <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
          Variables: {'{{customer.name}}'}, {'{{customer.firstName}}'}, {'{{order.number}}'}, {'{{order.total}}'}, {'{{lead.name}}'}
        </p>
      )}
      {node.data.type === 'CONDITION' && <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">Connect the green handle for “yes” and the grey handle for “no”.</p>}
    </div>
  );
}

let counter = 0;
const newKey = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

function toFlow(w: WorkflowDetail): { nodes: Node<StepData>[]; edges: Edge[] } {
  return {
    nodes: w.nodes.map((n) => ({ id: n.key, type: 'step', position: { x: n.positionX, y: n.positionY }, data: { type: n.type, subtype: n.subtype, label: n.label, config: n.config ?? {} } })),
    edges: w.edges.map((e) => ({
      id: `${e.sourceKey}-${e.sourceHandle ?? 'out'}-${e.targetKey}`,
      source: e.sourceKey,
      target: e.targetKey,
      sourceHandle: e.sourceHandle ?? undefined,
      label: e.sourceHandle ?? undefined,
      animated: false,
    })),
  };
}

function Builder({ workflow }: { workflow: WorkflowDetail }) {
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const { resolvedTheme } = useTheme();
  const initial = React.useMemo(() => toFlow(workflow), [workflow]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<StepData>>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [name, setName] = React.useState(workflow.name);
  const [description, setDescription] = React.useState(workflow.description ?? '');
  const [dirty, setDirty] = React.useState(false);
  const [runOpen, setRunOpen] = React.useState(false);
  const [runCustomer, setRunCustomer] = React.useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = React.useState(false);
  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const editable = can('automation.update');

  const markDirty = () => setDirty(true);
  const onConnect = React.useCallback(
    (c: Connection) => {
      setEdges((eds) => addEdge({ ...c, id: `${c.source}-${c.sourceHandle ?? 'out'}-${c.target}`, label: c.sourceHandle ?? undefined }, eds));
      setDirty(true);
    },
    [setEdges],
  );

  const addStep = (type: NodeType, subtype: string) => {
    const key = newKey(type.toLowerCase());
    const anchor = selected ?? nodes[nodes.length - 1];
    const position = anchor ? { x: anchor.position.x, y: anchor.position.y + 150 } : { x: 250, y: 40 };
    const item = find(type, subtype);
    const config = Object.fromEntries((item?.fields ?? []).filter((f) => f.defaultValue !== undefined).map((f) => [f.key, f.defaultValue]));
    setNodes((ns) => [...ns, { id: key, type: 'step', position, data: { type, subtype, config } }]);
    if (anchor && anchor.data.type !== 'CONDITION' && !edges.some((e) => e.source === anchor.id)) {
      setEdges((es) => [...es, { id: `${anchor.id}-out-${key}`, source: anchor.id, target: key }]);
    }
    setSelectedId(key);
    setMobilePanel(true);
    setDirty(true);
  };

  const updateSelected = (patch: Partial<StepData>) => {
    if (!selectedId) return;
    setNodes((ns) => ns.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n)));
    setDirty(true);
  };
  const deleteSelected = () => {
    if (!selectedId) return;
    setNodes((ns) => ns.filter((n) => n.id !== selectedId));
    setEdges((es) => es.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
    setMobilePanel(false);
    setDirty(true);
  };

  const payload = () => ({
    name: name.trim() || 'Untitled workflow',
    description: description || null,
    nodes: nodes.map((n) => ({ key: n.id, type: n.data.type, subtype: n.data.subtype, label: n.data.label ?? null, config: n.data.config, positionX: Math.round(n.position.x), positionY: Math.round(n.position.y) })),
    edges: edges.map((e) => ({ sourceKey: e.source, targetKey: e.target, sourceHandle: (e.sourceHandle as 'yes' | 'no' | null) ?? null })),
  });

  const save = useMutation({
    mutationFn: () => api.put<WorkflowDetail>(`/workflows/${workflow.id}`, payload()),
    meta: { silent: true },
    onSuccess: () => {
      toast.success('Workflow saved');
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['workflow', workflow.id] });
      qc.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not save workflow'),
  });
  const setStatus = useMutation({
    mutationFn: async (status: string) => {
      if (dirty) await api.put(`/workflows/${workflow.id}`, payload());
      return api.post<WorkflowDetail>(`/workflows/${workflow.id}/status`, { status });
    },
    meta: { silent: true },
    onSuccess: (w) => {
      toast.success(w.status === 'ACTIVE' ? 'Workflow is live' : 'Workflow paused');
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['workflow', workflow.id] });
      qc.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not change status', { duration: 8000 }),
  });
  const run = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/workflows/${workflow.id}/run`, { customerId: runCustomer ?? undefined }),
    onSuccess: (r) => {
      toast.success('Run started');
      setRunOpen(false);
      router.push(`/automation/runs/${r.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/workflows/${workflow.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] });
      router.push('/automation/workflows');
    },
  });

  const hasTrigger = nodes.some((n) => n.data.type === 'TRIGGER');

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2 sm:px-4">
        <Button variant="ghost" size="icon-sm" onClick={() => router.push('/automation/workflows')} aria-label="Back to workflows">
          <ArrowLeft />
        </Button>
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            markDirty();
          }}
          className="h-8 w-full max-w-xs border-transparent bg-transparent px-2 text-sm font-semibold shadow-none hover:border-input sm:w-72"
          aria-label="Workflow name"
          disabled={!editable}
        />
        <StatusBadge map={WORKFLOW_STATUS} value={workflow.status} />
        {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {editable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus /> Add step
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-[60vh] w-64">
                {!hasTrigger && (
                  <>
                    <DropdownMenuLabel>Trigger</DropdownMenuLabel>
                    {CATALOG.TRIGGER.map((t) => (
                      <DropdownMenuItem key={t.key} onSelect={() => addStep('TRIGGER', t.key)}>
                        <Zap /> {t.label}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuLabel>Conditions</DropdownMenuLabel>
                {CATALOG.CONDITION.map((c) => (
                  <DropdownMenuItem key={c.key} onSelect={() => addStep('CONDITION', c.key)}>
                    <GitBranch /> {c.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                {CATALOG.ACTION.map((a) => (
                  <DropdownMenuItem key={a.key} onSelect={() => addStep('ACTION', a.key)}>
                    <CirclePlay /> {a.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {can('automation.execute') && (
            <Button variant="outline" size="sm" onClick={() => setRunOpen(true)} disabled={dirty}>
              <Play /> Run now
            </Button>
          )}
          {editable && (
            <>
              <Button variant="outline" size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
                <Save /> Save
              </Button>
              {workflow.status === 'ACTIVE' ? (
                <Button size="sm" variant="secondary" onClick={() => setStatus.mutate('PAUSED')} loading={setStatus.isPending}>
                  <Pause /> Pause
                </Button>
              ) : (
                <Button size="sm" onClick={() => setStatus.mutate('ACTIVE')} loading={setStatus.isPending}>
                  <Play /> Activate
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" aria-label="Delete workflow" onClick={async () => (await confirm({ title: `Delete ${workflow.name}?`, description: 'Run history is deleted too.', destructive: true, confirmLabel: 'Delete' })) && remove.mutate()}>
                <Trash2 />
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1" aria-label="Workflow canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={(c) => {
              onNodesChange(c);
              if (c.some((x) => x.type === 'position' && x.dragging === false) || c.some((x) => x.type === 'remove')) markDirty();
            }}
            onEdgesChange={(c) => {
              onEdgesChange(c);
              if (c.some((x) => x.type === 'remove')) markDirty();
            }}
            onConnect={onConnect}
            onNodeClick={(_e, n) => {
              setSelectedId(n.id);
              setMobilePanel(true);
            }}
            onPaneClick={() => setSelectedId(null)}
            nodesDraggable={editable}
            nodesConnectable={editable}
            elementsSelectable
            deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
            defaultEdgeOptions={{ style: { strokeWidth: 2 } }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!hidden md:!block" />
          </ReactFlow>
          <div className="pointer-events-none absolute bottom-3 left-1/2 hidden -translate-x-1/2 rounded-full border bg-card/90 px-3 py-1 text-xs text-muted-foreground shadow-sm sm:block">
            Drag from a handle to connect steps · Select a step to configure it
          </div>
        </div>
        <aside className="hidden w-[340px] shrink-0 overflow-y-auto border-l bg-card scrollbar-thin lg:block">
          {selected ? (
            <ConfigPanel node={selected} onChange={updateSelected} onDelete={deleteSelected} />
          ) : (
            <div className="space-y-4 p-4">
              <Field label="Description" htmlFor="wf-desc">
                <Textarea
                  id="wf-desc"
                  rows={3}
                  value={description}
                  disabled={!editable}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    markDirty();
                  }}
                />
              </Field>
              <p className="text-sm text-muted-foreground">Select a step on the canvas to configure it, or use “Add step”. Workflows must be saved and valid before they can be activated.</p>
            </div>
          )}
        </aside>
      </div>
      <Sheet open={mobilePanel && !!selected} onOpenChange={setMobilePanel}>
        <SheetContent side="bottom" className="lg:hidden">
          <SheetTitle className="sr-only">Configure step</SheetTitle>
          <div className="overflow-y-auto">{selected && <ConfigPanel node={selected} onChange={updateSelected} onDelete={deleteSelected} />}</div>
        </SheetContent>
      </Sheet>
      <Dialog open={runOpen} onOpenChange={setRunOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run workflow now</DialogTitle>
            <DialogDescription>Runs the saved version immediately with the selected customer as context. Actions are real.</DialogDescription>
          </DialogHeader>
          <Field label="Customer" htmlFor="run-customer">
            <CustomerPicker id="run-customer" value={runCustomer} onChange={(id) => setRunCustomer(id)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => run.mutate()} loading={run.isPending}>
              Start run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function WorkflowBuilder({ workflow }: { workflow: WorkflowDetail }) {
  return (
    <ReactFlowProvider>
      <Builder workflow={workflow} />
    </ReactFlowProvider>
  );
}
