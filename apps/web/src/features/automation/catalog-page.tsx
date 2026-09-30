'use client';

import { useQuery } from '@tanstack/react-query';
import { CirclePlay, GitBranch, Zap } from 'lucide-react';
import { WORKFLOW_ACTIONS, WORKFLOW_CONDITIONS, WORKFLOW_TRIGGERS } from '@sellora/shared';
import { api } from '@/lib/api';
import type { CatalogItem } from '@/lib/types';
import { PageHeader } from '@/components/shared/page';
import { Badge, Card, CardContent } from '@/components/ui/primitives';

/** Reference pages for triggers and actions, with how many workflows use each. */
export function CatalogPage({ kind }: { kind: 'triggers' | 'actions' }) {
  const workflows = useQuery({ queryKey: ['workflows'], queryFn: () => api.get<Array<{ triggerType: string; status: string }>>('/workflows') });
  const sections: Array<{ title: string; icon: typeof Zap; items: readonly CatalogItem[] }> =
    kind === 'triggers'
      ? [{ title: 'Triggers', icon: Zap, items: WORKFLOW_TRIGGERS as unknown as CatalogItem[] }]
      : [
          { title: 'Conditions', icon: GitBranch, items: WORKFLOW_CONDITIONS as unknown as CatalogItem[] },
          { title: 'Actions', icon: CirclePlay, items: WORKFLOW_ACTIONS as unknown as CatalogItem[] },
        ];
  const usage = (key: string) => workflows.data?.filter((w) => w.triggerType === key) ?? [];
  return (
    <>
      <PageHeader
        title={kind === 'triggers' ? 'Triggers' : 'Conditions & actions'}
        description={kind === 'triggers' ? 'Events that start a workflow. Each event is emitted by Sellora AI in real time (inactive customers are checked daily).' : 'Building blocks you can combine in the workflow builder.'}
      />
      <div className="space-y-8">
        {sections.map((s) => (
          <section key={s.title}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <s.icon className="size-4 text-primary" /> {s.title}
            </h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {s.items.map((item) => {
                const used = kind === 'triggers' ? usage(item.key) : [];
                return (
                  <Card key={item.key}>
                    <CardContent className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{item.label}</p>
                        {kind === 'triggers' && used.length > 0 && <Badge variant="success">{used.filter((u) => u.status === 'ACTIVE').length} active</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{item.key}</p>
                      {item.fields.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {item.fields.map((f) => (
                            <Badge key={f.key} variant="outline">
                              {f.label}
                              {f.required ? ' *' : ''}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
