'use client';

import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface ChannelConnection {
  id: string;
  type: 'WEB_CHAT' | 'MESSENGER' | 'INSTAGRAM';
  name: string;
  externalId: string;
  pageId: string | null;
  status: 'CONNECTED' | 'ERROR' | 'DISABLED';
  lastError: string | null;
  lastVerifiedAt: string | null;
  defaultAgentId: string | null;
  settings: Record<string, unknown>;
  hasAccessToken: boolean;
  hasAppSecret: boolean;
  verifyToken: string | null;
  webhookUrl: string | null;
  embedCode: string | null;
  counts: { contacts: number; conversations: number } | null;
  createdAt: string;
}

export interface IntegrationsOverview {
  counts: {
    whatsapp: number;
    webChat: number;
    messenger: number;
    instagram: number;
    webhooks: number;
    apiKeys: number;
  };
  apiBaseUrl: string;
  metaWebhookUrl: string;
  widgetScriptUrl: string;
}

export function useCopy() {
  const [copied, setCopied] = React.useState(false);
  const copy = (value: string) =>
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        toast.success('Copied');
        setTimeout(() => setCopied(false), 1500);
      },
      () => toast.error('Copy failed — select the text and copy it manually'),
    );
  return { copied, copy };
}

/** Read-only code sample with a copy button. */
export function CodeBlock({
  code,
  label,
  className,
}: {
  code: string;
  label?: string;
  className?: string;
}) {
  const { copied, copy } = useCopy();
  return (
    <div className={cn('group relative overflow-hidden rounded-lg border bg-muted/50', className)}>
      {label && (
        <div className="border-b bg-muted/60 px-3 py-1.5 text-xs font-medium text-muted-foreground">
          {label}
        </div>
      )}
      <pre className="scrollbar-thin overflow-x-auto p-3 pr-12 font-mono text-[12px] leading-relaxed whitespace-pre">
        <code>{code}</code>
      </pre>
      <Button
        variant="outline"
        size="icon-sm"
        className={cn('absolute right-2 bg-background', label ? 'top-9' : 'top-2')}
        aria-label={label ? `Copy ${label}` : 'Copy code'}
        onClick={() => copy(code)}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

/** Numbered setup steps. */
export function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-sm">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1 pt-0.5 leading-relaxed">{item}</div>
        </li>
      ))}
    </ol>
  );
}
