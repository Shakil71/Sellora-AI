'use client';

import * as React from 'react';
import { ArrowUp, Bot, Loader2, MessageCircle, X } from 'lucide-react';

interface Config {
  businessName: string;
  logoUrl: string | null;
  title: string;
  greeting: string;
  color: string;
  position: 'left' | 'right';
  askForContact: boolean;
}

interface ChatMessage {
  id: string;
  from: 'visitor' | 'ai' | 'agent';
  agentName: string | null;
  type: string;
  text: string | null;
  mediaUrl: string | null;
  createdAt: string;
  pending?: boolean;
}

type Phase = 'loading' | 'ready' | 'unavailable';

/** Picks readable text (white or near-black) for the brand colour. */
function onColor(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return lum > 0.45 ? '#111827' : '#ffffff';
}

function toParent(type: string, data: Record<string, unknown> = {}) {
  if (window.parent !== window)
    window.parent.postMessage({ source: 'sellora-widget', type, ...data }, '*');
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function WebChatWidget({ widgetKey }: { widgetKey: string }) {
  const embedOrigin = React.useMemo(
    () =>
      typeof window === 'undefined'
        ? ''
        : (new URLSearchParams(window.location.search).get('origin') ?? ''),
    [],
  );
  const storageKey = `sellora-chat:${widgetKey}`;
  const [phase, setPhase] = React.useState<Phase>('loading');
  const [config, setConfig] = React.useState<Config | null>(null);
  // ?preview=1 (Integrations → Website chat → Preview) starts with the window open.
  const [open, setOpen] = React.useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('preview') === '1',
  );
  const [mobile, setMobile] = React.useState(false);
  const [token, setToken] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [handler, setHandler] = React.useState<string | null>(null);
  const [unread, setUnread] = React.useState(0);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [contact, setContact] = React.useState({ name: '', email: '', phone: '' });
  const listRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const lastSeen = React.useRef<string | null>(null);
  const openRef = React.useRef(open);
  React.useEffect(() => {
    openRef.current = open;
  }, [open]);
  // Coarse clock for the typing indicator (re-evaluated every few seconds).
  const [now, setNow] = React.useState(0);
  React.useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const every = setInterval(() => setNow(Date.now()), 4000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);

  const api = React.useCallback(
    async <T,>(
      path: string,
      init: RequestInit = {},
      withToken: string | null = token,
    ): Promise<T> => {
      const res = await fetch(`/api/v1/public/webchat/${encodeURIComponent(widgetKey)}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(embedOrigin ? { 'x-embed-origin': embedOrigin } : {}),
          ...(withToken ? { 'x-visitor-token': withToken } : {}),
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) {
        const err = new Error(
          json.error?.message ?? 'Something went wrong. Please try again.',
        ) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      return json.data as T;
    },
    [widgetKey, embedOrigin, token],
  );

  // Transparent page so only the bubble/panel is visible on the host website.
  React.useEffect(() => {
    const html = document.documentElement;
    html.style.background = 'transparent';
    html.style.colorScheme = 'light';
    html.classList.remove('dark');
    document.body.style.background = 'transparent';
    document.body.style.overflow = 'hidden';
    try {
      setToken(window.localStorage.getItem(storageKey));
    } catch {
      /* storage blocked: session lasts for this page view */
    }
  }, [storageKey]);

  React.useEffect(() => {
    api<Config>('/config', {}, null)
      .then((c) => {
        setConfig(c);
        setPhase('ready');
        toParent('ready', { position: c.position });
      })
      .catch(() => setPhase('unavailable'));
  }, [api]);

  // Messages from the host page (open/close API, viewport size).
  React.useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { source?: string; type?: string; mobile?: boolean } | null;
      if (!d || d.source !== 'sellora-host') return;
      if (typeof d.mobile === 'boolean') setMobile(d.mobile);
      if (d.type === 'open') setOpen(true);
      if (d.type === 'close') setOpen(false);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  React.useEffect(() => {
    toParent('state', { open });
    if (open) {
      setUnread(0);
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  const saveToken = (t: string | null) => {
    setToken(t);
    try {
      if (t) window.localStorage.setItem(storageKey, t);
      else window.localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  };

  /**
   * Adds server messages to what is on screen. Never drops local messages:
   * the first history load can race with the visitor's first send, and
   * replacing the list would hide the message they just typed.
   */
  const merge = React.useCallback((incoming: ChatMessage[]) => {
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      return [...prev, ...incoming.filter((m) => !seen.has(m.id))].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
    });
    for (const m of incoming)
      if (!lastSeen.current || m.createdAt > lastSeen.current) lastSeen.current = m.createdAt;
    const replies = incoming.filter((m) => m.from !== 'visitor').length;
    if (replies && !openRef.current) setUnread((u) => u + replies);
  }, []);

  // Initial history + polling (faster while the window is open).
  React.useEffect(() => {
    if (!token || phase !== 'ready') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async (first: boolean) => {
      try {
        const q =
          !first && lastSeen.current ? `?after=${encodeURIComponent(lastSeen.current)}` : '';
        const data = await api<{ messages: ChatMessage[]; handler: string | null }>(
          `/messages${q}`,
        );
        if (cancelled) return;
        setHandler(data.handler);
        if (first) {
          merge(data.messages);
          setUnread(0);
        } else if (data.messages.length) merge(data.messages);
      } catch (err) {
        if ((err as { status?: number }).status === 401) saveToken(null);
      }
      if (!cancelled) timer = setTimeout(() => tick(false), openRef.current ? 3000 : 20000);
    };
    void tick(true);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, phase]);

  React.useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open]);

  const ensureSession = async (): Promise<string> => {
    if (token) return token;
    const body = {
      name: contact.name || undefined,
      email: contact.email || undefined,
      phone: contact.phone || undefined,
    };
    const s = await api<{ token: string }>(
      '/sessions',
      { method: 'POST', body: JSON.stringify(body) },
      null,
    );
    saveToken(s.token);
    return s.token;
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    const temp: ChatMessage = {
      id: `tmp-${Date.now()}`,
      from: 'visitor',
      agentName: null,
      type: 'TEXT',
      text,
      mediaUrl: null,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setMessages((m) => [...m, temp]);
    setDraft('');
    try {
      let t = await ensureSession();
      let saved: ChatMessage;
      try {
        saved = await api<ChatMessage>(
          '/messages',
          { method: 'POST', body: JSON.stringify({ text }) },
          t,
        );
      } catch (err) {
        if ((err as { status?: number }).status !== 401) throw err;
        saveToken(null); // expired session: start a fresh one and retry once
        t = await ensureSession();
        saved = await api<ChatMessage>(
          '/messages',
          { method: 'POST', body: JSON.stringify({ text }) },
          t,
        );
      }
      // A poll may already have added the saved message: then just drop the placeholder.
      setMessages((m) =>
        m.some((x) => x.id === saved.id)
          ? m.filter((x) => x.id !== temp.id)
          : m.map((x) => (x.id === temp.id ? saved : x)),
      );
      if (!lastSeen.current || saved.createdAt > lastSeen.current)
        lastSeen.current = saved.createdAt;
      setHandler((h) => h ?? 'AI');
    } catch (err) {
      setMessages((m) => m.filter((x) => x.id !== temp.id));
      setDraft(text);
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const startWithContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!contact.email && !contact.phone) {
      setError('Please enter your email or phone number.');
      return;
    }
    try {
      await ensureSession();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (phase !== 'ready' || !config) return null;

  const accent = config.color;
  const fg = onColor(accent);
  const left = config.position === 'left';
  const last = messages[messages.length - 1];
  const waiting = Boolean(
    last &&
    last.from === 'visitor' &&
    handler === 'AI' &&
    now > 0 &&
    now - Date.parse(last.createdAt) < 60_000,
  );
  const needsContact = config.askForContact && !token;
  const initial = (config.businessName || config.title).trim().charAt(0).toUpperCase();

  if (!open) {
    return (
      <div
        className="fixed inset-0 flex items-end p-3.5"
        style={{ justifyContent: left ? 'flex-start' : 'flex-end' }}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={
            unread ? `Open chat, ${unread} new message${unread > 1 ? 's' : ''}` : 'Open chat'
          }
          className="relative flex size-[60px] items-center justify-center rounded-full shadow-[0_8px_24px_rgba(0,0,0,0.22)] transition-transform hover:scale-105 focus-visible:ring-4 focus-visible:ring-black/20 focus-visible:outline-none"
          style={{ background: accent, color: fg }}
        >
          <MessageCircle className="size-7" aria-hidden />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-semibold text-white ring-2 ring-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      className={mobile ? 'fixed inset-0' : 'fixed inset-0 p-3'}
      style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif' }}
    >
      <section
        role="dialog"
        aria-label={config.title}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className={`flex h-full w-full flex-col overflow-hidden bg-white text-neutral-900 ${mobile ? '' : 'rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.25)] ring-1 ring-black/5'}`}
      >
        <header
          className="flex items-center gap-3 px-4 py-3.5"
          style={{ background: accent, color: fg }}
        >
          {config.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={config.logoUrl}
              alt=""
              className="size-10 rounded-full bg-white object-cover"
            />
          ) : (
            <span className="flex size-10 items-center justify-center rounded-full bg-white/20 text-base font-semibold">
              {initial}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] leading-tight font-semibold">{config.title}</p>
            <p className="truncate text-xs opacity-85">{config.businessName}</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close chat"
            className="flex size-9 items-center justify-center rounded-full hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-current focus-visible:outline-none"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>

        <div
          ref={listRef}
          className="flex-1 space-y-3 overflow-y-auto bg-neutral-50 px-4 py-4"
          aria-live="polite"
        >
          {config.greeting && (
            <div className="flex items-end gap-2">
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                style={{ background: accent, color: fg }}
                aria-hidden
              >
                {initial}
              </span>
              <p className="max-w-[80%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-[14px] leading-relaxed shadow-sm ring-1 ring-black/5">
                {config.greeting}
              </p>
            </div>
          )}
          {messages.map((m) => {
            const mine = m.from === 'visitor';
            return (
              <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                {!mine && (
                  <span className="mb-1 ml-9 flex items-center gap-1 text-[11px] text-neutral-500">
                    {m.from === 'ai' ? (
                      <>
                        <Bot className="size-3" aria-hidden /> AI assistant
                      </>
                    ) : (
                      (m.agentName ?? config.businessName)
                    )}
                  </span>
                )}
                <div className={`flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                  {!mine && (
                    <span
                      className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                      style={{ background: accent, color: fg }}
                      aria-hidden
                    >
                      {initial}
                    </span>
                  )}
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap shadow-sm ${mine ? 'rounded-br-md' : 'rounded-bl-md bg-white ring-1 ring-black/5'} ${m.pending ? 'opacity-70' : ''}`}
                    style={mine ? { background: accent, color: fg } : undefined}
                  >
                    {m.mediaUrl && m.type === 'IMAGE' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.mediaUrl}
                        alt="Shared image"
                        className="mb-1 max-h-60 rounded-lg"
                      />
                    ) : m.mediaUrl ? (
                      <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="underline">
                        Open attachment
                      </a>
                    ) : null}
                    {m.text}
                  </div>
                </div>
                <span className={`mt-1 text-[10px] text-neutral-400 ${mine ? 'mr-1' : 'ml-9'}`}>
                  {m.pending ? 'Sending…' : timeLabel(m.createdAt)}
                </span>
              </div>
            );
          })}
          {waiting && (
            <div className="flex items-end gap-2" aria-label="Assistant is typing">
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                style={{ background: accent, color: fg }}
                aria-hidden
              >
                {initial}
              </span>
              <span className="flex gap-1 rounded-2xl rounded-bl-md bg-white px-3.5 py-3 shadow-sm ring-1 ring-black/5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="size-1.5 animate-bounce rounded-full bg-neutral-400"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </span>
            </div>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700"
          >
            {error}
          </p>
        )}

        {needsContact ? (
          <form
            onSubmit={startWithContact}
            className="space-y-2.5 border-t border-neutral-200 bg-white p-4"
          >
            <p className="text-sm font-medium">Tell us how to reach you</p>
            {(['name', 'email', 'phone'] as const).map((f) => (
              <input
                key={f}
                type={f === 'email' ? 'email' : f === 'phone' ? 'tel' : 'text'}
                autoComplete={f === 'name' ? 'name' : f}
                placeholder={
                  f === 'name'
                    ? 'Your name'
                    : f === 'email'
                      ? 'Email'
                      : 'Phone (optional if email given)'
                }
                aria-label={f}
                value={contact[f]}
                onChange={(e) => setContact({ ...contact, [f]: e.target.value })}
                className="h-10 w-full rounded-lg border border-neutral-300 px-3 text-sm outline-none focus:border-neutral-500"
              />
            ))}
            <button
              type="submit"
              className="h-10 w-full rounded-lg text-sm font-semibold"
              style={{ background: accent, color: fg }}
            >
              Start chat
            </button>
          </form>
        ) : (
          <form
            onSubmit={send}
            className="flex items-end gap-2 border-t border-neutral-200 bg-white p-3"
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              maxLength={2000}
              onChange={(e) => {
                setDraft(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Type your message…"
              aria-label="Message"
              className="max-h-[120px] min-h-10 flex-1 resize-none rounded-xl border border-neutral-300 px-3 py-2.5 text-sm leading-5 outline-none focus:border-neutral-500"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending}
              aria-label="Send message"
              className="flex size-10 shrink-0 items-center justify-center rounded-xl transition disabled:opacity-40"
              style={{ background: accent, color: fg }}
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ArrowUp className="size-5" aria-hidden />
              )}
            </button>
          </form>
        )}
        <p className="bg-white pb-2 text-center text-[10px] text-neutral-400">
          Powered by Sellora AI
        </p>
      </section>
    </div>
  );
}
