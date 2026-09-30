'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Mail, MapPin, MessagesSquare, Pencil, Phone, ShoppingCart, Trash2, History } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { date, money, relative } from '@/lib/format';
import { CONVERSATION_STATUS, LEAD_STATUS, ORDER_STATUS, TASK_STATUS } from '@/lib/status';
import type { Customer } from '@/lib/types';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { EmptyState, ErrorState, PageHeader, PageSkeleton, StatCard, StatusBadge } from '@/components/shared/page';
import { Avatar, Badge, Card, CardContent, CardHeader, CardTitle, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { CustomerFormDialog } from '@/features/customers/customer-form';
import { ActivityTimeline } from '@/features/activity-timeline';

type Detail = Customer & {
  orders: Array<{ id: string; number: string; status: string; paymentStatus: string; total: string; currency: string; createdAt: string }>;
  conversations: Array<{ id: string; status: string; handler: string; channel: string; lastMessageAt: string; lastMessagePreview: string | null; summary: string | null }>;
  leads: Array<{ id: string; name: string; status: string; score: number; createdAt: string }>;
  deals: Array<{ id: string; name: string; amount: string; status: string; stage: { name: string; color: string | null } }>;
  tasks: Array<{ id: string; title: string; status: string; dueDate: string | null }>;
  activity: Array<{ id: string; type: string; description: string; actorName: string | null; createdAt: string }>;
};

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can, currency } = useSession();
  const [edit, setEdit] = React.useState(false);
  const { data: c, isLoading, error, refetch } = useQuery({ queryKey: ['customer', id], queryFn: () => api.get<Detail>(`/customers/${id}`) });
  const remove = useMutation({
    mutationFn: () => api.delete(`/customers/${id}`),
    onSuccess: () => {
      toast.success('Customer deleted');
      qc.invalidateQueries({ queryKey: ['customers'] });
      router.push('/customers');
    },
  });

  if (isLoading) return <PageSkeleton />;
  if (error || !c) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Customers', href: '/customers' }, { label: c.name }]}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={c.name} src={c.avatarUrl} size={40} />
            <span className="truncate">{c.name}</span>
            {c.isDemo && <Badge variant="warning">Demo</Badge>}
          </span>
        }
        description={c.company ?? `Customer since ${date(c.createdAt)}`}
        actions={
          <>
            {can('orders.create') && (
              <Button variant="outline" asChild>
                <Link href={`/orders/new?customerId=${c.id}`}>
                  <ShoppingCart /> New order
                </Link>
              </Button>
            )}
            {can('contacts.update') && (
              <Button variant="outline" onClick={() => setEdit(true)}>
                <Pencil /> Edit
              </Button>
            )}
            {can('contacts.delete') && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete customer"
                onClick={async () => {
                  if (await confirm({ title: `Delete ${c.name}?`, description: 'Their conversations are deleted too; leads and tasks are kept but unlinked. Customers with orders cannot be deleted.', destructive: true, confirmLabel: 'Delete' }))
                    remove.mutate();
                }}
              >
                <Trash2 />
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="flex items-center gap-2">
                <Phone className="size-4 text-muted-foreground" /> {c.whatsappNumber ?? c.phone ?? '—'}
              </p>
              <p className="flex items-center gap-2 break-all">
                <Mail className="size-4 shrink-0 text-muted-foreground" /> {c.email ?? '—'}
              </p>
              <p className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>{[c.addressLine, c.city, c.postalCode, c.country].filter(Boolean).join(', ') || '—'}</span>
              </p>
              {c.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {c.tags.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
              {c.notes && <p className="rounded-lg bg-muted/60 p-3 whitespace-pre-line">{c.notes}</p>}
              <p className="text-xs text-muted-foreground">
                Source: {c.source ?? 'manual'} · Last active {relative(c.lastInteractionAt)}
              </p>
            </CardContent>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Total spent" value={money(c.totalSpent, currency)} />
            <StatCard label="Orders" value={c.ordersCount} />
          </div>
        </div>
        <Tabs defaultValue="orders" className="min-w-0">
          <TabsList>
            <TabsTrigger value="orders">Orders ({c.orders.length})</TabsTrigger>
            <TabsTrigger value="conversations">Conversations ({c.conversations.length})</TabsTrigger>
            <TabsTrigger value="crm">Leads & deals</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          <TabsContent value="orders">
            <Card>
              {!c.orders.length ? (
                <EmptyState icon={ShoppingCart} title="No orders yet" description="Orders placed by this customer appear here." />
              ) : (
                <ul className="divide-y">
                  {c.orders.map((o) => (
                    <li key={o.id}>
                      <Link href={`/orders/${o.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/40">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{o.number}</p>
                          <p className="text-xs text-muted-foreground">{date(o.createdAt)}</p>
                        </div>
                        <StatusBadge map={ORDER_STATUS} value={o.status} />
                        <span className="w-24 text-right font-medium tabular">{money(o.total, o.currency)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </TabsContent>
          <TabsContent value="conversations">
            <Card>
              {!c.conversations.length ? (
                <EmptyState icon={MessagesSquare} title="No conversations" description="WhatsApp conversations with this customer appear here." />
              ) : (
                <ul className="divide-y">
                  {c.conversations.map((cv) => (
                    <li key={cv.id}>
                      <Link href={`/inbox?conversation=${cv.id}`} className="block px-5 py-3 hover:bg-muted/40">
                        <div className="flex items-center gap-2">
                          {cv.handler === 'AI' && <Bot className="size-4 text-ai" />}
                          <p className="min-w-0 flex-1 truncate text-sm">{cv.lastMessagePreview ?? '—'}</p>
                          <StatusBadge map={CONVERSATION_STATUS} value={cv.status} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{relative(cv.lastMessageAt)}</p>
                        {cv.summary && <p className="mt-2 line-clamp-3 rounded-md bg-ai-soft/60 p-2 text-xs whitespace-pre-line">{cv.summary}</p>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </TabsContent>
          <TabsContent value="crm" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Leads</CardTitle>
              </CardHeader>
              <CardContent className="pt-3">
                {!c.leads.length ? (
                  <p className="text-sm text-muted-foreground">No leads.</p>
                ) : (
                  <ul className="space-y-2">
                    {c.leads.map((l) => (
                      <li key={l.id}>
                        <Link href={`/leads/${l.id}`} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm hover:bg-muted/40">
                          <span>{l.name}</span>
                          <StatusBadge map={LEAD_STATUS} value={l.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Deals</CardTitle>
              </CardHeader>
              <CardContent className="pt-3">
                {!c.deals.length ? (
                  <p className="text-sm text-muted-foreground">No deals.</p>
                ) : (
                  <ul className="space-y-2">
                    {c.deals.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                        <span className="truncate">{d.name}</span>
                        <span className="flex items-center gap-2">
                          <Badge variant="outline">{d.stage.name}</Badge>
                          <span className="font-medium tabular">{money(d.amount, currency)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Tasks</CardTitle>
              </CardHeader>
              <CardContent className="pt-3">
                {!c.tasks.length ? (
                  <p className="text-sm text-muted-foreground">No tasks.</p>
                ) : (
                  <ul className="space-y-2">
                    {c.tasks.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                        <span className="truncate">{t.title}</span>
                        <StatusBadge map={TASK_STATUS} value={t.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="activity">
            <Card>
              <CardContent>{c.activity.length ? <ActivityTimeline items={c.activity} /> : <EmptyState compact icon={History} title="No activity yet" />}</CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      <CustomerFormDialog open={edit} onOpenChange={setEdit} customer={c} onSaved={() => qc.invalidateQueries({ queryKey: ['customer', id] })} />
    </>
  );
}
