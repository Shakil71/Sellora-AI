'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, History, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Paginated } from '@/lib/api';
import { relative, titleCase } from '@/lib/format';
import { STOCK_STATUS } from '@/lib/status';
import { useSession } from '@/components/session';
import { PageHeader, StatCard, StatusBadge } from '@/components/shared/page';
import { DataTable, FilterChips, Pagination, SearchInput, Toolbar } from '@/components/shared/data-table';
import { Input, Tabs, TabsContent, TabsList, TabsTrigger, RadioGroup, RadioGroupItem, Label } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Field } from '@/components/shared/form';
import { ProductThumb } from '@/features/products/product-thumb';
import { useListState } from '@/hooks/use-list-state';

interface Row {
  id: string;
  productId: string;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  status: string;
  updatedAt: string;
  product: { id: string; name: string; sku: string; images: string[]; status: string };
}
interface Movement {
  id: string;
  type: string;
  quantity: number;
  onHandAfter: number;
  reservedAfter: number;
  reason: string | null;
  reference: string | null;
  actorName: string | null;
  createdAt: string;
  product: { id: string; name: string; sku: string };
}

function AdjustDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = React.useState<'add' | 'remove' | 'set'>('add');
  const [quantity, setQuantity] = React.useState(0);
  const [threshold, setThreshold] = React.useState(5);
  const [reason, setReason] = React.useState('');
  React.useEffect(() => {
    if (row) {
      setMode('add');
      setQuantity(0);
      setThreshold(row.lowStockThreshold);
      setReason('');
    }
  }, [row]);
  const save = useMutation({
    mutationFn: () => api.post(`/inventory/${row!.productId}/adjust`, { mode, quantity, reason: reason || undefined, lowStockThreshold: threshold }),
    onSuccess: () => {
      toast.success('Stock updated');
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-movements'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
  });
  const preview = row ? (mode === 'add' ? row.onHand + quantity : mode === 'remove' ? row.onHand - quantity : quantity) : 0;
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>{row?.product.name}</DialogDescription>
        </DialogHeader>
        {row && (
          <div className="space-y-4">
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as typeof mode)} className="grid-cols-3 gap-2">
              {(['add', 'remove', 'set'] as const).map((m) => (
                <Label key={m} htmlFor={`m-${m}`} className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-primary/5">
                  <RadioGroupItem id={`m-${m}`} value={m} />
                  {m === 'add' ? 'Receive' : m === 'remove' ? 'Remove' : 'Set count'}
                </Label>
              ))}
            </RadioGroup>
            <div className="grid grid-cols-2 gap-3">
              <Field label={mode === 'set' ? 'New on-hand count' : 'Quantity'} htmlFor="adj-q">
                <Input id="adj-q" type="number" min={0} value={quantity} onChange={(e) => setQuantity(Math.max(0, Number(e.target.value)))} />
              </Field>
              <Field label="Low-stock alert at" htmlFor="adj-t">
                <Input id="adj-t" type="number" min={0} value={threshold} onChange={(e) => setThreshold(Math.max(0, Number(e.target.value)))} />
              </Field>
            </div>
            <Field label="Reason" htmlFor="adj-r" hint="e.g. Supplier delivery, damaged, stock count">
              <Input id="adj-r" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="rounded-lg bg-muted/60 p-3 text-sm">
              On hand: <span className="font-medium tabular">{row.onHand}</span> → <span className={preview < 0 ? 'font-semibold text-destructive' : 'font-semibold tabular'}>{preview}</span>
              <span className="ml-2 text-muted-foreground">({row.reserved} reserved for open orders)</span>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={preview < 0}>
            Save adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function InventoryPage() {
  const { can } = useSession();
  const [adjusting, setAdjusting] = React.useState<Row | null>(null);
  const list = useListState<{ status?: string }>({}, ['search', 'status']);
  const [mPage, setMPage] = React.useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['inventory', list.query],
    queryFn: () => api.get<Paginated<Row> & { statusCounts: Record<string, number> }>('/inventory', { ...list.query, pageSize: 25 }),
    placeholderData: (p) => p,
  });
  const movements = useQuery({
    queryKey: ['inventory-movements', mPage],
    queryFn: () => api.get<Paginated<Movement>>('/inventory/movements', { page: mPage, pageSize: 25 }),
  });
  const c = data?.statusCounts ?? {};

  return (
    <>
      <PageHeader title="Inventory" description="Stock on hand, reserved for open orders and available to sell." />
      <div className="mb-6 grid grid-cols-3 gap-3">
        <StatCard label="In stock" value={c.IN_STOCK ?? 0} loading={isLoading} />
        <StatCard label="Low stock" value={c.LOW_STOCK ?? 0} loading={isLoading} tone="warning" />
        <StatCard label="Out of stock" value={c.OUT_OF_STOCK ?? 0} loading={isLoading} />
      </div>
      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">
            <Boxes /> Stock levels
          </TabsTrigger>
          <TabsTrigger value="movements">
            <History /> Movement history
          </TabsTrigger>
        </TabsList>
        <TabsContent value="stock">
          <Toolbar>
            <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search product or SKU" />
            <FilterChips
              value={list.filters.status ?? 'ALL'}
              onChange={(v) => list.setFilter('status', v === 'ALL' ? undefined : v)}
              options={[{ value: 'ALL', label: 'All' }, ...Object.entries(STOCK_STATUS).map(([k, v]) => ({ value: k, label: v.label }))]}
            />
          </Toolbar>
          <DataTable
            rows={data?.items}
            loading={isLoading}
            empty={{ icon: Boxes, title: 'No stock records', description: 'Stock is tracked automatically for every product you add.' }}
            mobileCard={(r) => (
              <div className="flex items-center gap-3">
                <ProductThumb src={r.product.images[0]} name={r.product.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.onHand} on hand · {r.reserved} reserved
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="font-semibold tabular">{Math.max(0, r.available)}</span>
                  {can('inventory.update') && (
                    <Button variant="outline" size="sm" onClick={() => setAdjusting(r)}>
                      Adjust
                    </Button>
                  )}
                </div>
              </div>
            )}
            columns={[
              {
                key: 'product',
                header: 'Product',
                cell: (r) => (
                  <Link href={`/products/${r.product.id}`} className="flex items-center gap-3 hover:underline">
                    <ProductThumb src={r.product.images[0]} name={r.product.name} size={36} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.product.name}</span>
                      <span className="text-xs text-muted-foreground">{r.product.sku}</span>
                    </span>
                  </Link>
                ),
              },
              { key: 'onHand', header: 'On hand', align: 'right', cell: (r) => <span className="tabular">{r.onHand}</span> },
              { key: 'reserved', header: 'Reserved', align: 'right', hideBelow: 'md', cell: (r) => <span className="text-muted-foreground tabular">{r.reserved}</span> },
              { key: 'available', header: 'Available', align: 'right', cell: (r) => <span className="font-semibold tabular">{Math.max(0, r.available)}</span> },
              { key: 'threshold', header: 'Alert at', align: 'right', hideBelow: 'lg', cell: (r) => <span className="text-muted-foreground tabular">{r.lowStockThreshold}</span> },
              { key: 'status', header: 'Status', cell: (r) => <StatusBadge map={STOCK_STATUS} value={r.status} /> },
              {
                key: 'actions',
                header: <span className="sr-only">Actions</span>,
                align: 'right',
                cell: (r) =>
                  can('inventory.update') && (
                    <Button variant="outline" size="sm" onClick={() => setAdjusting(r)}>
                      <SlidersHorizontal /> Adjust
                    </Button>
                  ),
              },
            ]}
            footer={data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={list.setPage} label="products" />}
          />
        </TabsContent>
        <TabsContent value="movements">
          <DataTable
            rows={movements.data?.items}
            loading={movements.isLoading}
            empty={{ icon: History, title: 'No stock movements yet' }}
            mobileCard={(m) => (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{m.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {titleCase(m.type)} · {relative(m.createdAt)}
                  </p>
                </div>
                <span className="font-semibold tabular">{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span>
              </div>
            )}
            columns={[
              { key: 'when', header: 'When', cell: (m) => <span className="text-muted-foreground">{relative(m.createdAt)}</span> },
              { key: 'product', header: 'Product', cell: (m) => <span className="font-medium">{m.product.name}</span> },
              { key: 'type', header: 'Type', cell: (m) => titleCase(m.type) },
              { key: 'qty', header: 'Change', align: 'right', cell: (m) => <span className={m.quantity > 0 ? 'font-medium text-success tabular' : 'font-medium tabular'}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span> },
              { key: 'after', header: 'On hand after', align: 'right', hideBelow: 'md', cell: (m) => <span className="tabular">{m.onHandAfter}</span> },
              { key: 'ref', header: 'Reason / reference', hideBelow: 'lg', cell: (m) => <span className="text-muted-foreground">{[m.reason, m.reference].filter(Boolean).join(' · ') || '—'}</span> },
              { key: 'by', header: 'By', hideBelow: 'lg', cell: (m) => <span className="text-muted-foreground">{m.actorName ?? 'System'}</span> },
            ]}
            footer={movements.data && <Pagination page={movements.data.meta.page} totalPages={movements.data.meta.totalPages} total={movements.data.meta.total} onPage={setMPage} label="movements" />}
          />
        </TabsContent>
      </Tabs>
      <AdjustDialog row={adjusting} onClose={() => setAdjusting(null)} />
    </>
  );
}
