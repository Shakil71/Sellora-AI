'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Bot, MessagesSquare, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { CONVERSATION_STATUS } from '@/lib/status';
import type { Conversation } from '@/lib/types';
import { PageHeader, StatusBadge } from '@/components/shared/page';
import { DataTable, FilterChips, SearchInput, Toolbar } from '@/components/shared/data-table';
import { Avatar, Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';

export default function ConversationsPage() {
  const router = useRouter();
  const [status, setStatus] = React.useState<string>('ANY');
  const [view, setView] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const q = useInfiniteQuery({
    queryKey: ['conversations', 'table', status, view, search],
    queryFn: ({ pageParam }) =>
      api.get<{ items: Conversation[]; nextCursor: string | null }>('/conversations', {
        view,
        statusGroup: 'any',
        status: status === 'ANY' ? undefined : status,
        search: search || undefined,
        cursor: pageParam ?? undefined,
        limit: 25,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (l) => l.nextCursor,
  });
  const rows = q.data?.pages.flatMap((p) => p.items);
  return (
    <>
      <PageHeader title="Conversations" description="Every conversation across channels, including resolved and closed ones." actions={<Button variant="outline" onClick={() => router.push('/inbox')}>Open inbox</Button>} />
      <Toolbar>
        <FilterChips
          value={view}
          onChange={setView}
          options={[
            { value: 'all', label: 'All' },
            { value: 'ai', label: 'AI handled' },
            { value: 'human', label: 'Human handled' },
            { value: 'unassigned', label: 'Unassigned' },
            { value: 'mine', label: 'Mine' },
          ]}
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-40" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ANY">Any status</SelectItem>
            {Object.entries(CONVERSATION_STATUS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SearchInput value={search} onChange={setSearch} placeholder="Customer or message" className="sm:ml-auto" />
      </Toolbar>
      <DataTable
        rows={rows}
        loading={q.isLoading}
        onRowClick={(c) => router.push(`/inbox?conversation=${c.id}`)}
        empty={{ icon: MessagesSquare, title: 'No conversations', description: 'Connect WhatsApp to start receiving customer messages.' }}
        mobileCard={(c) => (
          <div className="flex items-center gap-3">
            <Avatar name={c.customer.name} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{c.customer.name}</p>
              <p className="truncate text-xs text-muted-foreground">{c.lastMessagePreview ?? '—'}</p>
            </div>
            <StatusBadge map={CONVERSATION_STATUS} value={c.status} />
          </div>
        )}
        columns={[
          {
            key: 'customer',
            header: 'Customer',
            cell: (c) => (
              <div className="flex items-center gap-3">
                <Avatar name={c.customer.name} size={30} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.customer.name}</p>
                  <p className="line-clamp-1 max-w-sm text-xs text-muted-foreground">{c.lastMessagePreview ?? '—'}</p>
                </div>
              </div>
            ),
          },
          { key: 'channel', header: 'Channel', hideBelow: 'lg', cell: (c) => <Badge variant="outline">{c.channel === 'TEST' ? 'Test' : 'WhatsApp'}</Badge> },
          {
            key: 'handler',
            header: 'Handled by',
            hideBelow: 'md',
            cell: (c) =>
              c.handler === 'AI' ? (
                <span className="flex items-center gap-1.5 text-ai"><Bot className="size-4" /> {c.aiAgent?.name ?? 'AI'}</span>
              ) : (
                <span className="flex items-center gap-1.5"><UserRound className="size-4 text-muted-foreground" /> {c.assignedUser?.name ?? 'Unassigned'}</span>
              ),
          },
          { key: 'status', header: 'Status', cell: (c) => <StatusBadge map={CONVERSATION_STATUS} value={c.status} /> },
          { key: 'last', header: 'Last message', align: 'right', cell: (c) => <span className="text-muted-foreground">{relative(c.lastMessageAt)}</span> },
        ]}
        footer={
          q.hasNextPage && (
            <div className="border-t p-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
                Load more
              </Button>
            </div>
          )
        }
      />
    </>
  );
}
