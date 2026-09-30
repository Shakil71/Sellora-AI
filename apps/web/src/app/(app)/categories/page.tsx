'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { Category } from '@/lib/types';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { PageHeader } from '@/components/shared/page';
import { DataTable } from '@/components/shared/data-table';
import { Badge, Input, Label, Switch, Textarea } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Field, ImageUpload } from '@/components/shared/form';
import { ProductThumb } from '@/features/products/product-thumb';
import { useOpenFromQuery } from '@/hooks/use-list-state';

function CategoryDialog({ open, onOpenChange, category }: { open: boolean; onOpenChange: (o: boolean) => void; category?: Category | null }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [image, setImage] = React.useState<string[]>([]);
  const [active, setActive] = React.useState(true);
  React.useEffect(() => {
    if (!open) return;
    setName(category?.name ?? '');
    setDescription(category?.description ?? '');
    setImage(category?.imageUrl ? [category.imageUrl] : []);
    setActive((category?.status ?? 'ACTIVE') === 'ACTIVE');
  }, [open, category]);
  const save = useMutation({
    mutationFn: () => {
      const body = { name, description: description || null, imageUrl: image[0] ?? null, status: active ? 'ACTIVE' : 'INACTIVE' };
      return category ? api.patch(`/categories/${category.id}`, body) : api.post('/categories', body);
    },
    onSuccess: () => {
      toast.success('Category saved');
      qc.invalidateQueries({ queryKey: ['categories'] });
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? 'Edit category' : 'New category'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Name" htmlFor="cat-name" required>
            <Input id="cat-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="cat-desc">
            <Textarea id="cat-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Image">
            <ImageUpload value={image} onChange={setImage} max={1} purpose="category" />
          </Field>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="cat-active">Active</Label>
            <Switch id="cat-active" checked={active} onCheckedChange={setActive} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CategoriesPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const [dialog, setDialog] = React.useState<{ open: boolean; category?: Category | null }>({ open: false });
  const openNew = React.useCallback((o: boolean) => setDialog({ open: o }), []);
  useOpenFromQuery(openNew);
  const { data, isLoading } = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories') });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/categories/${id}`),
    onSuccess: () => {
      toast.success('Category deleted');
      qc.invalidateQueries({ queryKey: ['categories'] });
    },
  });
  return (
    <>
      <PageHeader
        title="Categories"
        description="Group products so customers and the AI agent can browse them."
        actions={
          can('products.create') && (
            <Button onClick={() => setDialog({ open: true })}>
              <Plus /> New category
            </Button>
          )
        }
      />
      <DataTable
        rows={data}
        loading={isLoading}
        empty={{ icon: Tags, title: 'No categories yet', description: 'Create categories like "Audio" or "Accessories" to organize your catalog.' }}
        mobileCard={(c) => (
          <div className="flex items-center gap-3">
            <ProductThumb src={c.imageUrl ?? undefined} name={c.name} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{c.name}</p>
              <p className="text-xs text-muted-foreground">{c.productCount} products</p>
            </div>
            {can('products.update') && (
              <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ open: true, category: c })} aria-label="Edit">
                <Pencil />
              </Button>
            )}
          </div>
        )}
        columns={[
          {
            key: 'name',
            header: 'Category',
            cell: (c) => (
              <div className="flex items-center gap-3">
                <ProductThumb src={c.imageUrl ?? undefined} name={c.name} />
                <div className="min-w-0">
                  <p className="font-medium">{c.name}</p>
                  <p className="line-clamp-1 text-xs text-muted-foreground">{c.description ?? ''}</p>
                </div>
              </div>
            ),
          },
          { key: 'status', header: 'Status', cell: (c) => <Badge variant={c.status === 'ACTIVE' ? 'success' : 'muted'}>{c.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge> },
          {
            key: 'products',
            header: 'Products',
            align: 'right',
            cell: (c) => (
              <Link href={`/products?categoryId=${c.id}`} className="tabular hover:underline">
                {c.productCount}
              </Link>
            ),
          },
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right',
            cell: (c) => (
              <div className="flex justify-end">
                {can('products.update') && (
                  <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ open: true, category: c })} aria-label={`Edit ${c.name}`}>
                    <Pencil />
                  </Button>
                )}
                {can('products.delete') && (
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${c.name}`} onClick={async () => (await confirm({ title: `Delete ${c.name}?`, description: 'Products in this category are kept without a category.', destructive: true, confirmLabel: 'Delete' })) && remove.mutate(c.id)}>
                    <Trash2 />
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
      <CategoryDialog open={dialog.open} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} category={dialog.category} />
    </>
  );
}
