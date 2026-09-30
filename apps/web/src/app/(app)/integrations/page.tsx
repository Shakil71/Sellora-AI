'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Camera,
  Code2,
  Globe,
  Inbox,
  MessageCircle,
  MessageSquareMore,
  Send,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/page';
import { useSession } from '@/components/session';
import { Badge, Card, CardContent, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import type { IntegrationsOverview } from '@/features/integrations/common';

interface Tile {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  tint: string;
  count: (c: IntegrationsOverview['counts']) => number;
  unit: string;
  kind: 'Channel' | 'Developer';
}

const TILES: Tile[] = [
  {
    title: 'WhatsApp',
    description:
      'The official WhatsApp Cloud API: sell and support where your customers already are.',
    href: '/whatsapp/accounts',
    icon: MessageCircle,
    tint: 'bg-[#25d366]/12 text-[#128c4a] dark:text-[#4ade80]',
    count: (c) => c.whatsapp,
    unit: 'number',
    kind: 'Channel',
  },
  {
    title: 'Website chat',
    description:
      'A chat bubble for any website — WordPress, Shopify, Wix or custom — answered by your AI agent.',
    href: '/integrations/website-chat',
    icon: Globe,
    tint: 'bg-primary/10 text-primary',
    count: (c) => c.webChat,
    unit: 'website',
    kind: 'Channel',
  },
  {
    title: 'Facebook Messenger',
    description: 'Reply to messages sent to your Facebook Page from the same inbox.',
    href: '/integrations/messenger',
    icon: MessageSquareMore,
    tint: 'bg-[#0866ff]/10 text-[#0866ff] dark:text-[#6ea8ff]',
    count: (c) => c.messenger,
    unit: 'page',
    kind: 'Channel',
  },
  {
    title: 'Instagram',
    description: 'Turn Instagram Direct messages into conversations, leads and orders.',
    href: '/integrations/instagram',
    icon: Camera,
    tint: 'bg-[#e1306c]/10 text-[#c2185b] dark:text-[#f472b6]',
    count: (c) => c.instagram,
    unit: 'account',
    kind: 'Channel',
  },
  {
    title: 'Webhooks',
    description:
      'Push orders, leads and messages to your website, ERP or accounting software in real time.',
    href: '/integrations/webhooks',
    icon: Send,
    tint: 'bg-ai-soft text-ai',
    count: (c) => c.webhooks,
    unit: 'endpoint',
    kind: 'Developer',
  },
  {
    title: 'Developer API',
    description:
      'Sync products and stock, create customers and orders, and read everything with API keys.',
    href: '/integrations/api',
    icon: Code2,
    tint: 'bg-muted text-foreground',
    count: (c) => c.apiKeys,
    unit: 'API key',
    kind: 'Developer',
  },
];

export default function IntegrationsPage() {
  const { can } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: ['integrations', 'overview'],
    queryFn: () => api.get<IntegrationsOverview>('/integrations/overview'),
  });
  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connect every place your customers talk to you, and every system your business runs on."
      />

      <Card className="mb-6 overflow-hidden">
        <CardContent className="flex flex-col gap-4 bg-gradient-to-r from-primary/8 via-transparent to-ai-soft/60 p-5 sm:flex-row sm:items-center">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Inbox className="size-5" aria-hidden />
          </span>
          <div className="flex-1">
            <p className="font-semibold">One inbox, one AI agent, every channel</p>
            <p className="text-sm text-muted-foreground">
              Messages from WhatsApp, your website, Messenger and Instagram arrive in the same
              inbox, use the same AI agent, catalog and CRM, and trigger the same automations.
            </p>
          </div>
          {can('conversations.view') && (
            <Button variant="outline" asChild>
              <Link href="/inbox">
                Open inbox <ArrowRight />
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>

      {(['Channel', 'Developer'] as const).map((kind) => (
        <section key={kind} className="mb-8">
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            {kind === 'Channel' ? 'Customer channels' : 'Connect your systems'}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {TILES.filter((t) => t.kind === kind).map((t) => {
              const n = data ? t.count(data.counts) : 0;
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className="group flex flex-col rounded-xl border bg-card p-5 transition hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span
                      className={`flex size-10 items-center justify-center rounded-lg ${t.tint}`}
                    >
                      <t.icon className="size-5" aria-hidden />
                    </span>
                    {isLoading ? (
                      <Skeleton className="h-5 w-20" />
                    ) : n > 0 ? (
                      <Badge variant="success">
                        {n} {t.unit}
                        {n === 1 ? '' : 's'}
                      </Badge>
                    ) : (
                      <Badge variant="muted">Not set up</Badge>
                    )}
                  </div>
                  <p className="mt-4 font-semibold">{t.title}</p>
                  <p className="mt-1 flex-1 text-sm text-muted-foreground">{t.description}</p>
                  <span className="mt-4 flex items-center gap-1 text-sm font-medium text-primary">
                    {n > 0 ? 'Manage' : 'Set up'}{' '}
                    <ArrowRight
                      className="size-4 transition group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
