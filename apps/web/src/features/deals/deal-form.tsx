'use client';

import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useSession } from '@/components/session';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';
import { Field, FormGrid, MoneyInput } from '@/components/shared/form';
import { CustomerPicker, MemberSelect } from '@/components/shared/pickers';
import { PRIORITY } from '@/lib/status';

export interface Stage {
  id: string;
  name: string;
  probability: number;
  color: string | null;
  type: 'OPEN' | 'WON' | 'LOST';
  position: number;
}
export interface Pipeline {
  id: string;
  name: string;
  isDefault: boolean;
  stages: Stage[];
  _count?: { deals: number };
}
export interface Deal {
  id: string;
  name: string;
  amount: string;
  probability: number;
  priority: string;
  status: string;
  stageId: string;
  pipelineId: string;
  expectedCloseDate: string | null;
  notes: string | null;
  lastActivityAt: string;
  customerId: string | null;
  assignedUserId: string | null;
  customer: { id: string; name: string } | null;
  assignedUser: { id: string; name: string; avatarUrl: string | null } | null;
  stage: { id: string; name: string; color: string | null; type: string };
}

interface Values {
  name: string;
  amount: number | null;
  stageId: string;
  customerId: string | null;
  assignedUserId: string | null;
  priority: string;
  expectedCloseDate: string;
  notes: string;
}

export function DealFormDialog({
  open,
  onOpenChange,
  pipeline,
  deal,
  defaultStageId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pipeline: Pipeline;
  deal?: Deal | null;
  defaultStageId?: string;
}) {
  const qc = useQueryClient();
  const { currency } = useSession();
  const form = useForm<Values>();
  React.useEffect(() => {
    if (!open) return;
    form.reset({
      name: deal?.name ?? '',
      amount: deal ? Number(deal.amount) : null,
      stageId: deal?.stageId ?? defaultStageId ?? pipeline.stages[0]?.id ?? '',
      customerId: deal?.customerId ?? null,
      assignedUserId: deal?.assignedUserId ?? null,
      priority: deal?.priority ?? 'MEDIUM',
      expectedCloseDate: deal?.expectedCloseDate?.slice(0, 10) ?? '',
      notes: deal?.notes ?? '',
    });
  }, [open, deal, defaultStageId, pipeline, form]);

  const save = useMutation({
    mutationFn: (v: Values) => {
      const body = {
        name: v.name,
        amount: v.amount ?? 0,
        pipelineId: pipeline.id,
        stageId: v.stageId,
        customerId: v.customerId,
        assignedUserId: v.assignedUserId,
        priority: v.priority,
        expectedCloseDate: v.expectedCloseDate || null,
        notes: v.notes || null,
      };
      return deal ? api.patch(`/deals/${deal.id}`, body) : api.post('/deals', body);
    },
    onSuccess: () => {
      toast.success(deal ? 'Deal updated' : 'Deal created');
      qc.invalidateQueries({ queryKey: ['pipeline-board'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{deal ? 'Edit deal' : 'New deal'}</DialogTitle>
          <DialogDescription>{pipeline.name}</DialogDescription>
        </DialogHeader>
        <form id="deal-form" onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4">
          <Field label="Deal name" htmlFor="d-name" required error={form.formState.errors.name?.message}>
            <Input id="d-name" autoFocus {...form.register('name', { required: 'Name is required' })} />
          </Field>
          <FormGrid>
            <Field label="Amount" htmlFor="d-amount">
              <Controller control={form.control} name="amount" render={({ field }) => <MoneyInput id="d-amount" currency={currency} value={field.value} onChange={field.onChange} />} />
            </Field>
            <Field label="Stage" htmlFor="d-stage">
              <Controller
                control={form.control}
                name="stageId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="d-stage">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {pipeline.stages.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Customer" htmlFor="d-customer">
              <Controller
                control={form.control}
                name="customerId"
                render={({ field }) => <CustomerPicker id="d-customer" value={field.value} selectedLabel={deal?.customer?.name} onChange={(v) => field.onChange(v)} />}
              />
            </Field>
            <Field label="Owner" htmlFor="d-owner">
              <Controller control={form.control} name="assignedUserId" render={({ field }) => <MemberSelect id="d-owner" value={field.value} onChange={field.onChange} />} />
            </Field>
            <Field label="Priority" htmlFor="d-priority">
              <Controller
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="d-priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PRIORITY).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Expected close" htmlFor="d-close">
              <Input id="d-close" type="date" {...form.register('expectedCloseDate')} />
            </Field>
          </FormGrid>
          <Field label="Notes" htmlFor="d-notes">
            <Textarea id="d-notes" rows={3} {...form.register('notes')} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="deal-form" loading={save.isPending}>
            {deal ? 'Save changes' : 'Create deal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
