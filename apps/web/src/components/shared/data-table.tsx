'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, Input, Skeleton } from '@/components/ui/primitives';
import { EmptyState } from './page';
import type { LucideIcon } from 'lucide-react';

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
  /** Hide on small screens in table mode */
  hideBelow?: 'sm' | 'md' | 'lg';
  align?: 'left' | 'right' | 'center';
}

const hideClass = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' };

/**
 * Responsive data table. On phones it renders cards (via `mobileCard`) so
 * nothing overflows horizontally; on larger screens a regular table.
 */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  loading,
  onRowClick,
  empty,
  mobileCard,
  footer,
  className,
  skeletonRows = 6,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  empty?: { icon?: LucideIcon; title: string; description?: React.ReactNode; action?: React.ReactNode };
  mobileCard?: (row: T) => React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  skeletonRows?: number;
}) {
  const showEmpty = !loading && rows && rows.length === 0;
  return (
    <Card className={cn('overflow-hidden', className)}>
      {/* Mobile cards */}
      {mobileCard && (
        <div className="divide-y md:hidden">
          {loading &&
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2 p-4">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            ))}
          {!loading &&
            rows?.map((row) => (
              <div
                key={row.id}
                role={onRowClick ? 'button' : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
                className={cn('p-4', onRowClick && 'cursor-pointer active:bg-muted/60')}
              >
                {mobileCard(row)}
              </div>
            ))}
        </div>
      )}
      {/* Table */}
      <div className={cn('overflow-x-auto scrollbar-thin', mobileCard && 'hidden md:block')}>
        <table className="w-full caption-bottom text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    'h-10 px-4 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground',
                    c.align === 'right' && 'text-right',
                    c.align === 'center' && 'text-center',
                    c.hideBelow && hideClass[c.hideBelow],
                    c.headerClassName,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading &&
              Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-4 py-3', c.hideBelow && hideClass[c.hideBelow])}>
                      <Skeleton className="h-4 w-full max-w-[160px]" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              rows?.map((row) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn('transition-colors', onRowClick && 'cursor-pointer hover:bg-muted/40')}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        'px-4 py-3 align-middle',
                        c.align === 'right' && 'text-right',
                        c.align === 'center' && 'text-center',
                        c.hideBelow && hideClass[c.hideBelow],
                        c.className,
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {showEmpty && empty && <EmptyState {...empty} />}
      {footer}
    </Card>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
  label = 'results',
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
  label?: string;
}) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm">
      <span className="text-muted-foreground">
        {total.toLocaleString()} {label}
      </span>
      <div className="flex items-center gap-2">
        <span className="hidden text-muted-foreground sm:inline">
          Page {page} of {totalPages}
        </span>
        <Button variant="outline" size="icon-sm" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon-sm" onClick={() => onPage(page + 1)} disabled={page >= totalPages} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/** Search box that reports its value after the user stops typing. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
  delay = 300,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  delay?: number;
}) {
  const [local, setLocal] = React.useState(value);
  React.useEffect(() => setLocal(value), [value]);
  React.useEffect(() => {
    if (local === value) return;
    const t = setTimeout(() => onChange(local), delay);
    return () => clearTimeout(t);
  }, [local, value, onChange, delay]);
  return (
    <div className={cn('relative w-full sm:w-72', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input value={local} onChange={(e) => setLocal(e.target.value)} placeholder={placeholder} className="pr-8 pl-8" aria-label={placeholder} />
      {local && (
        <button
          type="button"
          onClick={() => {
            setLocal('');
            onChange('');
          }}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center', className)}>{children}</div>;
}

/** Horizontal filter chips that scroll on small screens. */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-thin" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors',
            value === o.value ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-card text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
          {typeof o.count === 'number' && <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
