'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, CreditCard, FileText, MessagesSquare, Printer, Receipt, RotateCcw, Truck, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { dateTime, money, relative, titleCase } from '@/lib/format';
import { DELIVERY_STATUS, ORDER_SOURCE, ORDER_STATUS, PAYMENT_STATUS } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { Order } from '@/lib/types';
import { useSession } from '@/components/session';
import { DetailRow, ErrorState, PageHeader, PageSkeleton, StatusBadge } from '@/components/shared/page';
import { Badge, Card, CardAction, CardContent, CardHeader, CardTitle, Input, Label, Switch, Textarea } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';
import { Field, FormGrid, MoneyInput } from '@/components/shared/form';
import { ProductThumb } from '@/features/products/product-thumb';
import { ActivityTimeline } from '@/features/activity-timeline';

interface Payment { id: string; amount: string; refundedAmount: string; currency: string; status: string; method: string; providerRef: string | null; paidAt: string | null; createdAt: string; notes: string | null }
interface DeliveryRow { id: string; status: string; carrier: string | null; trackingNumber: string | null; trackingUrl: string | null; scheduledAt: string | null; shippedAt: string | null; deliveredAt: string | null }
type Detail = Order & {
  payments: Payment[];
  invoice: { id: string; number: string; status: string; paymentStatus: string } | null;
  deliveries: DeliveryRow[];
  statusHistory: Array<{ id: string; fromStatus: string | null; toStatus: string; note: string | null; actorName: string | null; createdAt: string }>;
  allowedTransitions: string[];
  conversation: { id: string; channel: string; status: string } | null;
  activity: Array<{ id: string; description: string; actorName: string | null; createdAt: string }>;
};

const FLOW = ['PENDING', 'CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED'];

function StatusStepper({ status }: { status: string }) {
  const idx = FLOW.indexOf(status);
  if (idx < 0)
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
        This order is <strong>{ORDER_STATUS[status]?.label.toLowerCase()}</strong>.
      </div>
    );
  return (
    <ol className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-thin" aria-label="Order progress">
      {FLOW.map((s, i) => (
        <li key={s} className="flex shrink-0 items-center gap-1">
          <span
            className={cn(
              'inline-flex h-7 items-center rounded-full px-3 text-xs font-medium',
              i < idx && 'bg-primary/10 text-primary',
              i === idx && 'bg-primary text-primary-foreground',
              i > idx && 'bg-muted text-muted-foreground',
            )}
            aria-current={i === idx ? 'step' : undefined}
          >
            {ORDER_STATUS[s]!.label}
          </span>
          {i < FLOW.length - 1 && <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can, currency: wsCurrency } = useSession();
  const { data: o, isLoading, error, refetch } = useQuery({ queryKey: ['order', id], queryFn: () => api.get<Detail>(`/orders/${id}`) });
  const methods = useQuery({ queryKey: ['payment-methods'], queryFn: () => api.get<Array<{ key: string; label: string }>>('/payments/methods') });
  const [statusDialog, setStatusDialog] = React.useState<string | null>(null);
  const [statusNote, setStatusNote] = React.useState('');
  const [notify, setNotify] = React.useState(true);
  const [restock, setRestock] = React.useState(true);
  const [payOpen, setPayOpen] = React.useState(false);
  const [payment, setPayment] = React.useState<{ amount: number | null; method: string; providerRef: string; notes: string }>({ amount: null, method: 'cash_on_delivery', providerRef: '', notes: '' });
  const [refund, setRefund] = React.useState<{ payment: Payment; amount: number | null; reason: string } | null>(null);
  const [deliveryOpen, setDeliveryOpen] = React.useState(false);
  const [delivery, setDelivery] = React.useState({ carrier: '', trackingNumber: '', trackingUrl: '' });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['order', id] });
    qc.invalidateQueries({ queryKey: ['orders'] });
  };
  const changeStatus = useMutation({
    mutationFn: () => api.post(`/orders/${id}/status`, { status: statusDialog, note: statusNote || undefined, notifyCustomer: notify, restock }),
    onSuccess: () => {
      toast.success('Order updated');
      setStatusDialog(null);
      setStatusNote('');
      invalidate();
    },
  });
  const recordPayment = useMutation({
    mutationFn: () => api.post('/payments', { orderId: id, amount: payment.amount, method: payment.method, providerRef: payment.providerRef || undefined, notes: payment.notes || undefined }),
    onSuccess: () => {
      toast.success('Payment recorded');
      setPayOpen(false);
      invalidate();
    },
  });
  const refundPayment = useMutation({
    mutationFn: () => api.post(`/payments/${refund!.payment.id}/refund`, { amount: refund!.amount, reason: refund!.reason || undefined }),
    onSuccess: () => {
      toast.success('Refund recorded');
      setRefund(null);
      invalidate();
    },
  });
  const createInvoice = useMutation({
    mutationFn: () => api.post<{ id: string }>('/invoices', { orderId: id }),
    onSuccess: () => {
      toast.success('Invoice created');
      invalidate();
    },
  });
  const createDelivery = useMutation({
    mutationFn: () => api.post('/deliveries', { orderId: id, carrier: delivery.carrier || null, trackingNumber: delivery.trackingNumber || null, trackingUrl: delivery.trackingUrl || null }),
    onSuccess: () => {
      toast.success('Delivery created');
      setDeliveryOpen(false);
      invalidate();
    },
  });
  const updateDelivery = useMutation({
    mutationFn: (v: { id: string; status: string }) => api.patch(`/deliveries/${v.id}`, { status: v.status, notifyCustomer: true }),
    onSuccess: () => {
      toast.success('Delivery updated');
      invalidate();
    },
  });

  if (isLoading) return <PageSkeleton />;
  if (error || !o) return <ErrorState error={error} onRetry={() => refetch()} />;
  const currency = o.currency || wsCurrency;
  const outstanding = Math.max(0, Number(o.total) - Number(o.amountPaid));
  const closed = ['CANCELLED', 'REFUNDED'].includes(o.status);
  const canCancel = can('orders.cancel');
  const transitions = o.allowedTransitions.filter((s) => (['CANCELLED', 'REFUNDED'].includes(s) ? canCancel : true));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Orders', href: '/orders' }, { label: o.number }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {o.number}
            <StatusBadge map={ORDER_STATUS} value={o.status} />
            <StatusBadge map={PAYMENT_STATUS} value={o.paymentStatus} />
            {o.source === 'AI' && (
              <Badge variant="ai">
                <Bot /> Placed by AI
              </Badge>
            )}
          </span>
        }
        description={`${dateTime(o.createdAt)} · ${ORDER_SOURCE[o.source] ?? o.source}`}
        actions={
          <>
            {o.conversation && (
              <Button variant="outline" asChild>
                <Link href={`/inbox?conversation=${o.conversation.id}`}>
                  <MessagesSquare /> Conversation
                </Link>
              </Button>
            )}
            {can('orders.update') && transitions.length > 0 && (
              <Select value="" onValueChange={(v) => setStatusDialog(v)}>
                <SelectTrigger className="w-44" aria-label="Change status">
                  <SelectValue placeholder="Update status" />
                </SelectTrigger>
                <SelectContent>
                  {transitions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === 'CANCELLED' ? 'Cancel order' : s === 'REFUNDED' ? 'Refund order' : `Mark ${ORDER_STATUS[s]?.label.toLowerCase()}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </>
        }
      />
      <Card className="mb-4 p-4">
        <StatusStepper status={o.status} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <ul className="divide-y border-y">
                {o.items?.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-5 py-3">
                    <ProductThumb src={i.product?.images[0]} name={i.name} />
                    <div className="min-w-0 flex-1">
                      {i.productId ? (
                        <Link href={`/products/${i.productId}`} className="truncate text-sm font-medium hover:underline">
                          {i.name}
                        </Link>
                      ) : (
                        <p className="truncate text-sm font-medium">{i.name}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {i.sku} · {money(i.unitPrice, currency)} × {i.quantity}
                        {Number(i.discount) > 0 && ` · −${money(i.discount, currency)}`}
                      </p>
                    </div>
                    <span className="text-sm font-medium tabular">{money(i.total, currency)}</span>
                  </li>
                ))}
              </ul>
              <dl className="space-y-1.5 px-5 py-4 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular">{money(o.subtotal, currency)}</dd></div>
                {Number(o.discountTotal) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Discount</dt><dd className="tabular">−{money(o.discountTotal, currency)}</dd></div>}
                <div className="flex justify-between"><dt className="text-muted-foreground">Tax</dt><dd className="tabular">{money(o.taxTotal, currency)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Shipping</dt><dd className="tabular">{money(o.shippingTotal, currency)}</dd></div>
                <div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular">{money(o.total, currency)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Paid</dt><dd className="tabular">{money(o.amountPaid, currency)}</dd></div>
                {outstanding > 0 && !closed && <div className="flex justify-between font-medium text-warning"><dt>Balance due</dt><dd className="tabular">{money(outstanding, currency)}</dd></div>}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CreditCard className="size-4" /> Payments</CardTitle>
              <CardAction>
                {can('orders.update') && outstanding > 0 && !closed && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setPayment({ amount: outstanding, method: methods.data?.[0]?.key ?? 'cash_on_delivery', providerRef: '', notes: '' });
                      setPayOpen(true);
                    }}
                  >
                    Record payment
                  </Button>
                )}
              </CardAction>
            </CardHeader>
            <CardContent className="pt-3">
              {!o.payments.length ? (
                <p className="text-sm text-muted-foreground">No payments recorded.</p>
              ) : (
                <ul className="divide-y">
                  {o.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{titleCase(p.method)}</p>
                        <p className="text-xs text-muted-foreground">
                          {relative(p.paidAt ?? p.createdAt)}
                          {p.providerRef && ` · ref ${p.providerRef}`}
                          {Number(p.refundedAmount) > 0 && ` · refunded ${money(p.refundedAmount, currency)}`}
                        </p>
                      </div>
                      <StatusBadge map={PAYMENT_STATUS} value={p.status} />
                      <span className="w-24 text-right text-sm font-medium tabular">{money(p.amount, currency)}</span>
                      {canCancel && ['PAID', 'PARTIALLY_REFUNDED'].includes(p.status) && (
                        <Button variant="ghost" size="icon-sm" aria-label="Refund payment" onClick={() => setRefund({ payment: p, amount: Number(p.amount) - Number(p.refundedAmount), reason: '' })}>
                          <RotateCcw />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Truck className="size-4" /> Deliveries</CardTitle>
              <CardAction>
                {can('orders.update') && !closed && (
                  <Button size="sm" variant="outline" onClick={() => setDeliveryOpen(true)}>
                    Add delivery
                  </Button>
                )}
              </CardAction>
            </CardHeader>
            <CardContent className="pt-3">
              {!o.deliveries.length ? (
                <p className="text-sm text-muted-foreground">No delivery created yet.</p>
              ) : (
                <ul className="divide-y">
                  {o.deliveries.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{d.carrier ?? 'Delivery'}</p>
                        <p className="text-xs text-muted-foreground">
                          {d.trackingUrl ? <a className="text-primary hover:underline" href={d.trackingUrl} target="_blank" rel="noreferrer">{d.trackingNumber ?? 'Track'}</a> : (d.trackingNumber ?? 'No tracking number')}
                        </p>
                      </div>
                      {can('orders.update') ? (
                        <Select value={d.status} onValueChange={(v) => updateDelivery.mutate({ id: d.id, status: v })}>
                          <SelectTrigger size="sm" className="w-36" aria-label="Delivery status">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(DELIVERY_STATUS).map(([k, v]) => (
                              <SelectItem key={k} value={k}>
                                {v.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <StatusBadge map={DELIVERY_STATUS} value={d.status} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityTimeline
                items={[
                  ...o.statusHistory.map((h) => ({ id: h.id, description: `${h.fromStatus ? `${ORDER_STATUS[h.fromStatus]?.label} → ` : ''}${ORDER_STATUS[h.toStatus]?.label}${h.note ? ` — ${h.note}` : ''}`, actorName: h.actorName, createdAt: h.createdAt })),
                  ...o.activity.filter((a) => !a.description.startsWith('Status changed')),
                ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <Link href={`/customers/${o.customer.id}`} className="font-medium text-primary hover:underline">
                {o.customer.name}
              </Link>
              <p className="text-muted-foreground">{o.customer.email ?? '—'}</p>
              <p className="text-muted-foreground">{o.customer.whatsappNumber ?? o.customer.phone ?? '—'}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Shipping address</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <p className="font-medium">{o.shippingName ?? '—'}</p>
              <p className="text-muted-foreground">{o.shippingPhone}</p>
              <p className="text-muted-foreground">{[o.shippingAddress, o.shippingCity, o.shippingCountry].filter(Boolean).join(', ') || 'No address'}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Receipt className="size-4" /> Invoice</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {o.invoice ? (
                <>
                  <dl className="divide-y">
                    <DetailRow label="Number">{o.invoice.number}</DetailRow>
                    <DetailRow label="Payment"><StatusBadge map={PAYMENT_STATUS} value={o.invoice.paymentStatus} /></DetailRow>
                  </dl>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" asChild className="flex-1">
                      <Link href={`/invoices/${o.invoice.id}`}>
                        <FileText /> View
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" asChild className="flex-1">
                      <a href={`/api/v1/invoices/${o.invoice.id}/pdf`} target="_blank" rel="noreferrer">
                        <Printer /> PDF
                      </a>
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-muted-foreground">No invoice yet.</p>
                  {can('orders.create') && o.status !== 'CANCELLED' && (
                    <Button size="sm" variant="outline" className="w-full" onClick={() => createInvoice.mutate()} loading={createInvoice.isPending}>
                      Create invoice
                    </Button>
                  )}
                </>
              )}
            </CardContent>
          </Card>
          {o.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent className="text-sm whitespace-pre-line">{o.notes}</CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={!!statusDialog} onOpenChange={(v) => !v && setStatusDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{statusDialog === 'CANCELLED' ? 'Cancel order' : statusDialog === 'REFUNDED' ? 'Refund order' : `Mark as ${ORDER_STATUS[statusDialog ?? '']?.label.toLowerCase()}`}</DialogTitle>
            <DialogDescription>
              {statusDialog === 'SHIPPED' || statusDialog === 'DELIVERED'
                ? 'Reserved stock will be deducted from inventory.'
                : statusDialog === 'CANCELLED'
                  ? 'Reserved stock is released back to inventory.'
                  : 'The change is recorded in the order history.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label={statusDialog === 'CANCELLED' ? 'Reason' : 'Note'} htmlFor="st-note">
              <Textarea id="st-note" rows={2} value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
            </Field>
            {(statusDialog === 'CANCELLED' || statusDialog === 'REFUNDED') && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <Label htmlFor="st-restock">Return shipped items to stock</Label>
                <Switch id="st-restock" checked={restock} onCheckedChange={setRestock} />
              </div>
            )}
            {o.conversation && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <Label htmlFor="st-notify">Notify customer on WhatsApp</Label>
                <Switch id="st-notify" checked={notify} onCheckedChange={setNotify} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialog(null)}>
              Back
            </Button>
            <Button variant={statusDialog === 'CANCELLED' || statusDialog === 'REFUNDED' ? 'destructive' : 'default'} onClick={() => changeStatus.mutate()} loading={changeStatus.isPending}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>Balance due: {money(outstanding, currency)}</DialogDescription>
          </DialogHeader>
          <FormGrid>
            <Field label="Amount" htmlFor="pay-amount">
              <MoneyInput id="pay-amount" currency={currency} value={payment.amount} onChange={(v) => setPayment({ ...payment, amount: v })} />
            </Field>
            <Field label="Method" htmlFor="pay-method">
              <Select value={payment.method} onValueChange={(v) => setPayment({ ...payment, method: v })}>
                <SelectTrigger id="pay-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {methods.data?.map((m) => (
                    <SelectItem key={m.key} value={m.key}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Reference" htmlFor="pay-ref" className="sm:col-span-2" hint="Transaction ID, receipt number…">
              <Input id="pay-ref" value={payment.providerRef} onChange={(e) => setPayment({ ...payment, providerRef: e.target.value })} />
            </Field>
          </FormGrid>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => recordPayment.mutate()} loading={recordPayment.isPending} disabled={!payment.amount}>
              Record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!refund} onOpenChange={(v) => !v && setRefund(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refund payment</DialogTitle>
            <DialogDescription>Records a refund. Return the money through the original payment method.</DialogDescription>
          </DialogHeader>
          {refund && (
            <div className="space-y-4">
              <Field label="Amount" htmlFor="ref-amount">
                <MoneyInput id="ref-amount" currency={currency} value={refund.amount} onChange={(v) => setRefund({ ...refund, amount: v })} />
              </Field>
              <Field label="Reason" htmlFor="ref-reason">
                <Input id="ref-reason" value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} />
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefund(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => refundPayment.mutate()} loading={refundPayment.isPending} disabled={!refund?.amount}>
              Record refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deliveryOpen} onOpenChange={setDeliveryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add delivery</DialogTitle>
            <DialogDescription>Uses the order&apos;s shipping address.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Carrier" htmlFor="dl-carrier">
              <Input id="dl-carrier" value={delivery.carrier} onChange={(e) => setDelivery({ ...delivery, carrier: e.target.value })} />
            </Field>
            <Field label="Tracking number" htmlFor="dl-track">
              <Input id="dl-track" value={delivery.trackingNumber} onChange={(e) => setDelivery({ ...delivery, trackingNumber: e.target.value })} />
            </Field>
            <Field label="Tracking URL" htmlFor="dl-url">
              <Input id="dl-url" type="url" value={delivery.trackingUrl} onChange={(e) => setDelivery({ ...delivery, trackingUrl: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliveryOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => createDelivery.mutate()} loading={createDelivery.isPending}>
              Create delivery
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
