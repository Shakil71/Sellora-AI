'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, CheckCircle2, CircleDashed } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Paginated } from '@/lib/api';
import type { Product } from '@/lib/types';
import { useSession } from '@/components/session';
import { EmptyState, PageHeader, StatCard } from '@/components/shared/page';
import { Pagination, SearchInput, Toolbar, FilterChips } from '@/components/shared/data-table';
import { Card, CardContent, Skeleton, Textarea } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { ProductThumb } from '@/features/products/product-thumb';
import { useListState } from '@/hooks/use-list-state';

function ProductNotes({ p }: { p: Product }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const [value, setValue] = React.useState(p.aiNotes ?? '');
  const dirty = value !== (p.aiNotes ?? '');
  const save = useMutation({
    mutationFn: () => api.patch(`/products/${p.id}`, { aiNotes: value || null }),
    onSuccess: () => {
      toast.success(`Saved knowledge for ${p.name}`);
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
  const complete = Boolean(p.description && p.aiNotes);
  return (
    <Card>
      <CardContent className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
        <div className="flex gap-3">
          <ProductThumb src={p.images[0]} name={p.name} size={48} />
          <div className="min-w-0">
            <p className="font-medium">{p.name}</p>
            <p className="text-xs text-muted-foreground">{p.sku}</p>
            <p className="mt-2 flex items-center gap-1 text-xs">
              {complete ? <CheckCircle2 className="size-3.5 text-success" /> : <CircleDashed className="size-3.5 text-warning" />}
              {complete ? 'Well described' : !p.description ? 'Missing description' : 'No AI notes yet'}
            </p>
          </div>
        </div>
        <div className="space-y-2">
          <Textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} disabled={!can('products.update')} placeholder="FAQs, sizing, compatibility, care, warranty…" aria-label={`AI knowledge for ${p.name}`} />
          {dirty && can('products.update') && (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setValue(p.aiNotes ?? '')}>
                Discard
              </Button>
              <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>
                Save
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ProductKnowledgePage() {
  const list = useListState<{ filter?: string }>({ filter: 'all' });
  const { data, isLoading } = useQuery({
    queryKey: ['products', 'knowledge', list.page, list.search],
    queryFn: () => api.get<Paginated<Product>>('/products', { page: list.page, search: list.search || undefined, status: 'ACTIVE', pageSize: 20, sort: 'name', order: 'asc' }),
    placeholderData: (p) => p,
  });
  const items = (data?.items ?? []).filter((p) => (list.filters.filter === 'missing' ? !p.aiNotes || !p.description : true));
  const covered = (data?.items ?? []).filter((p) => p.aiNotes && p.description).length;
  return (
    <>
      <PageHeader title="Product knowledge" description="Extra details the AI agent uses when recommending and answering questions about active products." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Active products (this page)" value={data?.items.length ?? 0} loading={isLoading} />
        <StatCard label="Fully described" value={covered} loading={isLoading} tone="ai" />
      </div>
      <Toolbar>
        <FilterChips value={list.filters.filter ?? 'all'} onChange={(v) => list.setFilter('filter', v)} options={[{ value: 'all', label: 'All' }, { value: 'missing', label: 'Needs knowledge' }]} />
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search products" className="sm:ml-auto" />
      </Toolbar>
      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : !items.length ? (
        <Card>
          <EmptyState icon={Brain} title={list.filters.filter === 'missing' ? 'Every product on this page is described' : 'No active products'} description="Add products to your catalog to give your AI agent something to sell." />
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((p) => (
            <ProductNotes key={p.id} p={p} />
          ))}
        </div>
      )}
      {data && (
        <Card className="mt-4">
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={list.setPage} label="active products" />
        </Card>
      )}
    </>
  );
}
