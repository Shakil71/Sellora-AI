'use client';

import { PageHeader } from '@/components/shared/page';
import { ProductForm } from '@/features/products/product-form';

export default function NewProductPage() {
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Products', href: '/products' }, { label: 'New' }]} title="Add product" description="Products you add are available to your team and your AI sales agent." />
      <ProductForm />
    </>
  );
}
