'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import type { Category, Product } from '@/lib/types';
import { useSession } from '@/components/session';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Switch, Textarea } from '@/components/ui/primitives';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';
import { Field, FormGrid, ImageUpload, MoneyInput, TagInput } from '@/components/shared/form';

interface Values {
  name: string;
  sku: string;
  description: string;
  price: number | null;
  salePrice: number | null;
  cost: number | null;
  categoryId: string | null;
  images: string[];
  status: string;
  tags: string[];
  aiNotes: string;
  trackInventory: boolean;
  initialStock: number;
  lowStockThreshold: number;
  attributes: Array<{ key: string; value: string }>;
}

const NONE = '__none__';

export function ProductForm({ product }: { product?: Product | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { currency } = useSession();
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories') });
  const form = useForm<Values>({
    defaultValues: {
      name: product?.name ?? '',
      sku: product?.sku ?? '',
      description: product?.description ?? '',
      price: product ? Number(product.price) : null,
      salePrice: product?.salePrice ? Number(product.salePrice) : null,
      cost: product?.cost ? Number(product.cost) : null,
      categoryId: product?.categoryId ?? null,
      images: product?.images ?? [],
      status: product?.status ?? 'ACTIVE',
      tags: product?.tags ?? [],
      aiNotes: product?.aiNotes ?? '',
      trackInventory: product?.trackInventory ?? true,
      initialStock: 0,
      lowStockThreshold: 5,
      attributes: Object.entries(product?.attributes ?? {}).map(([key, value]) => ({ key, value })),
    },
  });
  const attrs = useFieldArray({ control: form.control, name: 'attributes' });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: (v: Values) => {
      const attributes = Object.fromEntries(v.attributes.filter((a) => a.key.trim()).map((a) => [a.key.trim(), a.value.trim()]));
      const body = {
        name: v.name,
        sku: v.sku,
        description: v.description || null,
        price: v.price ?? 0,
        salePrice: v.salePrice,
        cost: v.cost,
        categoryId: v.categoryId,
        images: v.images,
        status: v.status,
        tags: v.tags,
        aiNotes: v.aiNotes || null,
        trackInventory: v.trackInventory,
        attributes: Object.keys(attributes).length ? attributes : null,
        ...(product ? {} : { initialStock: Number(v.initialStock) || 0, lowStockThreshold: Number(v.lowStockThreshold) || 0 }),
      };
      return product ? api.patch<Product>(`/products/${product.id}`, body) : api.post<Product>('/products', body);
    },
    meta: { silent: true },
    onSuccess: (p) => {
      toast.success(product ? 'Product saved' : 'Product created');
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product', p.id] });
      router.push(`/products/${p.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError) Object.entries(err.fieldErrors).forEach(([k, m]) => form.setError(k as keyof Values, { message: m }));
      toast.error(err instanceof Error ? err.message : 'Could not save product');
    },
  });

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Product details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Name" htmlFor="p-name" required error={errors.name?.message}>
              <Input id="p-name" autoFocus {...form.register('name', { required: 'Name is required' })} aria-invalid={!!errors.name} />
            </Field>
            <Field label="Description" htmlFor="p-desc" hint="Shown to customers and used by the AI agent.">
              <Textarea id="p-desc" rows={5} {...form.register('description')} />
            </Field>
            <Field label="Images" hint="First image is the cover. PNG, JPG or WebP.">
              <Controller control={form.control} name="images" render={({ field }) => <ImageUpload value={field.value} onChange={field.onChange} />} />
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pricing</CardTitle>
          </CardHeader>
          <CardContent>
            <FormGrid className="sm:grid-cols-3">
              <Field label="Price" htmlFor="p-price" required error={errors.price?.message}>
                <Controller control={form.control} name="price" rules={{ required: 'Price is required' }} render={({ field }) => <MoneyInput id="p-price" currency={currency} value={field.value} onChange={field.onChange} />} />
              </Field>
              <Field label="Sale price" htmlFor="p-sale" error={errors.salePrice?.message} hint="Optional">
                <Controller control={form.control} name="salePrice" render={({ field }) => <MoneyInput id="p-sale" currency={currency} value={field.value} onChange={field.onChange} />} />
              </Field>
              <Field label="Cost" htmlFor="p-cost" hint="Private, for margins">
                <Controller control={form.control} name="cost" render={({ field }) => <MoneyInput id="p-cost" currency={currency} value={field.value} onChange={field.onChange} />} />
              </Field>
            </FormGrid>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-4 text-ai" /> Product knowledge for AI
            </CardTitle>
            <CardDescription>FAQs, sizing, compatibility, warranty — anything the AI agent should know when recommending this product.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea rows={4} {...form.register('aiNotes')} placeholder="e.g. Battery lasts 30 hours. Compatible with iPhone and Android. 2-year warranty." aria-label="AI product notes" />
            <div className="space-y-2">
              <Label>Attributes</Label>
              {attrs.fields.map((f, i) => (
                <div key={f.id} className="flex gap-2">
                  <Input placeholder="Name (e.g. Color)" {...form.register(`attributes.${i}.key`)} aria-label="Attribute name" />
                  <Input placeholder="Value (e.g. Black)" {...form.register(`attributes.${i}.value`)} aria-label="Attribute value" />
                  <Button type="button" variant="ghost" size="icon" onClick={() => attrs.remove(i)} aria-label="Remove attribute">
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => attrs.append({ key: '', value: '' })}>
                <Plus /> Add attribute
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Organization</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Status" htmlFor="p-status">
              <Controller
                control={form.control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="p-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACTIVE">Active — available for sale</SelectItem>
                      <SelectItem value="DRAFT">Draft — hidden</SelectItem>
                      <SelectItem value="ARCHIVED">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="SKU" htmlFor="p-sku" required error={errors.sku?.message}>
              <Input id="p-sku" {...form.register('sku', { required: 'SKU is required' })} aria-invalid={!!errors.sku} />
            </Field>
            <Field label="Category" htmlFor="p-cat">
              <Controller
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                    <SelectTrigger id="p-cat">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No category</SelectItem>
                      {categories.data?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Tags" htmlFor="p-tags" hint="Help search and AI recommendations.">
              <Controller control={form.control} name="tags" render={({ field }) => <TagInput id="p-tags" value={field.value} onChange={field.onChange} />} />
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Inventory</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="p-track">Track stock</Label>
              <Controller control={form.control} name="trackInventory" render={({ field }) => <Switch id="p-track" checked={field.value} onCheckedChange={field.onChange} />} />
            </div>
            {!product && form.watch('trackInventory') && (
              <FormGrid className="grid-cols-2 sm:grid-cols-2">
                <Field label="Starting stock" htmlFor="p-stock">
                  <Input id="p-stock" type="number" min={0} {...form.register('initialStock', { valueAsNumber: true })} />
                </Field>
                <Field label="Low stock at" htmlFor="p-low">
                  <Input id="p-low" type="number" min={0} {...form.register('lowStockThreshold', { valueAsNumber: true })} />
                </Field>
              </FormGrid>
            )}
            {product && <p className="text-xs text-muted-foreground">Adjust stock from the Inventory page so every change is recorded.</p>}
          </CardContent>
        </Card>
        <div className="flex gap-2 lg:sticky lg:top-20">
          <Button type="button" variant="outline" className="flex-1" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" loading={save.isPending}>
            {product ? 'Save product' : 'Create product'}
          </Button>
        </div>
      </div>
    </form>
  );
}
