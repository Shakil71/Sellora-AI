'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, Package, Plus } from 'lucide-react';
import { ProductThumb } from '@/features/products/product-thumb';
import { api, type Paginated } from '@/lib/api';
import { money } from '@/lib/format';
import { PRODUCT_STATUS, STOCK_STATUS } from '@/lib/status';
import type { Category, Product } from '@/lib/types';
import { useSession } from '@/components/session';
import { PageHeader, StatusBadge } from '@/components/shared/page';
import { DataTable, Pagination, SearchInput, Toolbar } from '@/components/shared/data-table';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';
import { useListState } from '@/hooks/use-list-state';

export default function ProductsPage() {
  const router = useRouter();
  const { can, currency } = useSession();
  const list = useListState<{ categoryId?: string; status?: string; stockStatus?: string }>({}, ['categoryId', 'search']);
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories') });
  const { data, isLoading } = useQuery({
    queryKey: ['products', list.query],
    queryFn: () => api.get<Paginated<Product>>('/products', { ...list.query, pageSize: 20 }),
    placeholderData: (p) => p,
  });
  const filtered = list.search || list.filters.categoryId || list.filters.status || list.filters.stockStatus;

  return (
    <>
      <PageHeader
        title="Products"
        description="Your catalog. Active products can be recommended and sold by the AI sales agent."
        actions={
          can('products.create') && (
            <>
              <Button variant="outline" asChild>
                <Link href="/products/import">
                  <Download /> Import from store or file
                </Link>
              </Button>
              <Button asChild>
                <Link href="/products/new">
                  <Plus /> Add product
                </Link>
              </Button>
            </>
          )
        }
      />
      <Toolbar>
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search name, SKU or tag" />
        <Select value={list.filters.categoryId ?? 'all'} onValueChange={(v) => list.setFilter('categoryId', v === 'all' ? undefined : v)}>
          <SelectTrigger className="sm:w-44" aria-label="Category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.data?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={list.filters.status ?? 'all'} onValueChange={(v) => list.setFilter('status', v === 'all' ? undefined : v)}>
          <SelectTrigger className="sm:w-36" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            {Object.entries(PRODUCT_STATUS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={list.filters.stockStatus ?? 'all'} onValueChange={(v) => list.setFilter('stockStatus', v === 'all' ? undefined : v)}>
          <SelectTrigger className="sm:w-40" aria-label="Stock">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any stock</SelectItem>
            {Object.entries(STOCK_STATUS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Toolbar>
      <DataTable
        rows={data?.items}
        loading={isLoading}
        onRowClick={(p) => router.push(`/products/${p.id}`)}
        empty={{
          icon: Package,
          title: filtered ? 'No products match your filters' : 'No products yet',
          description: filtered ? 'Try clearing filters.' : 'Add your first product to let your AI Sales Agent recommend products.',
          action: !filtered && can('products.create') ? <Button asChild><Link href="/products/new"><Plus /> Add product</Link></Button> : undefined,
        }}
        mobileCard={(p) => (
          <div className="flex items-center gap-3">
            <ProductThumb src={p.images[0]} name={p.name} size={44} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{p.name}</p>
              <p className="text-xs text-muted-foreground">{p.sku}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-sm font-medium tabular">{money(p.effectivePrice, currency)}</span>
              {p.inventory && p.trackInventory && <StatusBadge map={STOCK_STATUS} value={p.inventory.status} />}
            </div>
          </div>
        )}
        columns={[
          {
            key: 'name',
            header: 'Product',
            cell: (p) => (
              <div className="flex items-center gap-3">
                <ProductThumb src={p.images[0]} name={p.name} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.sku}</p>
                </div>
              </div>
            ),
          },
          { key: 'category', header: 'Category', hideBelow: 'lg', cell: (p) => <span className="text-muted-foreground">{p.category?.name ?? '—'}</span> },
          { key: 'status', header: 'Status', hideBelow: 'md', cell: (p) => <StatusBadge map={PRODUCT_STATUS} value={p.status} /> },
          {
            key: 'stock',
            header: 'Stock',
            cell: (p) =>
              p.trackInventory && p.inventory ? (
                <div className="flex items-center gap-2">
                  <span className="w-8 tabular">{Math.max(0, p.available ?? 0)}</span>
                  <StatusBadge map={STOCK_STATUS} value={p.inventory.status} />
                </div>
              ) : (
                <span className="text-muted-foreground">Not tracked</span>
              ),
          },
          {
            key: 'price',
            header: 'Price',
            align: 'right',
            cell: (p) => (
              <div>
                <span className="font-medium tabular">{money(p.effectivePrice, currency)}</span>
                {p.salePrice && Number(p.salePrice) < Number(p.price) && <span className="ml-1.5 text-xs text-muted-foreground line-through">{money(p.price, currency)}</span>}
              </div>
            ),
          },
        ]}
        footer={data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={list.setPage} label="products" />}
      />
    </>
  );
}
