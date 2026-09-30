'use client';

import * as React from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { Table2, LineChart as LineIcon } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { EmptyState } from './page';
import { cn } from '@/lib/utils';

/**
 * Chart conventions (validated palette, see globals.css):
 * - Max 3 categorical series (chart-1 teal, chart-2 violet, chart-3 orange).
 * - One y-axis, recessive grid, 2px lines, crosshair tooltip.
 * - Legend for 2+ series; every chart offers a table view.
 */
export interface SeriesDef {
  key: string;
  label: string;
  color?: 'chart-1' | 'chart-2' | 'chart-3';
  format?: (v: number) => string;
}

const COLORS = ['chart-1', 'chart-2', 'chart-3'] as const;

function tickDate(value: string) {
  if (/^\d{4}-\d{2}$/.test(value)) return format(new Date(`${value}-01T00:00:00`), 'MMM');
  return format(new Date(`${value}T00:00:00`), 'MMM d');
}

function ChartTooltip({ active, payload, label, series }: { active?: boolean; payload?: Array<{ dataKey: string; value: number }>; label?: string; series: SeriesDef[] }) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="min-w-36 rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-medium">{/^\d{4}-\d{2}$/.test(label) ? format(new Date(`${label}-01T00:00:00`), 'MMMM yyyy') : format(new Date(`${label}T00:00:00`), 'EEE, MMM d')}</p>
      {series.map((s, i) => {
        const p = payload.find((x) => x.dataKey === s.key);
        return (
          <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-full" style={{ background: `var(--${s.color ?? COLORS[i]})` }} />
              {s.label}
            </span>
            <span className="font-medium tabular">{s.format ? s.format(Number(p?.value ?? 0)) : Number(p?.value ?? 0).toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}

function Legend({ series }: { series: SeriesDef[] }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {series.map((s, i) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full" style={{ background: `var(--${s.color ?? COLORS[i]})` }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function DataTableView({ data, series, xLabel }: { data: Array<Record<string, number | string>>; series: SeriesDef[]; xLabel: string }) {
  return (
    <div className="max-h-72 overflow-auto scrollbar-thin">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
          <tr>
            <th className="py-2 text-left font-medium">{xLabel}</th>
            {series.map((s) => (
              <th key={s.key} className="py-2 text-right font-medium">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.map((row) => (
            <tr key={String(row.date ?? row.label)}>
              <td className="py-1.5">{row.date ? tickDate(String(row.date)) : String(row.label)}</td>
              {series.map((s) => (
                <td key={s.key} className="py-1.5 text-right tabular">
                  {s.format ? s.format(Number(row[s.key] ?? 0)) : Number(row[s.key] ?? 0).toLocaleString()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TimeSeriesCard({
  title,
  description,
  data,
  series,
  loading,
  height = 260,
  stacked = false,
  className,
  emptyText = 'No data for this period yet.',
}: {
  title: string;
  description?: string;
  data: Array<Record<string, number | string>> | undefined;
  series: SeriesDef[];
  loading?: boolean;
  height?: number;
  stacked?: boolean;
  className?: string;
  emptyText?: string;
}) {
  const [asTable, setAsTable] = React.useState(false);
  const id = React.useId().replace(/:/g, '');
  const hasData = (data ?? []).some((d) => series.some((s) => Number(d[s.key] ?? 0) !== 0));
  const yFormat = series[0]?.format;
  return (
    <Card className={cn('min-w-0', className)}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription className="mt-1">{description}</CardDescription>}
        </div>
        <CardAction>
          <Legend series={series} />
          <Button variant="ghost" size="icon-sm" onClick={() => setAsTable((v) => !v)} aria-label={asTable ? 'Show chart' : 'Show as table'} aria-pressed={asTable}>
            {asTable ? <LineIcon /> : <Table2 />}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="pt-3">
        {loading ? (
          <Skeleton className="w-full" style={{ height }} />
        ) : !hasData ? (
          <div style={{ height }} className="flex items-center justify-center">
            <EmptyState compact title="Nothing to show yet" description={emptyText} />
          </div>
        ) : asTable ? (
          <DataTableView data={data!} series={series} xLabel="Date" />
        ) : (
          <div style={{ height }} role="img" aria-label={`${title} chart`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  {series.map((s, i) => (
                    <linearGradient key={s.key} id={`${id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={`var(--${s.color ?? COLORS[i]})`} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={`var(--${s.color ?? COLORS[i]})`} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="date" tickFormatter={tickDate} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} minTickGap={24} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickFormatter={(v: number) => (yFormat ? yFormat(v) : new Intl.NumberFormat('en-US', { notation: 'compact' }).format(v))}
                  allowDecimals={false}
                />
                <RTooltip cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3', strokeWidth: 1 }} content={<ChartTooltip series={series} />} />
                {series.map((s, i) => (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    stackId={stacked ? 'a' : undefined}
                    stroke={`var(--${s.color ?? COLORS[i]})`}
                    strokeWidth={2}
                    fill={`url(#${id}-${s.key})`}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Single-series vertical bars (e.g. orders per day). */
export function BarSeriesCard({
  title,
  description,
  data,
  dataKey,
  label,
  valueFormat,
  loading,
  height = 240,
}: {
  title: string;
  description?: string;
  data: Array<Record<string, number | string>> | undefined;
  dataKey: string;
  label: string;
  valueFormat?: (v: number) => string;
  loading?: boolean;
  height?: number;
}) {
  const series: SeriesDef[] = [{ key: dataKey, label, format: valueFormat }];
  const hasData = (data ?? []).some((d) => Number(d[dataKey] ?? 0) !== 0);
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription className="mt-1">{description}</CardDescription>}
        </div>
      </CardHeader>
      <CardContent className="pt-3">
        {loading ? (
          <Skeleton className="w-full" style={{ height }} />
        ) : !hasData ? (
          <div style={{ height }} className="flex items-center justify-center">
            <EmptyState compact title="Nothing to show yet" />
          </div>
        ) : (
          <div style={{ height }} role="img" aria-label={`${title} chart`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="date" tickFormatter={tickDate} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                <RTooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={<ChartTooltip series={series} />} />
                <Bar dataKey={dataKey} fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Ranked horizontal bars with the value as text (top products, sources, stages). */
export function BarList({
  items,
  valueFormat = (v) => v.toLocaleString(),
  loading,
  empty = 'No data yet',
}: {
  items: Array<{ label: string; value: number; secondary?: string; href?: string }>;
  valueFormat?: (v: number) => string;
  loading?: boolean;
  empty?: string;
}) {
  if (loading) return <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7" />)}</div>;
  if (!items.length) return <EmptyState compact title={empty} />;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label} className="group">
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="truncate">{item.label}</span>
            <span className="shrink-0 font-medium tabular">
              {valueFormat(item.value)}
              {item.secondary && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{item.secondary}</span>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-chart-1 transition-all" style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
