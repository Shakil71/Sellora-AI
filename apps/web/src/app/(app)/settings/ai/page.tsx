'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, PlugZap, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useSession } from '@/components/session';
import { PageHeader, PageSkeleton, Section } from '@/components/shared/page';
import { Badge, Card, CardContent, Input } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Field, FormGrid } from '@/components/shared/form';

interface AiSettings {
  configured: boolean;
  source: 'workspace' | 'platform' | null;
  workspaceKeyHint: string | null;
  platformKeyAvailable: boolean;
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  defaults: { baseUrl: string; chatModel: string; embeddingModel: string };
  instructions: string;
  pricing: { inputPer1M: number; outputPer1M: number };
}

export default function AiSettingsPage() {
  const qc = useQueryClient();
  const { can } = useSession();
  const editable = can('settings.update');
  const { data, isLoading } = useQuery({ queryKey: ['ai-settings'], queryFn: () => api.get<AiSettings>('/ai/settings') });
  const [form, setForm] = React.useState({ apiKey: '', baseUrl: '', chatModel: '', embeddingModel: '' });
  React.useEffect(() => {
    if (data) setForm({ apiKey: '', baseUrl: data.baseUrl, chatModel: data.chatModel, embeddingModel: data.embeddingModel });
  }, [data]);
  const save = useMutation({
    mutationFn: (clearApiKey?: boolean) =>
      api.put('/ai/settings', {
        provider: 'openai',
        apiKey: form.apiKey || undefined,
        clearApiKey: clearApiKey || undefined,
        baseUrl: form.baseUrl,
        chatModel: form.chatModel,
        embeddingModel: form.embeddingModel,
      }),
    onSuccess: () => {
      toast.success('AI settings saved');
      qc.invalidateQueries({ queryKey: ['ai-settings'] });
      qc.invalidateQueries({ queryKey: ['ai-agents'] });
    },
  });
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; model?: string; error?: string; latencyMs: number }>('/ai/settings/test'),
    onSuccess: (r) => (r.ok ? toast.success(`Connected to ${r.model} in ${r.latencyMs} ms`) : toast.error(r.error ?? 'Connection failed', { duration: 8000 })),
  });
  if (isLoading || !data) return <PageSkeleton />;
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Settings' }, { label: 'AI' }]} title="AI provider" description="Connect OpenAI or any OpenAI-compatible API. Keys are encrypted and never sent to the browser." />
      <Card>
        <CardContent>
          <Section title="Status">
            <div className="flex flex-wrap items-center gap-3">
              {data.configured ? (
                <Badge variant="success">
                  <CheckCircle2 /> Configured ({data.source === 'workspace' ? 'workspace key' : 'platform key'})
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <XCircle /> Not configured
                </Badge>
              )}
              {data.configured && editable && (
                <Button variant="outline" size="sm" onClick={() => test.mutate()} loading={test.isPending}>
                  <PlugZap /> Test connection
                </Button>
              )}
            </div>
            {!data.configured && <p className="mt-3 text-sm text-muted-foreground">Until a key is added, AI agents hand every conversation to your team and knowledge is indexed for keyword search only.</p>}
          </Section>
          <Section title="API key" description={data.platformKeyAvailable ? 'Optional — the platform key is used when empty.' : 'Required to enable AI replies.'}>
            <div className="space-y-3">
              <Field label="OpenAI API key" htmlFor="ai-key" hint={data.workspaceKeyHint ? `Saved key: ${data.workspaceKeyHint}. Enter a new key to replace it.` : undefined}>
                <Input id="ai-key" type="password" autoComplete="off" disabled={!editable} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value.trim() })} placeholder="sk-..." />
              </Field>
              {data.workspaceKeyHint && editable && (
                <Button variant="ghost" size="sm" onClick={() => save.mutate(true)}>
                  <KeyRound /> Remove workspace key
                </Button>
              )}
            </div>
          </Section>
          <Section title="Models" description="Leave empty to use the platform defaults.">
            <FormGrid>
              <Field label="API base URL" htmlFor="ai-base" hint={`Default: ${data.defaults.baseUrl}`}>
                <Input id="ai-base" disabled={!editable} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder={data.defaults.baseUrl} />
              </Field>
              <Field label="Chat model" htmlFor="ai-chat" hint={`Default: ${data.defaults.chatModel}`}>
                <Input id="ai-chat" disabled={!editable} value={form.chatModel} onChange={(e) => setForm({ ...form, chatModel: e.target.value })} placeholder={data.defaults.chatModel} />
              </Field>
              <Field label="Embedding model" htmlFor="ai-emb" hint={`Default: ${data.defaults.embeddingModel}`}>
                <Input id="ai-emb" disabled={!editable} value={form.embeddingModel} onChange={(e) => setForm({ ...form, embeddingModel: e.target.value })} placeholder={data.defaults.embeddingModel} />
              </Field>
              <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                Cost estimates use ${data.pricing.inputPer1M}/1M input and ${data.pricing.outputPer1M}/1M output tokens (set by the server administrator).
              </div>
            </FormGrid>
          </Section>
          {editable && (
            <div className="flex justify-end pt-2">
              <Button onClick={() => save.mutate(false)} loading={save.isPending}>
                Save AI settings
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
