'use client';

import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { Lead } from '@/lib/types';
import { LEAD_STATUS } from '@/lib/status';
import { useSession } from '@/components/session';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';
import { Field, FormGrid, MoneyInput, TagInput } from '@/components/shared/form';
import { MemberSelect } from '@/components/shared/pickers';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().email('Invalid email').or(z.literal('')),
  phone: z.string().trim().max(30),
  company: z.string().trim().max(120),
  source: z.string().trim().max(60),
  status: z.string(),
  score: z.coerce.number().int().min(0).max(100),
  value: z.number().min(0).nullable(),
  assignedUserId: z.string().nullable(),
  notes: z.string().max(5000),
  tags: z.array(z.string()),
});
type Values = z.infer<typeof schema>;

const toValues = (l?: Lead | null): Values => ({
  name: l?.name ?? '',
  email: l?.email ?? '',
  phone: l?.phone ?? '',
  company: l?.company ?? '',
  source: l?.source ?? '',
  status: l?.status ?? 'NEW',
  score: l?.score ?? 0,
  value: l?.value ? Number(l.value) : null,
  assignedUserId: l?.assignedUserId ?? null,
  notes: l?.notes ?? '',
  tags: l?.tags ?? [],
});

export function LeadFormDialog({ open, onOpenChange, lead, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; lead?: Lead | null; onSaved?: (l: Lead) => void }) {
  const qc = useQueryClient();
  const { currency } = useSession();
  const form = useForm<Values>({ resolver: zodResolver(schema) as never, defaultValues: toValues(lead) });
  React.useEffect(() => {
    if (open) form.reset(toValues(lead));
  }, [open, lead, form]);
  const { errors } = form.formState;
  const save = useMutation({
    mutationFn: (v: Values) => {
      const body = { ...v, email: v.email || null, phone: v.phone || null, company: v.company || null, source: v.source || null, notes: v.notes || null };
      return lead ? api.patch<Lead>(`/leads/${lead.id}`, body) : api.post<Lead>('/leads', body);
    },
    onSuccess: (l) => {
      toast.success(lead ? 'Lead updated' : 'Lead created');
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead', l.id] });
      onOpenChange(false);
      onSaved?.(l);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lead ? 'Edit lead' : 'New lead'}</DialogTitle>
          <DialogDescription>Track potential buyers from first contact to won deal.</DialogDescription>
        </DialogHeader>
        <form id="lead-form" onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4">
          <FormGrid>
            <Field label="Name" htmlFor="l-name" required error={errors.name?.message}>
              <Input id="l-name" autoFocus {...form.register('name')} aria-invalid={!!errors.name} />
            </Field>
            <Field label="Company" htmlFor="l-company">
              <Input id="l-company" {...form.register('company')} />
            </Field>
            <Field label="Email" htmlFor="l-email" error={errors.email?.message}>
              <Input id="l-email" type="email" {...form.register('email')} />
            </Field>
            <Field label="Phone / WhatsApp" htmlFor="l-phone">
              <Input id="l-phone" type="tel" {...form.register('phone')} />
            </Field>
            <Field label="Status" htmlFor="l-status">
              <Controller
                control={form.control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="l-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(LEAD_STATUS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Source" htmlFor="l-source" hint="e.g. whatsapp, website, referral">
              <Input id="l-source" {...form.register('source')} />
            </Field>
            <Field label="Estimated value" htmlFor="l-value">
              <Controller control={form.control} name="value" render={({ field }) => <MoneyInput id="l-value" currency={currency} value={field.value} onChange={field.onChange} />} />
            </Field>
            <Field label="Score (0–100)" htmlFor="l-score" error={errors.score?.message}>
              <Input id="l-score" type="number" min={0} max={100} {...form.register('score')} />
            </Field>
            <Field label="Assigned to" htmlFor="l-assignee" className="sm:col-span-2">
              <Controller control={form.control} name="assignedUserId" render={({ field }) => <MemberSelect id="l-assignee" value={field.value} onChange={field.onChange} />} />
            </Field>
          </FormGrid>
          <Field label="Tags" htmlFor="l-tags">
            <Controller control={form.control} name="tags" render={({ field }) => <TagInput id="l-tags" value={field.value} onChange={field.onChange} />} />
          </Field>
          <Field label="Notes" htmlFor="l-notes">
            <Textarea id="l-notes" rows={3} {...form.register('notes')} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="lead-form" loading={save.isPending}>
            {lead ? 'Save changes' : 'Create lead'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
