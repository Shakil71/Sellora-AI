'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Bot, BookOpen, MessagesSquare, Plus, Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import { useSession } from '@/components/session';
import { EmptyState, PageHeader } from '@/components/shared/page';
import { Badge, Card, CardContent, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { AiNotConfigured } from '@/features/ai/ai-not-configured';

interface AgentRow {
  id: string;
  name: string;
  description: string | null;
  tone: string;
  language: string;
  isActive: boolean;
  isDefault: boolean;
  enabledTools: string[];
  knowledgeBases: Array<{ id: string; name: string }>;
  conversationCount: number;
  toolCallCount: number;
}

export default function AgentsPage() {
  const { can } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ['ai-agents'], queryFn: () => api.get<{ aiConfigured: boolean; agents: AgentRow[] }>('/ai/agents') });
  return (
    <>
      <PageHeader
        title="AI agents"
        description="AI sales assistants that answer customers, recommend products and take orders through controlled tools."
        actions={
          can('ai.agents.create') && (
            <Button asChild>
              <Link href="/ai/agents/new">
                <Plus /> New agent
              </Link>
            </Button>
          )
        }
      />
      {data && !data.aiConfigured && <AiNotConfigured />}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}</div>
      ) : !data?.agents.length ? (
        <Card>
          <EmptyState
            icon={Bot}
            title="No AI agents yet"
            description="Create a Sales Assistant to answer questions, recommend products and take orders on WhatsApp."
            action={can('ai.agents.create') ? <Button asChild><Link href="/ai/agents/new"><Plus /> Create agent</Link></Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.agents.map((a) => (
            <Link key={a.id} href={`/ai/agents/${a.id}`} className="group rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <Card className="h-full transition-colors group-hover:border-primary/40">
                <CardContent className="space-y-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ai-soft text-ai">
                      <Bot className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-semibold">
                        {a.name}
                        {a.isDefault && <Badge variant="secondary">Default</Badge>}
                        <Badge variant={a.isActive ? 'success' : 'muted'}>{a.isActive ? 'Active' : 'Paused'}</Badge>
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{a.description ?? 'No description'}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-muted/60 p-2">
                      <MessagesSquare className="mx-auto mb-1 size-3.5 text-muted-foreground" />
                      <p className="font-semibold tabular">{a.conversationCount}</p>
                      <p className="text-muted-foreground">conversations</p>
                    </div>
                    <div className="rounded-lg bg-muted/60 p-2">
                      <Wrench className="mx-auto mb-1 size-3.5 text-muted-foreground" />
                      <p className="font-semibold tabular">{a.enabledTools.length}</p>
                      <p className="text-muted-foreground">tools</p>
                    </div>
                    <div className="rounded-lg bg-muted/60 p-2">
                      <BookOpen className="mx-auto mb-1 size-3.5 text-muted-foreground" />
                      <p className="font-semibold tabular">{a.knowledgeBases.length}</p>
                      <p className="text-muted-foreground">knowledge</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Tone: {a.tone} · Language: {a.language === 'auto' ? 'matches customer' : a.language}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
