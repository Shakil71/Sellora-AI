'use client';

import * as React from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock,
  FileText,
  Info,
  Lock,
  MoreVertical,
  Paperclip,
  RotateCcw,
  Send,
  Smile,
  StickyNote,
  UserRound,
  UserCheck,
  X,
  FlaskConical,
  LayoutTemplate,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage, uploadFile } from '@/lib/api';
import { cn } from '@/lib/utils';
import { dateTime, shortTime } from '@/lib/format';
import type { Conversation, Message } from '@/lib/types';
import { useSession } from '@/components/session';
import { useRealtime } from '@/components/realtime';
import { Avatar, Badge, Skeleton, Tooltip } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/overlays';
import { useMembers } from '@/components/shared/pickers';
import { CustomerPanel } from './customer-panel';

type ConversationDetail = Conversation & { windowOpen: boolean };

const EMOJIS = ['😀', '😊', '😂', '😍', '🙏', '👍', '👌', '🙌', '🎉', '🔥', '💯', '❤️', '✅', '⭐', '📦', '🚚', '💳', '🛍️', '🎁', '⏰', '📞', '👋', '🤝', '😉', '🤔', '😅', '😢', '😮', '👏', '💬', '📍', '✨'];

function StatusIcon({ status, error }: { status: Message['status']; error?: string | null }) {
  switch (status) {
    case 'PENDING':
      return <Clock className="size-3" aria-label="Sending" />;
    case 'SENT':
      return <Check className="size-3" aria-label="Sent" />;
    case 'DELIVERED':
      return <CheckCheck className="size-3" aria-label="Delivered" />;
    case 'READ':
      return <CheckCheck className="size-3 text-info" aria-label="Read" />;
    case 'FAILED':
      return (
        <Tooltip content={error ?? 'Failed to send'}>
          <AlertCircle className="size-3 text-destructive" aria-label="Failed" />
        </Tooltip>
      );
    default:
      return null;
  }
}

function MediaBlock({ m, conversationId }: { m: Message; conversationId: string }) {
  const src = m.mediaUrl ?? (m.mediaId ? `/api/v1/conversations/${conversationId}/messages/${m.id}/media` : null);
  if (!src) return null;
  if (m.type === 'IMAGE' || m.type === 'STICKER') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={m.body ?? 'Image'} className="mb-1 max-h-72 w-full max-w-xs rounded-lg object-cover" loading="lazy" />;
  }
  if (m.type === 'AUDIO') return <audio controls src={src} className="mb-1 w-60 max-w-full" />;
  if (m.type === 'VIDEO') return <video controls src={src} className="mb-1 max-h-72 w-full max-w-xs rounded-lg" />;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 rounded-lg border bg-background/60 px-3 py-2 text-sm hover:bg-background">
      <FileText className="size-4 shrink-0" />
      <span className="truncate">{m.mediaFileName ?? 'Document'}</span>
    </a>
  );
}

function MessageBubble({ m, conversationId, onRetry }: { m: Message; conversationId: string; onRetry: (id: string) => void }) {
  if (m.type === 'SYSTEM') {
    return (
      <div className="my-3 flex justify-center">
        <span className="max-w-[90%] rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">{m.body}</span>
      </div>
    );
  }
  const inbound = m.direction === 'INBOUND';
  const note = m.type === 'NOTE';
  const isAI = m.senderType === 'AI';
  return (
    <div className={cn('group flex gap-2', inbound ? 'justify-start' : 'justify-end')}>
      <div className={cn('max-w-[85%] sm:max-w-[70%]')}>
        {!inbound && (
          <p className={cn('mb-0.5 flex items-center gap-1 text-[11px] text-muted-foreground', 'justify-end')}>
            {note && <Lock className="size-3" />}
            {isAI ? (
              <>
                <Bot className="size-3 text-ai" /> AI agent
              </>
            ) : note ? (
              `Internal note · ${m.senderUser?.name ?? 'Team'}`
            ) : m.senderType === 'SYSTEM' ? (
              'Automated'
            ) : (
              m.senderUser?.name ?? 'Team'
            )}
          </p>
        )}
        <div
          className={cn(
            'rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap shadow-xs',
            inbound && 'rounded-tl-sm border bg-card',
            !inbound && !note && !isAI && 'rounded-tr-sm bg-primary text-primary-foreground',
            isAI && !note && 'rounded-tr-sm border border-ai/20 bg-ai-soft text-foreground',
            note && 'rounded-tr-sm border border-warning/40 bg-warning/12 text-foreground',
            m.status === 'FAILED' && 'ring-1 ring-destructive/50',
          )}
        >
          <MediaBlock m={m} conversationId={conversationId} />
          {m.templateName && <p className="mb-1 text-xs opacity-80">Template · {m.templateName}</p>}
          {m.body && !(m.templateName && m.body.startsWith('Template:')) && <span>{m.body}</span>}
        </div>
        <div className={cn('mt-0.5 flex items-center gap-1 text-[10.5px] text-muted-foreground', inbound ? 'justify-start' : 'justify-end')}>
          <time dateTime={m.createdAt} title={dateTime(m.createdAt)}>
            {shortTime(m.createdAt)}
          </time>
          {!inbound && !note && <StatusIcon status={m.status} error={m.errorMessage} />}
          {m.status === 'FAILED' && (
            <button onClick={() => onRetry(m.id)} className="ml-1 inline-flex items-center gap-0.5 font-medium text-destructive hover:underline">
              <RotateCcw className="size-3" /> Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Composer({ conversation }: { conversation: ConversationDetail }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const { socket } = useRealtime();
  const [text, setText] = React.useState('');
  const [mode, setMode] = React.useState<'reply' | 'note' | 'customer'>('reply');
  const [attachment, setAttachment] = React.useState<{ url: string; mimeType: string; fileName: string } | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const typingTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTest = conversation.channel === 'TEST';
  const windowClosed = !conversation.windowOpen && !isTest;

  const templates = useQuery({
    queryKey: ['templates-approved', conversation.whatsappAccount?.id],
    queryFn: () => api.get<Array<{ id: string; name: string; language: string; status: string; components: Array<{ type: string; text?: string }> }>>('/whatsapp/templates', { accountId: conversation.whatsappAccount?.id }),
    enabled: conversation.channel === 'WHATSAPP',
    select: (d) => d.filter((t) => t.status === 'APPROVED'),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['messages', conversation.id] });
    qc.invalidateQueries({ queryKey: ['conversation', conversation.id] });
    qc.invalidateQueries({ queryKey: ['conversations'] });
  };

  const send = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      mode === 'customer' ? api.post(`/conversations/${conversation.id}/simulate`, { text: body.text }) : api.post(`/conversations/${conversation.id}/messages`, body),
    onSuccess: () => {
      setText('');
      setAttachment(null);
      invalidate();
      taRef.current?.focus();
    },
  });

  const submit = () => {
    const value = text.trim();
    if (!value && !attachment) return;
    if (mode === 'note') return send.mutate({ text: value, note: true });
    if (mode === 'customer') return send.mutate({ text: value });
    send.mutate({ text: value || undefined, attachment: attachment ? { url: attachment.url, mimeType: attachment.mimeType, fileName: attachment.fileName } : undefined });
  };

  const onType = (v: string) => {
    setText(v);
    if (!socket || mode !== 'reply') return;
    socket.emit('typing', { conversationId: conversation.id, typing: true });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socket.emit('typing', { conversationId: conversation.id, typing: false }), 2500);
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadFile(file, 'attachment');
      setAttachment({ url: res.url, mimeType: res.mimeType, fileName: res.name });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const sendTemplate = (t: { name: string; language: string }) => send.mutate({ template: { name: t.name, language: t.language } });

  if (!can('conversations.reply')) {
    return <div className="border-t bg-card p-4 text-center text-sm text-muted-foreground">You have read-only access to conversations.</div>;
  }

  return (
    <div className="border-t bg-card p-2 sm:p-3">
      {windowClosed && mode === 'reply' && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <Clock className="size-3.5 shrink-0" />
          <span className="flex-1">The 24-hour customer service window has closed. WhatsApp only allows approved templates until the customer replies.</span>
        </div>
      )}
      <div className="mb-2 flex items-center gap-1">
        {(['reply', 'note', ...(isTest ? ['customer'] : [])] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m as typeof mode)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
              mode === m ? (m === 'note' ? 'bg-warning/15 text-foreground' : m === 'customer' ? 'bg-ai-soft text-ai' : 'bg-primary/10 text-primary') : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {m === 'reply' && <Send className="size-3" />}
            {m === 'note' && <StickyNote className="size-3" />}
            {m === 'customer' && <FlaskConical className="size-3" />}
            {m === 'reply' ? 'Reply' : m === 'note' ? 'Internal note' : 'Send as customer'}
          </button>
        ))}
      </div>
      {attachment && (
        <div className="mb-2 inline-flex max-w-full items-center gap-2 rounded-md border bg-muted/50 px-2 py-1 text-xs">
          <Paperclip className="size-3.5 shrink-0" />
          <span className="truncate">{attachment.fileName}</span>
          <button onClick={() => setAttachment(null)} aria-label="Remove attachment" className="rounded p-0.5 hover:bg-muted">
            <X className="size-3" />
          </button>
        </div>
      )}
      <div className={cn('flex items-end gap-1.5 rounded-xl border bg-background p-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20', mode === 'note' && 'border-warning/50 bg-warning/5')}>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          disabled={windowClosed && mode === 'reply'}
          placeholder={mode === 'note' ? 'Write a note only your team can see…' : mode === 'customer' ? 'Type what the customer would send…' : windowClosed ? 'Use a template to message this customer' : 'Type a reply… (Shift+Enter for a new line)'}
          aria-label="Message"
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground field-sizing-content disabled:cursor-not-allowed"
        />
        <div className="flex items-center gap-0.5 pb-0.5">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Insert emoji" disabled={windowClosed && mode === 'reply'}>
                <Smile />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-2">
              <div className="grid grid-cols-8 gap-0.5">
                {EMOJIS.map((e) => (
                  <button key={e} onClick={() => setText((t) => t + e)} className="rounded p-1 text-lg hover:bg-muted" aria-label={`Insert ${e}`}>
                    {e}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          {mode === 'reply' && (
            <>
              <Button variant="ghost" size="icon-sm" aria-label="Attach file" onClick={() => fileRef.current?.click()} loading={uploading} disabled={windowClosed}>
                {!uploading && <Paperclip />}
              </Button>
              {conversation.channel === 'WHATSAPP' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Send template">
                      <LayoutTemplate />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-64">
                    <DropdownMenuLabel>Approved templates</DropdownMenuLabel>
                    {!templates.data?.length && <p className="px-2 py-3 text-xs text-muted-foreground">No approved templates. Sync them in WhatsApp → Templates.</p>}
                    {templates.data?.map((t) => (
                      <DropdownMenuItem key={t.id} onSelect={() => sendTemplate(t)}>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{t.name}</p>
                          <p className="line-clamp-2 text-xs text-muted-foreground">{t.components.find((c) => c.type === 'BODY')?.text}</p>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          )}
          <Button size="icon-sm" onClick={submit} loading={send.isPending} disabled={(!text.trim() && !attachment) || (windowClosed && mode === 'reply')} aria-label="Send" variant={mode === 'customer' ? 'ai' : 'default'}>
            {!send.isPending && <Send />}
          </Button>
        </div>
      </div>
      <input ref={fileRef} type="file" hidden accept="image/*,application/pdf,audio/ogg,audio/mpeg,video/mp4" onChange={(e) => onFile(e.target.files?.[0])} />
    </div>
  );
}

export function ChatPanel({ conversationId, onBack }: { conversationId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { can, me } = useSession();
  const { socket } = useRealtime();
  const members = useMembers();
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [typing, setTyping] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const atBottom = React.useRef(true);

  const conv = useQuery({ queryKey: ['conversation', conversationId], queryFn: () => api.get<ConversationDetail>(`/conversations/${conversationId}`) });
  const messages = useInfiniteQuery({
    queryKey: ['messages', conversationId],
    queryFn: ({ pageParam }) => api.get<{ items: Message[]; nextCursor: string | null }>(`/conversations/${conversationId}/messages`, { before: pageParam ?? undefined, limit: 50 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const all = React.useMemo(() => [...(messages.data?.pages ?? [])].reverse().flatMap((p) => p.items), [messages.data]);

  // Join realtime room; mark read on open and when new messages arrive.
  React.useEffect(() => {
    if (!socket) return;
    const join = () => socket.emit('conversation:join', { conversationId });
    join();
    socket.on('connect', join);
    const onTyping = (p: { conversationId: string; name: string; typing: boolean; userId: string }) => {
      if (p.conversationId === conversationId && p.userId !== me.user.id) setTyping(p.typing ? p.name : null);
    };
    socket.on('typing', onTyping);
    return () => {
      socket.emit('conversation:leave', { conversationId });
      socket.off('connect', join);
      socket.off('typing', onTyping);
    };
  }, [socket, conversationId, me.user.id]);

  const markRead = useMutation({
    mutationFn: () => api.post(`/conversations/${conversationId}/read`),
    meta: { silent: true },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['conversation-counts'] });
    },
  });
  const unread = conv.data?.unreadCount ?? 0;
  React.useEffect(() => {
    if (unread > 0) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread, conversationId]);

  // Keep the view pinned to the latest message.
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [all.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && messages.hasNextPage && !messages.isFetchingNextPage) {
      const prevHeight = el.scrollHeight;
      messages.fetchNextPage().then(() => requestAnimationFrame(() => (el.scrollTop = el.scrollHeight - prevHeight)));
    }
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
    qc.invalidateQueries({ queryKey: ['conversations'] });
    qc.invalidateQueries({ queryKey: ['messages', conversationId] });
  };
  const assign = useMutation({ mutationFn: (userId: string | null) => api.post(`/conversations/${conversationId}/assign`, { userId }), onSuccess: refresh });
  const handler = useMutation({ mutationFn: (h: 'AI' | 'HUMAN') => api.post(`/conversations/${conversationId}/handler`, { handler: h }), onSuccess: refresh });
  const status = useMutation({
    mutationFn: (s: string) => api.post(`/conversations/${conversationId}/status`, { status: s }),
    onSuccess: (_d, s) => {
      refresh();
      toast.success(`Conversation marked as ${s.toLowerCase()}`);
    },
  });
  const retry = useMutation({ mutationFn: (id: string) => api.post(`/conversations/${conversationId}/messages/${id}/retry`), onSuccess: refresh });

  const c = conv.data;
  if (conv.isLoading || !c) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex h-14 items-center gap-3 border-b px-4">
          <Skeleton className="size-9 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex-1 space-y-4 p-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className={cn('h-12 w-2/3', i % 2 && 'ml-auto')} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1">
      <section aria-label={`Conversation with ${c.customer.name}`} className="flex min-w-0 flex-1 flex-col bg-muted/25">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-2 sm:px-4">
          <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onBack} aria-label="Back to conversations">
            <ArrowLeft />
          </Button>
          <Avatar name={c.customer.name} src={c.customer.avatarUrl} size={34} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{c.customer.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {c.channel === 'TEST' ? 'Test conversation' : (c.customer.whatsappNumber ?? 'WhatsApp')}
              {c.whatsappAccount && ` · via ${c.whatsappAccount.name}`}
            </p>
          </div>
          {can('conversations.reply') && (
            <Tooltip content={c.handler === 'AI' ? 'AI agent is replying — take over to reply yourself' : 'A human is handling this — hand back to the AI agent'}>
              <Button
                variant={c.handler === 'AI' ? 'outline' : 'ai'}
                size="sm"
                onClick={() => handler.mutate(c.handler === 'AI' ? 'HUMAN' : 'AI')}
                loading={handler.isPending}
                className="hidden sm:inline-flex"
              >
                {c.handler === 'AI' ? <UserCheck /> : <Bot />}
                {c.handler === 'AI' ? 'Take over' : 'Hand to AI'}
              </Button>
            </Tooltip>
          )}
          {can('conversations.close') && c.status !== 'RESOLVED' && (
            <Button variant="outline" size="sm" onClick={() => status.mutate('RESOLVED')} loading={status.isPending} className="hidden lg:inline-flex">
              <CheckCircle2 /> Resolve
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Conversation actions">
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-60">
              {can('conversations.reply') && (
                <DropdownMenuItem className="sm:hidden" onSelect={() => handler.mutate(c.handler === 'AI' ? 'HUMAN' : 'AI')}>
                  {c.handler === 'AI' ? <UserCheck /> : <Bot />} {c.handler === 'AI' ? 'Take over from AI' : 'Hand to AI agent'}
                </DropdownMenuItem>
              )}
              {can('conversations.close') && (
                <>
                  <DropdownMenuLabel>Status</DropdownMenuLabel>
                  {(['OPEN', 'PENDING', 'RESOLVED', 'CLOSED'] as const).map((s) => (
                    <DropdownMenuItem key={s} onSelect={() => status.mutate(s)} disabled={c.status === s}>
                      {c.status === s ? <Check className="text-primary" /> : <span className="size-4" />}
                      {s.charAt(0) + s.slice(1).toLowerCase()}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {can('conversations.assign') && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Assign to</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => assign.mutate(me.user.id)}>
                    <UserRound /> Me
                  </DropdownMenuItem>
                  {members.data
                    ?.filter((m) => m.id !== me.user.id)
                    .map((m) => (
                      <DropdownMenuItem key={m.id} onSelect={() => assign.mutate(m.id)}>
                        {c.assignedUserId === m.id ? <Check className="text-primary" /> : <span className="size-4" />}
                        {m.name}
                      </DropdownMenuItem>
                    ))}
                  {c.assignedUserId && (
                    <DropdownMenuItem onSelect={() => assign.mutate(null)}>
                      <X /> Unassign
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon-sm" className="xl:hidden" onClick={() => setPanelOpen(true)} aria-label="Customer details">
            <Info />
          </Button>
        </header>

        <div className="flex items-center gap-2 border-b bg-card/60 px-4 py-1.5 text-xs text-muted-foreground">
          {c.handler === 'AI' ? (
            <span className="inline-flex items-center gap-1 text-ai">
              <Bot className="size-3.5" /> {c.aiAgent?.name ?? 'AI agent'} is handling this conversation
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <UserRound className="size-3.5" /> {c.assignedUser ? `Assigned to ${c.assignedUser.name}` : 'Human handling · unassigned'}
            </span>
          )}
          {c.handoffReason && c.handler === 'HUMAN' && <span className="hidden truncate md:inline">· {c.handoffReason}</span>}
          <Badge variant={c.status === 'OPEN' ? 'info' : c.status === 'PENDING' ? 'warning' : c.status === 'RESOLVED' ? 'success' : 'muted'} className="ml-auto">
            {c.status.charAt(0) + c.status.slice(1).toLowerCase()}
          </Badge>
        </div>

        <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-4 scrollbar-thin sm:px-6" aria-live="polite">
          {messages.isFetchingNextPage && <p className="text-center text-xs text-muted-foreground">Loading earlier messages…</p>}
          {messages.isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className={cn('h-12 w-2/3', i % 2 && 'ml-auto')} />)}
          {all.map((m) => (
            <MessageBubble key={m.id} m={m} conversationId={conversationId} onRetry={(id) => retry.mutate(id)} />
          ))}
          {typing && <p className="text-xs text-muted-foreground italic">{typing} is typing…</p>}
        </div>
        <Composer conversation={c} />
      </section>

      <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l bg-card scrollbar-thin xl:block">
        <CustomerPanel conversation={c} />
      </aside>
      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent side="right" className="p-0">
          <SheetTitle className="sr-only">Customer details</SheetTitle>
          <div className="overflow-y-auto">
            <CustomerPanel conversation={c} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

