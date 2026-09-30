'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, ChevronRight, Inbox, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge, Card, Skeleton } from '@/components/ui/primitives';
import { statusOf } from '@/lib/status';
import type { BadgeVariant } from '@/components/ui/primitives';

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  className?: string;
}) {
  return (
    <div className={cn('mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0 space-y-1">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-1.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {breadcrumbs.map((b, i) => (
              <span key={`${b.label}-${i}`} className="inline-flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3" aria-hidden />}
                {b.href ? (
                  <Link href={b.href} className="hover:text-foreground">
                    {b.label}
                  </Link>
                ) : (
                  <span aria-current="page">{b.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 text-center', compact ? 'py-8' : 'py-14', className)}>
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl border bg-muted/50 text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  change,
  hint,
  icon: Icon,
  loading,
  href,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  change?: number | null;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  loading?: boolean;
  href?: string;
  tone?: 'default' | 'ai' | 'warning';
}) {
  const body = (
    <Card className={cn('h-full p-4 transition-colors sm:p-5', href && 'hover:border-primary/40')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        {Icon && (
          <span
            className={cn(
              'flex size-7 items-center justify-center rounded-md',
              tone === 'ai' ? 'bg-ai-soft text-ai' : tone === 'warning' ? 'bg-warning/15 text-warning' : 'bg-primary/10 text-primary',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-24" />
      ) : (
        <div className="mt-2 text-2xl font-semibold tracking-tight tabular">{value}</div>
      )}
      <div className="mt-1 flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground">
        {typeof change === 'number' && !loading && (
          <span className={cn('inline-flex items-center gap-0.5 font-medium', change >= 0 ? 'text-success' : 'text-destructive')}>
            {change >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {Math.abs(change)}%
          </span>
        )}
        {hint}
      </div>
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}

export function StatusBadge({ map, value, className }: { map: Record<string, { label: string; variant: BadgeVariant }>; value?: string | null; className?: string }) {
  const s = statusOf(map, value);
  return (
    <Badge variant={s.variant} className={className}>
      {s.label}
    </Badge>
  );
}

export function Section({ title, description, actions, children, className }: { title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('grid gap-4 border-b py-6 first:pt-0 last:border-0 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)] md:gap-8', className)}>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        {actions && <div className="mt-3">{actions}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words">{children ?? '—'}</dd>
    </div>
  );
}

export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="space-y-2 rounded-xl border p-4">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <Card className="border-destructive/30">
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm font-medium">We couldn&apos;t load this data</p>
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
        {onRetry && (
          <button onClick={onRetry} className="text-sm font-medium text-primary hover:underline">
            Try again
          </button>
        )}
      </div>
    </Card>
  );
}
