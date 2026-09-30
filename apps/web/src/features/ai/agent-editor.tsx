'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AI_TOOLS, AI_TONES } from '@sellora/shared';
import { Bot, Check, Loader2, RotateCcw, Send, Sparkles, Trash2, Wrench, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, Input, Label, Switch, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';
import { Field, FormGrid } from '@/components/shared/form';
import { CustomerPicker } from '@/components/shared/pickers';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type Day = (typeof DAYS)[number];

export interface AgentDetail {
  id: string;
  name: string;
  description: string | null;
  systemInstructions: string;
  personality: string | null;
  language: string;
  tone: string;
  businessInfo: string | null;
  salesObjectives: string | null;
  escalationRules: string | null;
  workingHours: { enabled: boolean; timezone: string; days: Partial<Record<Day, { from: string; to: string } | null>> } | null;
  fallbackBehavior: 'handoff' | 'message' | 'silent';
  fallbackMessage: string | null;
  model: string | null;
  temperature: number;
  enabledTools: string[];
  useKnowledgeBase: boolean;
  knowledgeBaseIds: string[];
  isActive: boolean;
  isDefault: boolean;
  stats?: { conversations30d: number; handoffs30d: number; tokens30d: number; cost30d: number };
}

type Values = Omit<AgentDetail, 'id' | 'stats' | 'workingHours'> & {
  hoursEnabled: boolean;
  timezone: string;
  days: Record<Day, { on: boolean; from: string; to: string }>;
};

function toValues(a: Partial<AgentDetail>): Values {
  const wh = a.workingHours;
  return {
    name: a.name ?? 'Sales Assistant',
    description: a.description ?? '',
    systemInstructions: a.systemInstructions ?? '',
    personality: a.personality ?? '',
    language: a.language ?? 'auto',
    tone: a.tone ?? 'friendly',
    businessInfo: a.businessInfo ?? '',
    salesObjectives: a.salesObjectives ?? '',
    escalationRules: a.escalationRules ?? '',
    fallbackBehavior: a.fallbackBehavior ?? 'handoff',
    fallbackMessage: a.fallbackMessage ?? '',
    model: a.model ?? '',
    temperature: a.temperature ?? 0.3,
    enabledTools: a.enabledTools ?? AI_TOOLS.map((t) => t.name),
    useKnowledgeBase: a.useKnowledgeBase ?? true,
    knowledgeBaseIds: a.knowledgeBaseIds ?? [],
    isActive: a.isActive ?? true,
    isDefault: a.isDefault ?? false,
    hoursEnabled: wh?.enabled ?? false,
    timezone: wh?.timezone ?? (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'),
    days: Object.fromEntries(DAYS.map((d) => [d, { on: wh ? Boolean(wh.days?.[d]) : !['sat', 'sun'].includes(d), from: wh?.days?.[d]?.from ?? '09:00', to: wh?.days?.[d]?.to ?? '18:00' }])) as Values['days'],
  };
}

interface TestTurn {
  role: 'customer' | 'assistant';
  content: string;
  toolCalls?: Array<{ name: string; arguments: unknown; ok: boolean; result: unknown }>;
  knowledge?: Array<{ documentTitle: string; score: number }>;
}

function Playground({ agentId }: { agentId: string }) {
  const [turns, setTurns] = React.useState<TestTurn[]>([]);
  const [input, setInput] = React.useState('');
  const [customerId, setCustomerId] = React.useState<string | null>(null);
  const scroll = React.useRef<HTMLDivElement>(null);
  const run = useMutation({
    mutationFn: (messages: TestTurn[]) =>
      api.post<{ reply: string | null; handoff: boolean; toolCalls: TestTurn['toolCalls']; knowledge: TestTurn['knowledge'] }>(`/ai/agents/${agentId}/test`, {
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        customerId: customerId ?? undefined,
      }),
    meta: { silent: true },
    onSuccess: (r) => setTurns((t) => [...t, { role: 'assistant', content: r.reply ?? (r.handoff ? '(Transferred to a human)' : '(No reply)'), toolCalls: r.toolCalls, knowledge: r.knowledge }]),
    onError: (err) => setTurns((t) => [...t, { role: 'assistant', content: `⚠️ ${errorMessage(err)}` }]),
  });
  React.useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' });
  }, [turns, run.isPending]);
  const send = () => {
    const text = input.trim();
    if (!text || run.isPending) return;
    const next = [...turns, { role: 'customer' as const, content: text }];
    setTurns(next);
    setInput('');
    run.mutate(next);
  };
  return (
    <Card className="flex h-[640px] max-h-[75vh] flex-col overflow-hidden">
      <CardHeader className="border-b pb-4">
        <div className="min-w-0 flex-1">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-ai" /> Test your agent
          </CardTitle>
          <CardDescription className="mt-1">Uses the saved configuration, real catalog and knowledge. Actions like orders run in test mode and change nothing.</CardDescription>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => setTurns([])} aria-label="Reset conversation">
          <RotateCcw />
        </Button>
      </CardHeader>
      <div className="border-b px-5 py-3">
        <Label className="mb-1.5 text-xs text-muted-foreground">Chat as customer (optional)</Label>
        <CustomerPicker value={customerId} onChange={(id) => setCustomerId(id)} />
      </div>
      <div ref={scroll} className="flex-1 space-y-3 overflow-y-auto bg-muted/25 p-4 scrollbar-thin">
        {!turns.length && <p className="py-10 text-center text-sm text-muted-foreground">Try “Do you have wireless headphones?” or “I want to order a smart watch”.</p>}
        {turns.map((t, i) => (
          <div key={i} className={cn('flex flex-col', t.role === 'customer' ? 'items-start' : 'items-end')}>
            <div className={cn('max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap', t.role === 'customer' ? 'rounded-tl-sm border bg-card' : 'rounded-tr-sm border border-ai/20 bg-ai-soft')}>{t.content}</div>
            {!!t.toolCalls?.length && (
              <div className="mt-1 flex max-w-[85%] flex-wrap justify-end gap-1">
                {t.toolCalls.map((c, j) => (
                  <details key={j} className="rounded-md border bg-card px-2 py-0.5 text-[11px]">
                    <summary className="cursor-pointer select-none">
                      <Wrench className="mr-1 inline size-3" />
                      {c.name} {c.ok ? <Check className="inline size-3 text-success" /> : '✕'}
                    </summary>
                    <pre className="mt-1 max-w-xs overflow-x-auto text-[10px] text-muted-foreground">{JSON.stringify({ arguments: c.arguments, result: c.result }, null, 2)}</pre>
                  </details>
                ))}
              </div>
            )}
            {!!t.knowledge?.length && (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                <BookOpen className="size-3" /> Used: {t.knowledge.map((k) => k.documentTitle).join(', ')}
              </p>
            )}
          </div>
        ))}
        {run.isPending && (
          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Thinking…
          </div>
        )}
      </div>
      <div className="flex gap-2 border-t p-3">
        <Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Message as the customer…" aria-label="Test message" />
        <Button onClick={send} disabled={!input.trim()} loading={run.isPending} aria-label="Send test message">
          {!run.isPending && <Send />}
        </Button>
      </div>
    </Card>
  );
}

export function AgentEditor({ agent }: { agent?: AgentDetail | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const template = useQuery({ queryKey: ['agent-template'], queryFn: () => api.get<Partial<AgentDetail>>('/ai/agents/template'), enabled: !agent });
  const kbs = useQuery({ queryKey: ['knowledge-bases'], queryFn: () => api.get<Array<{ id: string; name: string; documentCount: number }>>('/ai/knowledge-bases') });
  const form = useForm<Values>({ defaultValues: toValues(agent ?? {}) });
  React.useEffect(() => {
    if (!agent && template.data) form.reset(toValues(template.data));
  }, [agent, template.data, form]);
  const editable = agent ? can('ai.agents.update') : can('ai.agents.create');

  const save = useMutation({
    mutationFn: (v: Values) => {
      const body = {
        name: v.name,
        description: v.description || null,
        systemInstructions: v.systemInstructions,
        personality: v.personality || null,
        language: v.language || 'auto',
        tone: v.tone,
        businessInfo: v.businessInfo || null,
        salesObjectives: v.salesObjectives || null,
        escalationRules: v.escalationRules || null,
        fallbackBehavior: v.fallbackBehavior,
        fallbackMessage: v.fallbackMessage || null,
        model: v.model || null,
        temperature: Number(v.temperature),
        enabledTools: v.enabledTools,
        useKnowledgeBase: v.useKnowledgeBase,
        knowledgeBaseIds: v.knowledgeBaseIds,
        isActive: v.isActive,
        isDefault: v.isDefault,
        workingHours: v.hoursEnabled
          ? { enabled: true, timezone: v.timezone, days: Object.fromEntries(DAYS.map((d) => [d, v.days[d].on ? { from: v.days[d].from, to: v.days[d].to } : null])) }
          : null,
      };
      return agent ? api.patch<AgentDetail>(`/ai/agents/${agent.id}`, body) : api.post<AgentDetail>('/ai/agents', body);
    },
    onSuccess: (a) => {
      toast.success(agent ? 'Agent saved' : 'Agent created');
      qc.invalidateQueries({ queryKey: ['ai-agents'] });
      qc.invalidateQueries({ queryKey: ['ai-agent', a.id] });
      if (!agent) router.replace(`/ai/agents/${a.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/ai/agents/${agent!.id}`),
    onSuccess: () => {
      toast.success('Agent deleted');
      qc.invalidateQueries({ queryKey: ['ai-agents'] });
      router.push('/ai/agents');
    },
  });
  const tools = form.watch('enabledTools');
  const hoursEnabled = form.watch('hoursEnabled');

  const textArea = (name: keyof Values, label: string, hint: string, rows = 3) => (
    <Field label={label} htmlFor={`ag-${name}`} hint={hint}>
      <Textarea id={`ag-${name}`} rows={rows} disabled={!editable} {...form.register(name as never)} />
    </Field>
  );

  const editorBody = (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormGrid>
            <Field label="Agent name" htmlFor="ag-name" required>
              <Input id="ag-name" disabled={!editable} {...form.register('name', { required: true })} />
            </Field>
            <Field label="Description" htmlFor="ag-desc">
              <Input id="ag-desc" disabled={!editable} {...form.register('description')} />
            </Field>
            <Field label="Tone" htmlFor="ag-tone">
              <Controller
                control={form.control}
                name="tone"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={!editable}>
                    <SelectTrigger id="ag-tone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AI_TONES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Language" htmlFor="ag-lang" hint='"auto" replies in the customer’s language'>
              <Input id="ag-lang" disabled={!editable} {...form.register('language')} />
            </Field>
          </FormGrid>
          {textArea('personality', 'Personality', 'e.g. Warm, knowledgeable, never pushy.', 2)}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Instructions</CardTitle>
          <CardDescription>What the agent should do. Safety rules (no invented prices or stock, confirmations before orders, no prompt disclosure) are always enforced.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {textArea('systemInstructions', 'System instructions', 'The main behaviour of this agent.', 5)}
          {textArea('businessInfo', 'Business information', 'Opening hours, locations, policies, what makes you different.', 4)}
          {textArea('salesObjectives', 'Sales objectives', 'e.g. Recommend accessories, capture leads for bulk orders.')}
          {textArea('escalationRules', 'Escalation rules', 'When to hand over to a human.')}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="size-4" /> Tools
          </CardTitle>
          <CardDescription>Actions the agent may perform. Every call is authorized, validated and logged. Transfer to human is always available.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {AI_TOOLS.map((t) => {
            const checked = tools.includes(t.name) || t.name === 'transferToHuman';
            return (
              <label key={t.name} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3', checked && 'border-primary/40 bg-primary/5')}>
                <Checkbox
                  checked={checked}
                  disabled={!editable || t.name === 'transferToHuman'}
                  onCheckedChange={(c) => form.setValue('enabledTools', c ? [...new Set([...tools, t.name])] : tools.filter((x) => x !== t.name), { shouldDirty: true })}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {t.label}
                    {t.writes && <Badge variant="warning">writes data</Badge>}
                  </span>
                  <span className="block text-xs text-muted-foreground">{t.description}</span>
                </span>
              </label>
            );
          })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-4" /> Knowledge
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="ag-kb">Search knowledge bases before answering</Label>
            <Controller control={form.control} name="useKnowledgeBase" render={({ field }) => <Switch id="ag-kb" checked={field.value} onCheckedChange={field.onChange} disabled={!editable} />} />
          </div>
          {!kbs.data?.length ? (
            <p className="text-sm text-muted-foreground">No knowledge bases yet. Create one under AI → Knowledge Base.</p>
          ) : (
            <Controller
              control={form.control}
              name="knowledgeBaseIds"
              render={({ field }) => (
                <div className="grid gap-2 sm:grid-cols-2">
                  {kbs.data!.map((kb) => (
                    <label key={kb.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm">
                      <Checkbox
                        disabled={!editable}
                        checked={field.value.includes(kb.id)}
                        onCheckedChange={(c) => field.onChange(c ? [...field.value, kb.id] : field.value.filter((x) => x !== kb.id))}
                      />
                      <span className="flex-1">{kb.name}</span>
                      <span className="text-xs text-muted-foreground">{kb.documentCount} docs</span>
                    </label>
                  ))}
                </div>
              )}
            />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Availability & fallback</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="ag-hours">Only reply during working hours</Label>
            <Controller control={form.control} name="hoursEnabled" render={({ field }) => <Switch id="ag-hours" checked={field.value} onCheckedChange={field.onChange} disabled={!editable} />} />
          </div>
          {hoursEnabled && (
            <div className="space-y-2">
              <Field label="Timezone" htmlFor="ag-tz">
                <Input id="ag-tz" {...form.register('timezone')} disabled={!editable} />
              </Field>
              {DAYS.map((d) => (
                <div key={d} className="flex flex-wrap items-center gap-3">
                  <Controller control={form.control} name={`days.${d}.on`} render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} aria-label={`${d} enabled`} disabled={!editable} />} />
                  <span className="w-10 text-sm capitalize">{d}</span>
                  <Input type="time" className="w-28" {...form.register(`days.${d}.from`)} aria-label={`${d} from`} disabled={!editable} />
                  <span className="text-muted-foreground">–</span>
                  <Input type="time" className="w-28" {...form.register(`days.${d}.to`)} aria-label={`${d} to`} disabled={!editable} />
                </div>
              ))}
            </div>
          )}
          <FormGrid>
            <Field label="When unavailable or unsure" htmlFor="ag-fallback">
              <Controller
                control={form.control}
                name="fallbackBehavior"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={!editable}>
                    <SelectTrigger id="ag-fallback">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="handoff">Send fallback message and hand to a human</SelectItem>
                      <SelectItem value="message">Send fallback message only</SelectItem>
                      <SelectItem value="silent">Stay silent</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Fallback message" htmlFor="ag-fbmsg">
              <Input id="ag-fbmsg" {...form.register('fallbackMessage')} disabled={!editable} />
            </Field>
            <Field label="Model override" htmlFor="ag-model" hint="Empty uses the workspace default.">
              <Input id="ag-model" {...form.register('model')} disabled={!editable} placeholder="e.g. gpt-4o-mini" />
            </Field>
            <Field label="Creativity (temperature)" htmlFor="ag-temp" hint="0 = precise, 1 = creative">
              <Input id="ag-temp" type="number" step="0.1" min={0} max={1.5} {...form.register('temperature', { valueAsNumber: true })} disabled={!editable} />
            </Field>
          </FormGrid>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Controller control={form.control} name="isActive" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!editable} />} />
              Active
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Controller control={form.control} name="isDefault" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!editable} />} />
              Default agent for new conversations
            </label>
          </div>
        </CardContent>
      </Card>
      {editable && (
        <div className="flex flex-wrap justify-end gap-2">
          {agent && can('ai.agents.update') && (
            <Button type="button" variant="ghost" onClick={async () => (await confirm({ title: `Delete ${agent.name}?`, description: 'Open conversations handled by this agent are moved to your human team.', destructive: true, confirmLabel: 'Delete' })) && remove.mutate()}>
              <Trash2 /> Delete agent
            </Button>
          )}
          <Button type="submit" loading={save.isPending}>
            {agent ? 'Save changes' : 'Create agent'}
          </Button>
        </div>
      )}
    </form>
  );

  if (!agent) return editorBody;
  return (
    <Tabs defaultValue="configure">
      <TabsList>
        <TabsTrigger value="configure">
          <Bot /> Configure
        </TabsTrigger>
        <TabsTrigger value="test">
          <Sparkles /> Test
        </TabsTrigger>
      </TabsList>
      <TabsContent value="configure">{editorBody}</TabsContent>
      <TabsContent value="test">
        <Playground agentId={agent.id} />
      </TabsContent>
    </Tabs>
  );
}
