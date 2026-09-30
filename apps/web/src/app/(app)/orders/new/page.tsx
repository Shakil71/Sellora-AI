'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Minus, Plus, ShoppingCart, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import type { Customer, Product } from '@/lib/types';
import { useSession } from '@/components/session';
import { EmptyState, PageHeader } from '@/components/shared/page';
import { Card, CardContent, CardHeader, CardTitle, Input, Label, Switch, Textarea } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Field, FormGrid, MoneyInput } from '@/components/shared/form';
import { CustomerPicker, ProductPicker } from '@/components/shared/pickers';
import { CustomerFormDialog } from '@/features/customers/customer-form';
import { ProductThumb } from '@/features/products/product-thumb';

interface Line {
  product: Product;
  quantity: number;
  discount: number;
}
interface Quote {
  totals: { subtotal: number; discountTotal: number; taxTotal: number; shippingTotal: number; total: number; lines: Array<{ total: number }> };
  deliveryZone: { name: string; etaDays: number } | null;
}

function NewOrder() {
  const router = useRouter();
  const params = useSearchParams();
  const { currency } = useSession();
  const [customerId, setCustomerId] = React.useState<string | null>(params.get('customerId'));
  const [customerLabel, setCustomerLabel] = React.useState<string | null>(null);
  const [newCustomer, setNewCustomer] = React.useState(false);
  const [lines, setLines] = React.useState<Line[]>([]);
  const [discount, setDiscount] = React.useState<number | null>(null);
  const [shipping, setShipping] = React.useState<number | null>(null);
  const [notes, setNotes] = React.useState('');
  const [confirm, setConfirm] = React.useState(false);
  const [ship, setShip] = React.useState({ shippingName: '', shippingPhone: '', shippingAddress: '', shippingCity: '', shippingCountry: '' });
  const conversationId = params.get('conversationId');

  const customer = useQuery({ queryKey: ['customer-lite', customerId], queryFn: () => api.get<Customer>(`/customers/${customerId}`), enabled: Boolean(customerId) });
  React.useEffect(() => {
    const c = customer.data;
    if (!c) return;
    setCustomerLabel(c.name);
    setShip({ shippingName: c.name, shippingPhone: c.whatsappNumber ?? c.phone ?? '', shippingAddress: c.addressLine ?? '', shippingCity: c.city ?? '', shippingCountry: c.country ?? '' });
  }, [customer.data]);

  const items = lines.map((l) => ({ productId: l.product.id, quantity: l.quantity, discount: l.discount || undefined }));
  const quote = useQuery({
    queryKey: ['quote', items, discount, shipping, ship.shippingCity, ship.shippingCountry],
    queryFn: () => api.post<Quote>('/orders/quote', { items, discount: discount ?? undefined, shipping: shipping ?? undefined, city: ship.shippingCity || null, country: ship.shippingCountry || null }),
    enabled: items.length > 0,
    placeholderData: (p) => p,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string; number: string }>('/orders', {
        customerId,
        items,
        discount: discount ?? undefined,
        shipping: shipping ?? undefined,
        notes: notes || null,
        confirm,
        conversationId,
        ...Object.fromEntries(Object.entries(ship).map(([k, v]) => [k, v || null])),
      }),
    onSuccess: (o) => {
      toast.success(`Order ${o.number} created`);
      router.push(`/orders/${o.id}`);
    },
  });

  const addProduct = (p?: Product) => {
    if (!p) return;
    setLines((ls) => (ls.some((l) => l.product.id === p.id) ? ls.map((l) => (l.product.id === p.id ? { ...l, quantity: l.quantity + 1 } : l)) : [...ls, { product: p, quantity: 1, discount: 0 }]));
  };
  const t = quote.data?.totals;

  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Orders', href: '/orders' }, { label: 'New order' }]} title="New order" description="Prices, tax and shipping are calculated by the server using your workspace settings." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 sm:flex-row">
              <div className="flex-1">
                <CustomerPicker value={customerId} selectedLabel={customerLabel} onChange={(id, o) => { setCustomerId(id); setCustomerLabel(o?.label ?? null); }} />
              </div>
              <Button variant="outline" onClick={() => setNewCustomer(true)}>
                <UserPlus /> New customer
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ProductPicker value={null} currency={currency} onChange={(_id, o) => addProduct((o as { product?: Product } | undefined)?.product)} />
              {!lines.length ? (
                <EmptyState compact icon={ShoppingCart} title="No items yet" description="Search for a product above to add it to the order." />
              ) : (
                <ul className="divide-y rounded-lg border">
                  {lines.map((l, i) => (
                    <li key={l.product.id} className="flex flex-wrap items-center gap-3 p-3">
                      <ProductThumb src={l.product.images[0]} name={l.product.name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{l.product.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {money(l.product.effectivePrice, currency)} each{l.product.trackInventory ? ` · ${Math.max(0, l.product.available ?? 0)} available` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="icon-sm" aria-label="Decrease quantity" onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x)))}>
                          <Minus />
                        </Button>
                        <Input
                          className="h-8 w-14 text-center tabular"
                          type="number"
                          min={1}
                          value={l.quantity}
                          aria-label="Quantity"
                          onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) } : x)))}
                        />
                        <Button variant="outline" size="icon-sm" aria-label="Increase quantity" onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: x.quantity + 1 } : x)))}>
                          <Plus />
                        </Button>
                      </div>
                      <span className="w-24 text-right text-sm font-medium tabular">{t?.lines[i] ? money(t.lines[i]!.total, currency) : '—'}</span>
                      <Button variant="ghost" size="icon-sm" aria-label="Remove item" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Delivery</CardTitle>
            </CardHeader>
            <CardContent>
              <FormGrid>
                <Field label="Recipient" htmlFor="s-name">
                  <Input id="s-name" value={ship.shippingName} onChange={(e) => setShip({ ...ship, shippingName: e.target.value })} />
                </Field>
                <Field label="Phone" htmlFor="s-phone">
                  <Input id="s-phone" value={ship.shippingPhone} onChange={(e) => setShip({ ...ship, shippingPhone: e.target.value })} />
                </Field>
                <Field label="Address" htmlFor="s-address" className="sm:col-span-2">
                  <Input id="s-address" value={ship.shippingAddress} onChange={(e) => setShip({ ...ship, shippingAddress: e.target.value })} />
                </Field>
                <Field label="City" htmlFor="s-city" hint={quote.data?.deliveryZone ? `Zone: ${quote.data.deliveryZone.name} · ~${quote.data.deliveryZone.etaDays} day(s)` : undefined}>
                  <Input id="s-city" value={ship.shippingCity} onChange={(e) => setShip({ ...ship, shippingCity: e.target.value })} />
                </Field>
                <Field label="Country" htmlFor="s-country">
                  <Input id="s-country" value={ship.shippingCountry} onChange={(e) => setShip({ ...ship, shippingCountry: e.target.value })} />
                </Field>
              </FormGrid>
              <Field label="Order notes" htmlFor="o-notes" className="mt-4">
                <Textarea id="o-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormGrid className="grid-cols-2 sm:grid-cols-2">
                <Field label="Order discount" htmlFor="o-discount">
                  <MoneyInput id="o-discount" currency={currency} value={discount} onChange={setDiscount} />
                </Field>
                <Field label="Shipping" htmlFor="o-shipping" hint="Empty = automatic">
                  <MoneyInput id="o-shipping" currency={currency} value={shipping} onChange={setShipping} />
                </Field>
              </FormGrid>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular">{money(t?.subtotal ?? 0, currency)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Discount</dt><dd className="tabular">−{money(t?.discountTotal ?? 0, currency)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Tax</dt><dd className="tabular">{money(t?.taxTotal ?? 0, currency)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Shipping</dt><dd className="tabular">{money(t?.shippingTotal ?? 0, currency)}</dd></div>
                <div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular">{money(t?.total ?? 0, currency)}</dd></div>
              </dl>
              {quote.isError && <p className="text-sm text-destructive">{errorMessage(quote.error)}</p>}
              <div className="flex items-center justify-between rounded-lg border p-3">
                <Label htmlFor="o-confirm">Mark as confirmed</Label>
                <Switch id="o-confirm" checked={confirm} onCheckedChange={setConfirm} />
              </div>
              <Button className="w-full" size="lg" disabled={!customerId || !lines.length || quote.isError} loading={create.isPending} onClick={() => create.mutate()}>
                Create order
              </Button>
              {!customerId && <p className="text-center text-xs text-muted-foreground">Select a customer to continue.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
      <CustomerFormDialog
        open={newCustomer}
        onOpenChange={setNewCustomer}
        onSaved={(c) => {
          setCustomerId(c.id);
          setCustomerLabel(c.name);
        }}
      />
    </>
  );
}

export default function NewOrderPage() {
  return (
    <React.Suspense>
      <NewOrder />
    </React.Suspense>
  );
}
