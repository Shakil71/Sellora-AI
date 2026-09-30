'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useSession } from '@/components/session';
import { PageHeader, PageSkeleton, Section } from '@/components/shared/page';
import { Card, CardContent, Input, Label, Switch, Textarea } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';
import { Field, FormGrid, ImageUpload, MoneyInput, TagInput } from '@/components/shared/form';

interface Workspace {
  id: string;
  name: string;
  businessName: string | null;
  industry: string | null;
  country: string | null;
  currency: string;
  timezone: string;
  locale: string;
  logoUrl: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}
interface Zone {
  name: string;
  cities: string[];
  countries: string[];
  fee: number;
  etaDays: number;
}
interface Commerce {
  taxRatePercent: number;
  defaultShippingFee: number;
  freeShippingThreshold: number | null;
  inventoryMode: 'reserve' | 'deduct';
  allowBackorders: boolean;
  orderPrefix: string;
  invoicePrefix: string;
  invoiceDueDays: number;
  deliveryZones: Zone[];
  paymentMethods: string[];
  aiCanCreateOrders: boolean;
  sendOrderConfirmation: boolean;
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'BDT', 'AED', 'SAR', 'PKR', 'NGN', 'KES', 'ZAR', 'BRL', 'MXN', 'IDR', 'MYR', 'PHP', 'SGD', 'AUD', 'CAD', 'TRY', 'EGP'];

export default function WorkspaceSettingsPage() {
  const qc = useQueryClient();
  const { can, refresh } = useSession();
  const editable = can('settings.update');
  const ws = useQuery({ queryKey: ['workspace'], queryFn: () => api.get<Workspace>('/workspace') });
  const commerce = useQuery({ queryKey: ['commerce-settings'], queryFn: () => api.get<Commerce>('/workspace/commerce') });
  const [w, setW] = React.useState<Workspace | null>(null);
  const [c, setC] = React.useState<Commerce | null>(null);
  React.useEffect(() => ws.data && setW(ws.data), [ws.data]);
  React.useEffect(() => commerce.data && setC(commerce.data), [commerce.data]);
  const timezones = React.useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
    } catch {
      return ['UTC'];
    }
  }, []);

  const saveWs = useMutation({
    mutationFn: () => {
      const { id: _id, ...rest } = w!;
      return api.patch('/workspace', { ...rest, website: rest.website || null, email: rest.email || null });
    },
    onSuccess: () => {
      toast.success('Workspace saved');
      qc.invalidateQueries({ queryKey: ['workspace'] });
      refresh();
    },
  });
  const saveCommerce = useMutation({
    mutationFn: () => api.put('/workspace/commerce', { ...c, orderPrefix: c!.orderPrefix.toUpperCase(), invoicePrefix: c!.invoicePrefix.toUpperCase() }),
    onSuccess: () => {
      toast.success('Commerce settings saved');
      qc.invalidateQueries({ queryKey: ['commerce-settings'] });
    },
  });

  if (!w || !c) return <PageSkeleton />;
  const setZone = (i: number, patch: Partial<Zone>) => setC({ ...c, deliveryZones: c.deliveryZones.map((z, j) => (j === i ? { ...z, ...patch } : z)) });

  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Settings' }, { label: 'Workspace' }]} title="Workspace" description="Business profile, localisation and the rules used for pricing, stock and orders." />
      <Card>
        <CardContent>
          <Section title="Business profile" description="Shown on invoices and used by the AI agent.">
            <div className="space-y-4">
              <FormGrid>
                <Field label="Workspace name" htmlFor="w-name">
                  <Input id="w-name" disabled={!editable} value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} />
                </Field>
                <Field label="Legal / display business name" htmlFor="w-bname">
                  <Input id="w-bname" disabled={!editable} value={w.businessName ?? ''} onChange={(e) => setW({ ...w, businessName: e.target.value })} />
                </Field>
                <Field label="Industry" htmlFor="w-industry">
                  <Input id="w-industry" disabled={!editable} value={w.industry ?? ''} onChange={(e) => setW({ ...w, industry: e.target.value })} />
                </Field>
                <Field label="Website" htmlFor="w-web">
                  <Input id="w-web" type="url" disabled={!editable} value={w.website ?? ''} onChange={(e) => setW({ ...w, website: e.target.value })} placeholder="https://" />
                </Field>
                <Field label="Contact email" htmlFor="w-email">
                  <Input id="w-email" type="email" disabled={!editable} value={w.email ?? ''} onChange={(e) => setW({ ...w, email: e.target.value })} />
                </Field>
                <Field label="Phone" htmlFor="w-phone">
                  <Input id="w-phone" disabled={!editable} value={w.phone ?? ''} onChange={(e) => setW({ ...w, phone: e.target.value })} />
                </Field>
              </FormGrid>
              <Field label="Address" htmlFor="w-address">
                <Textarea id="w-address" rows={2} disabled={!editable} value={w.address ?? ''} onChange={(e) => setW({ ...w, address: e.target.value })} />
              </Field>
              <Field label="Logo">
                <ImageUpload value={w.logoUrl ? [w.logoUrl] : []} onChange={(urls) => setW({ ...w, logoUrl: urls[0] ?? null })} max={1} purpose="branding" />
              </Field>
            </div>
          </Section>
          <Section title="Localisation">
            <FormGrid className="sm:grid-cols-3">
              <Field label="Currency" htmlFor="w-currency">
                <Select value={w.currency} onValueChange={(v) => setW({ ...w, currency: v })} disabled={!editable}>
                  <SelectTrigger id="w-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[...new Set([w.currency, ...CURRENCIES])].map((cur) => (
                      <SelectItem key={cur} value={cur}>
                        {cur}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Timezone" htmlFor="w-tz">
                <Select value={w.timezone} onValueChange={(v) => setW({ ...w, timezone: v })} disabled={!editable}>
                  <SelectTrigger id="w-tz">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {timezones.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Country" htmlFor="w-country">
                <Input id="w-country" disabled={!editable} value={w.country ?? ''} onChange={(e) => setW({ ...w, country: e.target.value })} />
              </Field>
            </FormGrid>
          </Section>
          {editable && (
            <div className="flex justify-end pt-2">
              <Button onClick={() => saveWs.mutate()} loading={saveWs.isPending}>
                Save workspace
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardContent>
          <Section title="Tax & shipping" description="Applied automatically to orders created by your team, the AI agent and automations.">
            <FormGrid className="sm:grid-cols-3">
              <Field label="Tax rate (%)" htmlFor="c-tax">
                <Input id="c-tax" type="number" step="0.01" min={0} max={100} disabled={!editable} value={c.taxRatePercent} onChange={(e) => setC({ ...c, taxRatePercent: Number(e.target.value) })} />
              </Field>
              <Field label="Default shipping fee" htmlFor="c-ship">
                <MoneyInput id="c-ship" currency={w.currency} disabled={!editable} value={c.defaultShippingFee} onChange={(v) => setC({ ...c, defaultShippingFee: v ?? 0 })} />
              </Field>
              <Field label="Free shipping over" htmlFor="c-free" hint="Empty disables free shipping">
                <MoneyInput id="c-free" currency={w.currency} disabled={!editable} value={c.freeShippingThreshold} onChange={(v) => setC({ ...c, freeShippingThreshold: v })} />
              </Field>
            </FormGrid>
          </Section>
          <Section title="Delivery zones" description="Where you deliver, with fees and estimated days. The AI agent uses these to answer delivery questions.">
            <div className="space-y-3">
              {c.deliveryZones.map((z, i) => (
                <div key={i} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
                  <Field label="Zone name" htmlFor={`z-${i}-name`}>
                    <Input id={`z-${i}-name`} disabled={!editable} value={z.name} onChange={(e) => setZone(i, { name: e.target.value })} />
                  </Field>
                  <FormGrid className="grid-cols-2 gap-3 sm:grid-cols-2">
                    <Field label="Fee" htmlFor={`z-${i}-fee`}>
                      <MoneyInput id={`z-${i}-fee`} currency={w.currency} disabled={!editable} value={z.fee} onChange={(v) => setZone(i, { fee: v ?? 0 })} />
                    </Field>
                    <Field label="Days" htmlFor={`z-${i}-eta`}>
                      <Input id={`z-${i}-eta`} type="number" min={0} disabled={!editable} value={z.etaDays} onChange={(e) => setZone(i, { etaDays: Number(e.target.value) })} />
                    </Field>
                  </FormGrid>
                  <Field label="Cities" htmlFor={`z-${i}-cities`} hint="Empty = whole country list below">
                    <TagInput id={`z-${i}-cities`} value={z.cities} onChange={(v) => setZone(i, { cities: v })} />
                  </Field>
                  <Field label="Countries" htmlFor={`z-${i}-countries`} hint="Empty cities and countries = everywhere else">
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <TagInput id={`z-${i}-countries`} value={z.countries} onChange={(v) => setZone(i, { countries: v })} />
                      </div>
                      {editable && (
                        <Button variant="ghost" size="icon" aria-label="Remove zone" onClick={() => setC({ ...c, deliveryZones: c.deliveryZones.filter((_, j) => j !== i) })}>
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </Field>
                </div>
              ))}
              {editable && (
                <Button variant="outline" size="sm" onClick={() => setC({ ...c, deliveryZones: [...c.deliveryZones, { name: 'New zone', cities: [], countries: [], fee: c.defaultShippingFee, etaDays: 3 }] })}>
                  <Plus /> Add delivery zone
                </Button>
              )}
            </div>
          </Section>
          <Section title="Orders & inventory">
            <div className="space-y-4">
              <FormGrid className="sm:grid-cols-3">
                <Field label="Order number prefix" htmlFor="c-op">
                  <Input id="c-op" disabled={!editable} value={c.orderPrefix} onChange={(e) => setC({ ...c, orderPrefix: e.target.value })} />
                </Field>
                <Field label="Invoice number prefix" htmlFor="c-ip">
                  <Input id="c-ip" disabled={!editable} value={c.invoicePrefix} onChange={(e) => setC({ ...c, invoicePrefix: e.target.value })} />
                </Field>
                <Field label="Invoice due (days)" htmlFor="c-due">
                  <Input id="c-due" type="number" min={0} disabled={!editable} value={c.invoiceDueDays} onChange={(e) => setC({ ...c, invoiceDueDays: Number(e.target.value) })} />
                </Field>
              </FormGrid>
              <Field label="Stock handling" htmlFor="c-inv">
                <Select value={c.inventoryMode} onValueChange={(v) => setC({ ...c, inventoryMode: v as Commerce['inventoryMode'] })} disabled={!editable}>
                  <SelectTrigger id="c-inv">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reserve">Reserve on order, deduct when shipped (recommended)</SelectItem>
                    <SelectItem value="deduct">Deduct immediately when the order is placed</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Payment methods" htmlFor="c-pm" hint="Shown when recording payments">
                <TagInput id="c-pm" value={c.paymentMethods} onChange={(v) => setC({ ...c, paymentMethods: v })} />
              </Field>
              {(
                [
                  ['allowBackorders', 'Allow orders when stock is insufficient (backorders)'],
                  ['aiCanCreateOrders', 'Let AI agents place orders after the customer confirms'],
                  ['sendOrderConfirmation', 'Email order confirmations to customers (requires SMTP)'],
                ] as const
              ).map(([k, label]) => (
                <div key={k} className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <Label htmlFor={`c-${k}`}>{label}</Label>
                  <Switch id={`c-${k}`} disabled={!editable} checked={c[k]} onCheckedChange={(v) => setC({ ...c, [k]: v })} />
                </div>
              ))}
            </div>
          </Section>
          {editable && (
            <div className="flex justify-end pt-2">
              <Button onClick={() => saveCommerce.mutate()} loading={saveCommerce.isPending}>
                Save commerce settings
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
