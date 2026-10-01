'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Check, Bot, DollarSign, MessagesSquare, Package, Percent, ShoppingCart, Target, Users, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { money, number, relative, shortTime } from '@/lib/format';
import { LEAD_STATUS, ORDER_STATUS, CONVERSATION_STATUS, STOCK_STATUS } from '@/lib/status';
import { useSession } from '@/components/session';
import { PageHeader, StatCard, StatusBadge, EmptyState, ErrorState } from '@/components/shared/page';
import { BarSeriesCard, TimeSeriesCard } from '@/components/shared/charts';
import { Badge, Card, CardAction, CardContent, CardHeader, CardTitle, Avatar, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

interface Kpi {
  value: number;
  change?: number;
  share?: number;
}
interface Dashboard {
  kpis: Record<'revenue' | 'orders' | 'averageOrderValue' | 'leads' | 'newCustomers' | 'totalCustomers' | 'conversations' | 'aiConversations' | 'conversionRate' | 'pendingOrders' | 'lowStock', Kpi>;
  charts: { sales: Array<{ date: string; revenue: number; orders: number }>; conversations: Array<{ date: string; ai: number; human: number }> };
  recentOrders: Array<{ id: string; number: string; status: string; paymentStatus: string; total: string; currency: string; createdAt: string; source: string; customer: { id: string; name: string } }>;
  recentConversations: Array<{ id: string; status: string; handler: string; lastMessageAt: string; lastMessagePreview: string | null; unreadCount: number; customer: { id: string; name: string } }>;
  recentLeads: Array<{ id: string; name: string; status: string; source: string | null; score: number; createdAt: string }>;
  lowStock: Array<{ id: string; available: number; status: string; product: { id: string; name: string; sku: string } }>;
}

interface Checklist {
  items: Array<{ key: string; title: string; description: string; href: string; done: boolean }>;
  done: number;
  total: number;
}

/** Steps a new business still has to finish before the AI can sell for it. */
function LaunchChecklist() {
  const { data } = useQuery({ queryKey: ['launch-checklist'], queryFn: () => api.get<Checklist>('/onboarding/launch-checklist'), staleTime: 30_000 });
  if (!data || data.done === data.total) return null;
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Get ready to sell</CardTitle>
        <CardAction>
          <Badge variant="default">
            {data.done} of {data.total} done
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-2 pt-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.items.map((i) => (
          <Link
            key={i.key}
            href={i.href}
            className="flex items-start gap-3 rounded-lg border p-3 transition hover:border-primary/40 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span className={i.done ? 'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground' : 'mt-0.5 size-5 shrink-0 rounded-full border-2'}>
              {i.done && <Check className="size-3" aria-hidden />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={i.done ? 'block text-sm font-medium text-muted-foreground line-through' : 'block text-sm font-medium'}>{i.title}</span>
              <span className="block text-xs text-muted-foreground">{i.description}</span>
            </span>
            {!i.done && <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { me, currency, can } = useSession();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/analytics/dashboard'), refetchInterval: 60_000 });
  const k = data?.kpis;
  const m = (v: number) => money(v, currency, { compact: true });

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${me.user.name.split(' ')[0]}`}
        description="Here's how your WhatsApp sales are performing over the last 30 days."
        actions={
          <>
            {can('conversations.view') && (
              <Button variant="outline" asChild>
                <Link href="/inbox">
                  <MessagesSquare /> Open inbox
                </Link>
              </Button>
            )}
            {can('orders.create') && (
              <Button asChild>
                <Link href="/orders/new">
                  <ShoppingCart /> New order
                </Link>
              </Button>
            )}
          </>
        }
      />
      {can('settings.update') && <LaunchChecklist />}
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="Revenue" icon={DollarSign} loading={isLoading} value={m(k?.revenue.value ?? 0)} change={k?.revenue.change} hint="vs previous 30 days" href="/analytics/sales" />
            <StatCard label="Orders" icon={ShoppingCart} loading={isLoading} value={number(k?.orders.value)} change={k?.orders.change} hint={`${k?.pendingOrders.value ?? 0} pending`} href="/orders" />
            <StatCard label="Leads" icon={Target} loading={isLoading} value={number(k?.leads.value)} change={k?.leads.change} hint="new this period" href="/leads" />
            <StatCard label="Conversion rate" icon={Percent} loading={isLoading} value={`${k?.conversionRate.value ?? 0}%`} hint="conversations with an order" />
            <StatCard label="Conversations" icon={MessagesSquare} loading={isLoading} value={number(k?.conversations.value)} change={k?.conversations.change} href="/conversations" />
            <StatCard label="AI conversations" icon={Bot} tone="ai" loading={isLoading} value={number(k?.aiConversations.value)} hint={`${k?.aiConversations.share ?? 0}% handled by AI`} href="/analytics/ai" />
            <StatCard label="Customers" icon={Users} loading={isLoading} value={number(k?.totalCustomers.value)} change={k?.newCustomers.change} hint={`${k?.newCustomers.value ?? 0} new`} href="/customers" />
            <StatCard label="Avg. order value" icon={Package} loading={isLoading} value={m(k?.averageOrderValue.value ?? 0)} change={k?.averageOrderValue.change} />
          </div>

          <div className="grid gap-4 xl:grid-cols-5">
            <div className="min-w-0 xl:col-span-3">
              <BarSeriesCard
                title="Revenue"
                description="Daily revenue from open and fulfilled orders"
                loading={isLoading}
                data={data?.charts.sales}
                dataKey="revenue"
                label="Revenue"
                valueFormat={(v) => money(v, currency, { compact: true })}
                height={260}
              />
            </div>
            <TimeSeriesCard
              className="xl:col-span-2"
              title="New conversations"
              description="Started with the AI agent vs. human only"
              loading={isLoading}
              data={data?.charts.conversations}
              series={[
                { key: 'ai', label: 'AI', color: 'chart-2' },
                { key: 'human', label: 'Human', color: 'chart-1' },
              ]}
              emptyText="Connect WhatsApp to start receiving conversations."
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <Card className="min-w-0 xl:col-span-2">
              <CardHeader>
                <CardTitle>Recent orders</CardTitle>
                <CardAction>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/orders">View all</Link>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="px-0 pb-2">
                {isLoading ? (
                  <div className="space-y-2 px-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
                ) : !data?.recentOrders.length ? (
                  <EmptyState compact icon={ShoppingCart} title="No orders yet" description="Orders placed manually, by your AI agent or through the API show up here." />
                ) : (
                  <ul className="divide-y">
                    {data.recentOrders.map((o) => (
                      <li key={o.id}>
                        <Link href={`/orders/${o.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/40">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {o.number} <span className="font-normal text-muted-foreground">· {o.customer.name}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {relative(o.createdAt)}
                              {o.source === 'AI' && (
                                <Badge variant="ai" className="ml-2">
                                  AI
                                </Badge>
                              )}
                            </p>
                          </div>
                          <StatusBadge map={ORDER_STATUS} value={o.status} className="hidden sm:inline-flex" />
                          <span className="w-24 text-right text-sm font-medium tabular">{money(o.total, o.currency)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Recent conversations</CardTitle>
                <CardAction>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/inbox">Inbox</Link>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="px-0 pb-2">
                {isLoading ? (
                  <div className="space-y-2 px-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
                ) : !data?.recentConversations.length ? (
                  <EmptyState compact icon={MessagesSquare} title="No conversations yet" description="Connect WhatsApp to start receiving customer messages." />
                ) : (
                  <ul className="divide-y">
                    {data.recentConversations.map((c) => (
                      <li key={c.id}>
                        <Link href={`/inbox?conversation=${c.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/40">
                          <Avatar name={c.customer.name} size={32} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium">{c.customer.name}</p>
                              {c.handler === 'AI' && <Bot className="size-3.5 shrink-0 text-ai" aria-label="Handled by AI" />}
                            </div>
                            <p className="truncate text-xs text-muted-foreground">{c.lastMessagePreview ?? '—'}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-[11px] text-muted-foreground">{shortTime(c.lastMessageAt)}</span>
                            {c.unreadCount > 0 ? (
                              <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{c.unreadCount}</span>
                            ) : (
                              <StatusBadge map={CONVERSATION_STATUS} value={c.status} />
                            )}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0 xl:col-span-2">
              <CardHeader>
                <CardTitle>Recent leads</CardTitle>
                <CardAction>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/leads">View all</Link>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="px-0 pb-2">
                {isLoading ? (
                  <div className="space-y-2 px-5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
                ) : !data?.recentLeads.length ? (
                  <EmptyState compact icon={Target} title="No leads yet" description="Your AI agent creates leads automatically when customers show buying interest." />
                ) : (
                  <ul className="divide-y">
                    {data.recentLeads.map((l) => (
                      <li key={l.id}>
                        <Link href={`/leads/${l.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/40">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{l.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {l.source ?? 'unknown source'} · {relative(l.createdAt)}
                            </p>
                          </div>
                          <span className="hidden text-xs text-muted-foreground sm:inline">Score {l.score}</span>
                          <StatusBadge map={LEAD_STATUS} value={l.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Low stock
                  {!!data?.lowStock.length && <AlertTriangle className="size-4 text-warning" aria-hidden />}
                </CardTitle>
                <CardAction>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/inventory">Inventory</Link>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="px-0 pb-2">
                {isLoading ? (
                  <div className="space-y-2 px-5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
                ) : !data?.lowStock.length ? (
                  <EmptyState compact icon={Package} title="Stock levels look healthy" description="Products at or below their low-stock threshold appear here." />
                ) : (
                  <ul className="divide-y">
                    {data.lowStock.map((i) => (
                      <li key={i.id}>
                        <Link href={`/products/${i.product.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/40">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{i.product.name}</p>
                            <p className="text-xs text-muted-foreground">{i.product.sku}</p>
                          </div>
                          <span className="text-sm font-medium tabular">{Math.max(0, i.available)}</span>
                          <StatusBadge map={STOCK_STATUS} value={i.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3" /> Figures refresh every minute and when new activity happens.
          </p>
        </div>
      )}
    </>
  );
}
