'use client';

import * as React from 'react';
import { Command } from 'cmdk';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Loader2, Search } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { cn } from '@/lib/utils';
import { money } from '@/lib/format';
import { Popover, PopoverContent, PopoverTrigger, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays';
import { Avatar } from '@/components/ui/primitives';
import type { Customer, Product, UserRef } from '@/lib/types';

export interface PickerOption {
  value: string;
  label: string;
  description?: string;
  image?: string | null;
  disabled?: boolean;
}

/** Searchable combobox backed by an API query. */
export function AsyncPicker({
  value,
  selectedLabel,
  onChange,
  queryKey,
  fetcher,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No results',
  id,
  invalid,
  showAvatar,
}: {
  value: string | null | undefined;
  selectedLabel?: string | null;
  onChange: (value: string | null, option?: PickerOption) => void;
  queryKey: string;
  fetcher: (q: string) => Promise<PickerOption[]>;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  id?: string;
  invalid?: boolean;
  showAvatar?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const listId = React.useId();
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [label, setLabel] = React.useState<string | null>(selectedLabel ?? null);
  React.useEffect(() => setLabel(selectedLabel ?? null), [selectedLabel]);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  const { data, isFetching } = useQuery({ queryKey: ['picker', queryKey, debounced], queryFn: () => fetcher(debounced), enabled: open });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-invalid={invalid || undefined}
          className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 aria-invalid:border-destructive"
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{value ? (label ?? 'Selected') : placeholder}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command shouldFilter={false} className="flex flex-col">
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 text-muted-foreground" />
            <Command.Input value={search} onValueChange={setSearch} placeholder={searchPlaceholder} className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>
          <Command.List id={listId} className="max-h-64 overflow-y-auto p-1 scrollbar-thin">
            {!isFetching && <Command.Empty className="py-6 text-center text-sm text-muted-foreground">{emptyText}</Command.Empty>}
            {data?.map((o) => (
              <Command.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                onSelect={() => {
                  setLabel(o.label);
                  onChange(o.value, o);
                  setOpen(false);
                }}
                className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent"
              >
                {showAvatar && <Avatar name={o.label} src={o.image} size={24} />}
                {!showAvatar && o.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={o.image} alt="" className="size-7 rounded object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate">{o.label}</div>
                  {o.description && <div className="truncate text-xs text-muted-foreground">{o.description}</div>}
                </div>
                {value === o.value && <Check className="size-4 text-primary" />}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function CustomerPicker(props: { value: string | null | undefined; selectedLabel?: string | null; onChange: (id: string | null, o?: PickerOption) => void; id?: string; invalid?: boolean }) {
  return (
    <AsyncPicker
      {...props}
      queryKey="customers"
      placeholder="Select customer"
      searchPlaceholder="Search by name, email or phone"
      emptyText="No customers found"
      showAvatar
      fetcher={async (q) => {
        const res = await api.get<Paginated<Customer>>('/customers', { search: q, pageSize: 15 });
        return res.items.map((c) => ({ value: c.id, label: c.name, description: c.email ?? c.whatsappNumber ?? c.phone ?? undefined }));
      }}
    />
  );
}

export function ProductPicker(props: {
  value: string | null | undefined;
  selectedLabel?: string | null;
  onChange: (id: string | null, o?: PickerOption & { product?: Product }) => void;
  currency: string;
  id?: string;
  onlyActive?: boolean;
}) {
  const { currency, onlyActive = true, ...rest } = props;
  return (
    <AsyncPicker
      {...rest}
      onChange={(id, o) => props.onChange(id, o)}
      queryKey={`products-${onlyActive}`}
      placeholder="Select product"
      searchPlaceholder="Search products or SKU"
      emptyText="No products found"
      fetcher={async (q) => {
        const items = await api.get<Product[]>('/products/search', { q, active: onlyActive ? 'true' : undefined });
        return items.map((p) => ({
          value: p.id,
          label: p.name,
          image: p.images[0],
          description: `${p.sku} · ${money(p.effectivePrice, currency)}${p.trackInventory ? ` · ${Math.max(0, p.available ?? 0)} available` : ''}`,
          product: p,
        }));
      }}
    />
  );
}

export function useMembers() {
  return useQuery({ queryKey: ['members-assignable'], queryFn: () => api.get<UserRef[]>('/users/assignable'), staleTime: 5 * 60_000 });
}

const NONE = '__none__';

export function MemberSelect({ value, onChange, placeholder = 'Unassigned', allowNone = true, id }: { value: string | null | undefined; onChange: (id: string | null) => void; placeholder?: string; allowNone?: boolean; id?: string }) {
  const { data } = useMembers();
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>{placeholder}</SelectItem>}
        {data?.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AgentSelect({ value, onChange, id }: { value: string | null | undefined; onChange: (id: string | null) => void; id?: string }) {
  const { data } = useQuery({ queryKey: ['ai-agents'], queryFn: () => api.get<{ agents: Array<{ id: string; name: string; isActive: boolean }> }>('/ai/agents') });
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id}>
        <SelectValue placeholder="No agent" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No agent</SelectItem>
        {data?.agents.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name}
            {!a.isActive && ' (inactive)'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
