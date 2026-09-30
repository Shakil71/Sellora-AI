'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Download, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { date, money } from '@/lib/format';
import { PAYMENT_STATUS } from '@/lib/status';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { ErrorState, PageHeader, PageSkeleton, StatusBadge } from '@/components/shared/page';
import { Badge, Card } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { LogoMark } from '@/components/brand/logo';

interface InvoiceDetail {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  currency: string;
  issueDate: string;
  dueDate: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  shippingTotal: string;
  total: string;
  amountPaid: string;
  notes: string | null;
  customer: { id: string; name: string; email: string | null; phone: string | null; whatsappNumber: string | null; company: string | null; addressLine: string | null; city: string | null; country: string | null; postalCode: string | null };
  items: Array<{ id: string; description: string; sku: string | null; quantity: number; unitPrice: string; discount: string; total: string }>;
  order: { id: string; number: string } | null;
  business: { name: string; logoUrl: string | null; email: string | null; phone: string | null; address: string | null; website: string | null };
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const { data: inv, isLoading, error, refetch } = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get<InvoiceDetail>(`/invoices/${id}`) });
  const voidInvoice = useMutation({
    mutationFn: () => api.post(`/invoices/${id}/void`),
    onSuccess: () => {
      toast.success('Invoice voided');
      qc.invalidateQueries({ queryKey: ['invoice', id] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
  if (isLoading) return <PageSkeleton />;
  if (error || !inv) return <ErrorState error={error} onRetry={() => refetch()} />;
  const m = (v: string | number) => money(v, inv.currency);
  const balance = Number(inv.total) - Number(inv.amountPaid);

  return (
    <>
      <div className="no-print">
        <PageHeader
          breadcrumbs={[{ label: 'Invoices', href: '/invoices' }, { label: inv.number }]}
          title={inv.number}
          actions={
            <>
              <Button variant="outline" onClick={() => window.print()}>
                <Printer /> Print
              </Button>
              <Button variant="outline" asChild>
                <a href={`/api/v1/invoices/${id}/pdf`} target="_blank" rel="noreferrer">
                  <Download /> PDF
                </a>
              </Button>
              {can('orders.cancel') && inv.status !== 'VOID' && inv.paymentStatus !== 'PAID' && (
                <Button variant="ghost" onClick={async () => (await confirm({ title: 'Void this invoice?', description: 'A voided invoice stays in your records but is no longer payable.', destructive: true, confirmLabel: 'Void invoice' })) && voidInvoice.mutate()}>
                  <Ban /> Void
                </Button>
              )}
            </>
          }
        />
      </div>
      <Card className="mx-auto max-w-3xl p-6 shadow-sm sm:p-10 print:border-0 print:shadow-none">
        <div className="flex flex-col gap-6 sm:flex-row sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              {inv.business.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={inv.business.logoUrl} alt="" className="size-10 rounded object-cover" />
              ) : (
                <LogoMark size={32} />
              )}
              <p className="text-lg font-semibold">{inv.business.name}</p>
            </div>
            <div className="mt-2 space-y-0.5 text-sm text-muted-foreground">
              {inv.business.address && <p>{inv.business.address}</p>}
              {inv.business.email && <p>{inv.business.email}</p>}
              {inv.business.phone && <p>{inv.business.phone}</p>}
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-2xl font-semibold tracking-tight">INVOICE</p>
            <p className="mt-1 text-sm">{inv.number}</p>
            <div className="mt-2 space-y-0.5 text-sm text-muted-foreground">
              <p>Issued {date(inv.issueDate)}</p>
              {inv.dueDate && <p>Due {date(inv.dueDate)}</p>}
              {inv.order && (
                <p>
                  Order <Link href={`/orders/${inv.order.id}`} className="text-primary hover:underline">{inv.order.number}</Link>
                </p>
              )}
            </div>
            <div className="mt-2 flex gap-2 sm:justify-end">
              {inv.status === 'VOID' ? <Badge variant="muted">Void</Badge> : <StatusBadge map={PAYMENT_STATUS} value={inv.paymentStatus} />}
            </div>
          </div>
        </div>
        <div className="mt-8">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Bill to</p>
          <p className="mt-1 font-medium">{inv.customer.name}</p>
          <div className="text-sm text-muted-foreground">
            {inv.customer.company && <p>{inv.customer.company}</p>}
            {inv.customer.addressLine && <p>{inv.customer.addressLine}</p>}
            <p>{[inv.customer.city, inv.customer.postalCode, inv.customer.country].filter(Boolean).join(', ')}</p>
            <p>{inv.customer.email ?? inv.customer.whatsappNumber ?? inv.customer.phone}</p>
          </div>
        </div>
        <div className="mt-8 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 font-medium">Description</th>
                <th className="py-2 text-right font-medium">Qty</th>
                <th className="py-2 text-right font-medium">Unit price</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {inv.items.map((i) => (
                <tr key={i.id}>
                  <td className="py-2.5">
                    {i.description}
                    {i.sku && <span className="block text-xs text-muted-foreground">{i.sku}</span>}
                  </td>
                  <td className="py-2.5 text-right tabular">{i.quantity}</td>
                  <td className="py-2.5 text-right tabular">{m(i.unitPrice)}</td>
                  <td className="py-2.5 text-right tabular">{m(i.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="mt-6 ml-auto w-full max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular">{m(inv.subtotal)}</dd></div>
          {Number(inv.discountTotal) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Discount</dt><dd className="tabular">−{m(inv.discountTotal)}</dd></div>}
          <div className="flex justify-between"><dt className="text-muted-foreground">Tax</dt><dd className="tabular">{m(inv.taxTotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Shipping</dt><dd className="tabular">{m(inv.shippingTotal)}</dd></div>
          <div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular">{m(inv.total)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Paid</dt><dd className="tabular">{m(inv.amountPaid)}</dd></div>
          {balance > 0.005 && <div className="flex justify-between font-semibold"><dt>Balance due</dt><dd className="tabular">{m(balance)}</dd></div>}
        </dl>
        {inv.notes && <p className="mt-8 border-t pt-4 text-sm whitespace-pre-line text-muted-foreground">{inv.notes}</p>}
        <p className="mt-10 text-center text-xs text-muted-foreground">Thank you for your business.</p>
      </Card>
    </>
  );
}
