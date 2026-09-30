'use client';

import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { CONVERSATION_STATUS } from '@/lib/status';
import type { Conversation } from '@/lib/types';
import { EmptyState, PageHeader, StatusBadge } from '@/components/shared/page';
import { Avatar, Card, CardContent, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

export default function SummariesPage() {
  const q = useInfiniteQuery({
    queryKey: ['conversations', 'summaries'],
    queryFn: ({ pageParam }) => api.get<{ items: Conversation[]; nextCursor: string | null }>('/conversations', { statusGroup: 'any', hasSummary: 'true', cursor: pageParam ?? undefined, limit: 20 }),
    initialPageParam: null as string | null,
    getNextPageParam: (l) => l.nextCursor,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHeader title="Conversation summaries" description="AI-written summaries created when a conversation is handed to a human or resolved." />
      {q.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : !items.length ? (
        <Card>
          <EmptyState icon={Sparkles} title="No summaries yet" description="Summaries are generated automatically when AI is configured and a conversation is escalated or resolved." />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((c) => (
            <Link key={c.id} href={`/inbox?conversation=${c.id}`} className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={c.customer.name} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{c.customer.name}</p>
                      <p className="text-xs text-muted-foreground">Updated {relative(c.summaryUpdatedAt ?? c.lastMessageAt)}</p>
                    </div>
                    <StatusBadge map={CONVERSATION_STATUS} value={c.status} />
                  </div>
                  <p className="text-sm whitespace-pre-line text-muted-foreground">{c.summary}</p>
                  {c.handoffReason && <p className="text-xs text-ai">Escalation: {c.handoffReason}</p>}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {q.hasNextPage && (
        <div className="mt-4 text-center">
          <Button variant="outline" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      )}
    </>
  );
}
