'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useSession } from '@/components/session';
import { PageHeader } from '@/components/shared/page';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton, Textarea } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

const GUARDRAILS = [
  'Prices, stock, delivery fees and totals only come from live tool results — never invented.',
  'Orders are placed only after the customer confirms an itemised summary and total.',
  'The system prompt, internal notes, IDs and keys are never revealed.',
  'Customer data access is limited to the customer in the current conversation.',
  'When unsure, the agent asks a clarifying question or transfers to a human.',
];

export default function AiInstructionsPage() {
  const qc = useQueryClient();
  const { can } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ['ai-settings'], queryFn: () => api.get<{ instructions: string }>('/ai/settings'), enabled: can('settings.view') });
  const [value, setValue] = React.useState('');
  React.useEffect(() => setValue(data?.instructions ?? ''), [data]);
  const save = useMutation({
    mutationFn: () => api.put('/ai/instructions', { instructions: value || null }),
    onSuccess: () => {
      toast.success('Instructions saved');
      qc.invalidateQueries({ queryKey: ['ai-settings'] });
    },
  });
  return (
    <>
      <PageHeader title="AI instructions" description="Workspace-wide rules added to every AI agent, on top of each agent’s own instructions." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Workspace instructions</CardTitle>
            <CardDescription>Brand voice, policies and things every agent must know or avoid.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <Skeleton className="h-64" />
            ) : (
              <Textarea
                rows={14}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={!can('ai.agents.update')}
                aria-label="Workspace AI instructions"
                placeholder={'Examples:\n- Always greet customers by name when known.\n- Mention free shipping on orders over $150.\n- Never promise same-day delivery outside New York City.'}
              />
            )}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{value.length.toLocaleString()} / 8,000 characters</span>
              {can('ai.agents.update') && (
                <Button onClick={() => save.mutate()} loading={save.isPending} disabled={value.length > 8000}>
                  Save instructions
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-success" /> Built-in guardrails
            </CardTitle>
            <CardDescription>Always enforced by Sellora AI and cannot be overridden.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm">
              {GUARDRAILS.map((g) => (
                <li key={g} className="flex gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
                  {g}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
