'use client';

import { PageHeader } from '@/components/shared/page';
import { useSession } from '@/components/session';
import { EmptyState } from '@/components/shared/page';
import { ProductImporter } from '@/features/products/product-import';

export default function ImportProductsPage() {
  const { can } = useSession();
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Products', href: '/products' }, { label: 'Import' }]}
        title="Import products"
        description="Bring in your whole catalog automatically: names, photos, SKUs, prices, categories, stock and details such as color, size or shape. You review everything before anything is saved."
      />
      {can('products.create') ? <ProductImporter /> : <EmptyState title="You don’t have permission to import products" description="Ask a workspace admin for the “Create products” permission." />}
    </>
  );
}
