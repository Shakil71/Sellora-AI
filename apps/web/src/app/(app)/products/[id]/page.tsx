'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Boxes, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { money, relative, titleCase } from '@/lib/format';
import { PRODUCT_STATUS, STOCK_STATUS } from '@/lib/status';
import type { Product } from '@/lib/types';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { DetailRow, ErrorState, PageHeader, PageSkeleton, StatCard, StatusBadge } from '@/components/shared/page';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { ProductThumb } from '@/features/products/product-thumb';

type Detail = Product & {
  recentMovements: Array<{ id: string; type: string; quantity: number; onHandAfter: number; reason: string | null; reference: string | null; createdAt: string }>;
  sales: { units: number; revenue: number };
};

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can, currency } = useSession();
  const { data: p, isLoading, error, refetch } = useQuery({ queryKey: ['product', id], queryFn: () => api.get<Detail>(`/products/${id}`) });
  const remove = useMutation({
    mutationFn: () => api.delete(`/products/${id}`),
    onSuccess: () => {
      toast.success('Product deleted');
      qc.invalidateQueries({ queryKey: ['products'] });
      router.push('/products');
    },
  });
  if (isLoading) return <PageSkeleton />;
  if (error || !p) return <ErrorState error={error} onRetry={() => refetch()} />;
  const margin = p.cost ? ((p.effectivePrice - Number(p.cost)) / p.effectivePrice) * 100 : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Products', href: '/products' }, { label: p.name }]}
        title={p.name}
        description={`${p.sku}${p.category ? ` · ${p.category.name}` : ''}`}
        actions={
          <>
            {can('products.update') && (
              <Button variant="outline" asChild>
                <Link href={`/products/${id}/edit`}>
                  <Pencil /> Edit
                </Link>
              </Button>
            )}
            {can('inventory.view') && (
              <Button variant="outline" asChild>
                <Link href={`/inventory?search=${encodeURIComponent(p.sku)}`}>
                  <Boxes /> Stock
                </Link>
              </Button>
            )}
            {can('products.delete') && (
              <Button variant="ghost" size="icon" aria-label="Delete product" onClick={async () => (await confirm({ title: `Delete ${p.name}?`, description: 'Past orders keep their line items. Products in open orders cannot be deleted — archive them instead.', destructive: true, confirmLabel: 'Delete' })) && remove.mutate()}>
                <Trash2 />
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Price" value={money(p.effectivePrice, currency)} hint={p.salePrice ? `Regular ${money(p.price, currency)}` : undefined} />
        <StatCard label="Available" value={p.trackInventory ? Math.max(0, p.available ?? 0) : '∞'} hint={p.inventory ? `${p.inventory.reserved} reserved` : 'Not tracked'} />
        <StatCard label="Units sold" value={p.sales.units} />
        <StatCard label="Revenue" value={money(p.sales.revenue, currency)} hint={margin !== null ? `${margin.toFixed(0)}% margin` : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardContent className="space-y-4">
              {p.images.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {p.images.map((src) => (
                    <ProductThumb key={src} src={src} name={p.name} size={96} />
                  ))}
                </div>
              )}
              <p className="text-sm whitespace-pre-line">{p.description || <span className="text-muted-foreground">No description.</span>}</p>
              {p.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {p.tags.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="size-4 text-ai" /> What the AI knows
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {p.aiNotes ? <p className="whitespace-pre-line">{p.aiNotes}</p> : <p className="text-muted-foreground">No extra product knowledge yet. Add FAQs and details so the AI can answer confidently.</p>}
              {p.attributes && (
                <dl className="grid grid-cols-2 gap-2">
                  {Object.entries(p.attributes).map(([k, v]) => (
                    <div key={k} className="rounded-lg border p-2">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <DetailRow label="Status">
                  <StatusBadge map={PRODUCT_STATUS} value={p.status} />
                </DetailRow>
                <DetailRow label="Stock">{p.inventory ? <StatusBadge map={STOCK_STATUS} value={p.inventory.status} /> : 'Not tracked'}</DetailRow>
                <DetailRow label="On hand">{p.inventory?.onHand ?? '—'}</DetailRow>
                <DetailRow label="Low-stock alert at">{p.inventory?.lowStockThreshold ?? '—'}</DetailRow>
                <DetailRow label="Cost">{p.cost ? money(p.cost, currency) : '—'}</DetailRow>
                <DetailRow label="Updated">{relative(p.updatedAt)}</DetailRow>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent stock movements</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              {!p.recentMovements.length ? (
                <p className="text-sm text-muted-foreground">No movements yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {p.recentMovements.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate">{titleCase(m.type)}{m.reference ? ` · ${m.reference}` : ''}</p>
                        <p className="text-xs text-muted-foreground">{relative(m.createdAt)}</p>
                      </div>
                      <span className={m.quantity >= 0 ? 'font-medium text-success tabular' : 'font-medium tabular'}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
