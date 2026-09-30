'use client';

import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Mail, MapPin, Phone, ShoppingCart, Sparkles, Tag, Target } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { money, relative } from '@/lib/format';
import { LEAD_STATUS, ORDER_STATUS } from '@/lib/status';
import type { Conversation } from '@/lib/types';
import { useSession } from '@/components/session';
import { Avatar, Badge, Separator } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/page';

type Detail = Conversation & {
  customer: Conversation['customer'] & {
    email?: string | null;
    company?: string | null;
    city?: string | null;
    country?: string | null;
    notes?: string | null;
    totalSpent?: string;
    ordersCount?: number;
    createdAt?: string;
  };
  orders?: Array<{ id: string; number: string; status: string; total: string; currency: string; createdAt: string }>;
  leads?: Array<{ id: string; name: string; status: string; score: number }>;
};

export function CustomerPanel({ conversation }: { conversation: Detail }) {
  const { can, currency } = useSession();
  const qc = useQueryClient();
  const c = conversation.customer;
  const createLead = useMutation({
    mutationFn: () => api.post('/leads', { name: c.name, email: c.email ?? null, phone: c.whatsappNumber ?? c.phone ?? null, customerId: c.id, source: 'inbox' }),
    onSuccess: () => {
      toast.success('Lead created');
      qc.invalidateQueries({ queryKey: ['conversation', conversation.id] });
    },
  });
  return (
    <div className="space-y-5 p-5">
      <div className="flex flex-col items-center text-center">
        <Avatar name={c.name} src={c.avatarUrl} size={56} />
        <p className="mt-2 font-semibold">{c.name}</p>
        {c.company && <p className="text-xs text-muted-foreground">{c.company}</p>}
        <Button variant="link" size="sm" asChild className="h-auto p-0 text-xs">
          <Link href={`/customers/${c.id}`}>
            View profile <ExternalLink className="size-3" />
          </Link>
        </Button>
      </div>
      <dl className="space-y-2 text-sm">
        {c.whatsappNumber && (
          <div className="flex items-center gap-2">
            <Phone className="size-4 text-muted-foreground" />
            <dd className="truncate">{c.whatsappNumber}</dd>
          </div>
        )}
        {c.email && (
          <div className="flex items-center gap-2">
            <Mail className="size-4 text-muted-foreground" />
            <dd className="truncate">{c.email}</dd>
          </div>
        )}
        {(c.city || c.country) && (
          <div className="flex items-center gap-2">
            <MapPin className="size-4 text-muted-foreground" />
            <dd className="truncate">{[c.city, c.country].filter(Boolean).join(', ')}</dd>
          </div>
        )}
      </dl>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Total spent</p>
          <p className="font-semibold tabular">{money(c.totalSpent ?? 0, currency)}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Orders</p>
          <p className="font-semibold tabular">{c.ordersCount ?? 0}</p>
        </div>
      </div>
      {c.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag className="size-3.5 text-muted-foreground" />
          {c.tags.map((t) => (
            <Badge key={t} variant="secondary">
              {t}
            </Badge>
          ))}
        </div>
      )}

      {conversation.summary && (
        <>
          <Separator />
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ai">
              <Sparkles className="size-3.5" /> AI summary
            </p>
            <p className="text-sm whitespace-pre-line text-muted-foreground">{conversation.summary}</p>
          </div>
        </>
      )}

      <Separator />
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Orders</p>
          {can('orders.create') && (
            <Button variant="ghost" size="sm" asChild className="h-7">
              <Link href={`/orders/new?customerId=${c.id}&conversationId=${conversation.id}`}>
                <ShoppingCart /> New
              </Link>
            </Button>
          )}
        </div>
        {!conversation.orders?.length ? (
          <p className="text-sm text-muted-foreground">No orders yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {conversation.orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
                  <div>
                    <p className="font-medium">{o.number}</p>
                    <p className="text-xs text-muted-foreground">{relative(o.createdAt)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs font-medium tabular">{money(o.total, o.currency)}</span>
                    <StatusBadge map={ORDER_STATUS} value={o.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Separator />
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Leads</p>
          {can('crm.leads.create') && !conversation.leads?.some((l) => !['WON', 'LOST'].includes(l.status)) && (
            <Button variant="ghost" size="sm" className="h-7" onClick={() => createLead.mutate()} loading={createLead.isPending}>
              <Target /> Create
            </Button>
          )}
        </div>
        {!conversation.leads?.length ? (
          <p className="text-sm text-muted-foreground">No leads for this customer.</p>
        ) : (
          <ul className="space-y-1.5">
            {conversation.leads.map((l) => (
              <li key={l.id}>
                <Link href={`/leads/${l.id}`} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
                  <span className="truncate">{l.name}</span>
                  <StatusBadge map={LEAD_STATUS} value={l.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {c.notes && (
        <>
          <Separator />
          <div>
            <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Notes</p>
            <p className="text-sm whitespace-pre-line">{c.notes}</p>
          </div>
        </>
      )}
    </div>
  );
}
