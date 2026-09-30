'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Product } from '@/lib/types';
import { ErrorState, PageHeader, PageSkeleton } from '@/components/shared/page';
import { ProductForm } from '@/features/products/product-form';

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['product', id], queryFn: () => api.get<Product>(`/products/${id}`) });
  if (isLoading) return <PageSkeleton />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Products', href: '/products' }, { label: data.name, href: `/products/${id}` }, { label: 'Edit' }]} title={`Edit ${data.name}`} />
      <ProductForm product={data} />
    </>
  );
}
