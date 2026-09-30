'use client';

import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import type { Customer } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Field, FormGrid, TagInput } from '@/components/shared/form';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().email('Invalid email').or(z.literal('')),
  phone: z.string().trim().max(30),
  whatsappNumber: z.string().trim().max(30),
  company: z.string().trim().max(120),
  addressLine: z.string().trim().max(250),
  city: z.string().trim().max(80),
  country: z.string().trim().max(80),
  postalCode: z.string().trim().max(20),
  notes: z.string().max(5000),
  tags: z.array(z.string()),
});
type Values = z.infer<typeof schema>;

const toValues = (c?: Partial<Customer> | null): Values => ({
  name: c?.name ?? '',
  email: c?.email ?? '',
  phone: c?.phone ?? '',
  whatsappNumber: c?.whatsappNumber ?? '',
  company: c?.company ?? '',
  addressLine: c?.addressLine ?? '',
  city: c?.city ?? '',
  country: c?.country ?? '',
  postalCode: c?.postalCode ?? '',
  notes: c?.notes ?? '',
  tags: c?.tags ?? [],
});

export function CustomerFormDialog({ open, onOpenChange, customer, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; customer?: Customer | null; onSaved?: (c: Customer) => void }) {
  const qc = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(customer) });
  React.useEffect(() => {
    if (open) form.reset(toValues(customer));
  }, [open, customer, form]);
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: (v: Values) => {
      const body = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, typeof val === 'string' && val === '' && k !== 'name' ? null : val]));
      return customer ? api.patch<Customer>(`/customers/${customer.id}`, body) : api.post<Customer>('/customers', body);
    },
    meta: { silent: true },
    onSuccess: (c) => {
      toast.success(customer ? 'Customer updated' : 'Customer created');
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer', c.id] });
      onOpenChange(false);
      onSaved?.(c);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        Object.entries(err.fieldErrors).forEach(([k, m]) => form.setError(k as keyof Values, { message: m }));
      }
      toast.error(err instanceof Error ? err.message : 'Could not save');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{customer ? 'Edit customer' : 'New customer'}</DialogTitle>
          <DialogDescription>Contact details are used by your team and by the AI agent when taking orders.</DialogDescription>
        </DialogHeader>
        <form id="customer-form" onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4">
          <FormGrid>
            <Field label="Full name" htmlFor="c-name" required error={errors.name?.message}>
              <Input id="c-name" {...form.register('name')} aria-invalid={!!errors.name} autoFocus />
            </Field>
            <Field label="Company" htmlFor="c-company">
              <Input id="c-company" {...form.register('company')} />
            </Field>
            <Field label="WhatsApp number" htmlFor="c-wa" hint="International format, e.g. +14155550100" error={errors.whatsappNumber?.message}>
              <Input id="c-wa" type="tel" inputMode="tel" {...form.register('whatsappNumber')} />
            </Field>
            <Field label="Phone" htmlFor="c-phone">
              <Input id="c-phone" type="tel" inputMode="tel" {...form.register('phone')} />
            </Field>
            <Field label="Email" htmlFor="c-email" error={errors.email?.message} className="sm:col-span-2">
              <Input id="c-email" type="email" {...form.register('email')} aria-invalid={!!errors.email} />
            </Field>
            <Field label="Address" htmlFor="c-address" className="sm:col-span-2">
              <Input id="c-address" {...form.register('addressLine')} />
            </Field>
            <Field label="City" htmlFor="c-city">
              <Input id="c-city" {...form.register('city')} />
            </Field>
            <FormGrid className="gap-3">
              <Field label="Country" htmlFor="c-country">
                <Input id="c-country" {...form.register('country')} />
              </Field>
              <Field label="Postal code" htmlFor="c-postal">
                <Input id="c-postal" {...form.register('postalCode')} />
              </Field>
            </FormGrid>
          </FormGrid>
          <Field label="Tags" htmlFor="c-tags">
            <Controller control={form.control} name="tags" render={({ field }) => <TagInput id="c-tags" value={field.value} onChange={field.onChange} />} />
          </Field>
          <Field label="Notes" htmlFor="c-notes">
            <Textarea id="c-notes" rows={3} {...form.register('notes')} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="customer-form" loading={save.isPending}>
            {customer ? 'Save changes' : 'Create customer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
