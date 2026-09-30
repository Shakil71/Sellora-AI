'use client';

import * as React from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, FlaskConical, Inbox as InboxIcon, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { api } from '@/lib/api';
import { shortTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Conversation } from '@/lib/types';
import { useSession } from '@/components/session';
import { Avatar, Badge, Input, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';
import { EmptyState } from '@/components/shared/page';
import { ChannelBadge } from '@/components/shared/channel-badge';
import { ChatPanel } from './chat-panel';
import { toast } from 'sonner';

type View = 'all' | 'mine' | 'unassigned' | 'unread' | 'ai' | 'human';
const VIEWS: Array<{ value: View; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'unread', label: 'Unread' },
  { value: 'ai', label: 'AI' },
  { value: 'human', label: 'Human' },
];

function ConversationRow({ c, active, onClick }: { c: Conversation; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-start gap-3 border-b px-3 py-3 text-left transition-colors last:border-b-0 sm:px-4',
        active ? 'bg-accent' : 'hover:bg-muted/50',
      )}
    >
      <div className="relative">
        <Avatar name={c.customer.name} src={c.customer.avatarUrl} size={38} />
        {c.handler === 'AI' && (
          <span className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-ai text-white ring-2 ring-card" title="AI agent">
            <Bot className="size-2.5" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={cn('truncate text-sm', c.unreadCount > 0 ? 'font-semibold' : 'font-medium')}>{c.customer.name}</p>
          {c.channel !== 'WHATSAPP' && <ChannelBadge channel={c.channel} compact={c.channel !== 'TEST'} />}
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{shortTime(c.lastMessageAt)}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <p className={cn('line-clamp-1 flex-1 text-[13px]', c.unreadCount > 0 ? 'text-foreground' : 'text-muted-foreground')}>{c.lastMessagePreview ?? 'No messages yet'}</p>
          {c.unreadCount > 0 && <span className="shrink-0 rounded-full bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground tabular">{c.unreadCount}</span>}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          {c.status === 'PENDING' && <Badge variant="warning">Pending</Badge>}
          {c.status === 'RESOLVED' && <Badge variant="success">Resolved</Badge>}
          {c.status === 'CLOSED' && <Badge variant="muted">Closed</Badge>}
          {c.assignedUser && <span className="truncate text-[11px] text-muted-foreground">→ {c.assignedUser.name}</span>}
          {!c.assignedUser && c.handler === 'HUMAN' && <span className="text-[11px] text-warning">Unassigned</span>}
        </div>
      </div>
    </button>
  );
}

export function InboxView({ selectedId, onSelect, channel }: { selectedId: string | null; onSelect: (id: string | null) => void; channel?: string }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const [view, setView] = React.useState<View>('all');
  const [statusGroup, setStatusGroup] = React.useState<'active' | 'closed' | 'any'>('active');
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const counts = useQuery({ queryKey: ['conversation-counts'], queryFn: () => api.get<Record<View, number>>('/conversations/counts'), refetchInterval: 60_000 });
  const list = useInfiniteQuery({
    queryKey: ['conversations', view, statusGroup, debounced, channel],
    queryFn: ({ pageParam }) =>
      api.get<{ items: Conversation[]; nextCursor: string | null }>('/conversations', { view, statusGroup, search: debounced, channel, cursor: pageParam ?? undefined, limit: 25 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const conversations = list.data?.pages.flatMap((p) => p.items) ?? [];

  const createTest = useMutation({
    mutationFn: () => api.post<{ id: string }>('/conversations/test', { customerName: 'Test customer' }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      onSelect(c.id);
      toast.success('Test conversation created — type as the customer to try your AI agent.');
    },
  });

  // Infinite scroll sentinel
  const sentinel = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [list]);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 overflow-hidden">
      {/* Conversation list */}
      <section
        aria-label="Conversations"
        className={cn('flex w-full min-w-0 flex-col border-r bg-card md:w-[320px] md:shrink-0 lg:w-[340px]', selectedId && 'hidden md:flex')}
      >
        <div className="space-y-3 border-b p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-base font-semibold">{channel === 'WHATSAPP' ? 'WhatsApp inbox' : 'Inbox'}</h1>
            <div className="flex items-center gap-1">
              <Select value={statusGroup} onValueChange={(v) => setStatusGroup(v as typeof statusGroup)}>
                <SelectTrigger size="sm" className="w-auto gap-1.5" aria-label="Status filter">
                  <SlidersHorizontal className="size-3.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="any">All</SelectItem>
                </SelectContent>
              </Select>
              {can(['conversations.reply', 'contacts.create']) && (
                <Button variant="outline" size="icon-sm" onClick={() => createTest.mutate()} loading={createTest.isPending} aria-label="New test conversation" title="New test conversation">
                  {!createTest.isPending && <FlaskConical />}
                </Button>
              )}
            </div>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, number or message" className="pl-8" aria-label="Search conversations" />
          </div>
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 scrollbar-thin" role="tablist" aria-label="Conversation views">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                role="tab"
                aria-selected={view === v.value}
                onClick={() => setView(v.value)}
                className={cn(
                  'inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors',
                  view === v.value ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {v.label}
                {counts.data && <span className="tabular opacity-70">{counts.data[v.value] ?? 0}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {list.isLoading &&
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex gap-3 border-b p-4">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          {!list.isLoading && conversations.length === 0 && (
            <EmptyState
              icon={InboxIcon}
              title={debounced ? 'No matches' : 'No conversations yet'}
              description={debounced ? 'Try a different search.' : 'Connect WhatsApp to start receiving customer messages, or start a test conversation to try your AI agent.'}
              action={
                !debounced && can(['conversations.reply', 'contacts.create']) ? (
                  <Button size="sm" variant="outline" onClick={() => createTest.mutate()}>
                    <Plus /> Test conversation
                  </Button>
                ) : undefined
              }
            />
          )}
          {conversations.map((c) => (
            <ConversationRow key={c.id} c={c} active={c.id === selectedId} onClick={() => onSelect(c.id)} />
          ))}
          <div ref={sentinel} className="h-6" />
          {list.isFetchingNextPage && <p className="pb-4 text-center text-xs text-muted-foreground">Loading more…</p>}
        </div>
      </section>

      {/* Chat + customer panel */}
      {selectedId ? (
        <ChatPanel key={selectedId} conversationId={selectedId} onBack={() => onSelect(null)} />
      ) : (
        <div className="hidden flex-1 items-center justify-center bg-muted/30 md:flex">
          <EmptyState icon={InboxIcon} title="Select a conversation" description="Pick a conversation from the list to read and reply. New messages appear here in real time." />
        </div>
      )}
    </div>
  );
}
