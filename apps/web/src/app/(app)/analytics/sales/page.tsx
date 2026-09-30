'use client';

import { useQuery } from '@tanstack/react-query';
import { DollarSign, Receipt, ShoppingCart, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { money, number } from '@/lib/format';
import { ORDER_SOURCE, ORDER_STATUS, PAYMENT_STATUS } from '@/lib/status';
import { useSession } from '@/components/session';
import { PageHeader, StatCard, ErrorState } from '@/components/shared/page';
import { BarList, BarSeriesCard, TimeSeriesCard } from '@/components/shared/charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { RangePicker, useRange } from '@/features/analytics/range';

interface SalesAnalytics {
  summary: { revenue: number; revenueChange: number; orders: number; ordersChange: number; averageOrderValue: number; paidRevenue: number };
  series: Array<{ date: string; revenue: number; orders: number }>;
  byStatus: Array<{ status: string; orders: number; revenue: number }>;
  bySource: Array<{ source: string; orders: number; revenue: number }>;
  byPaymentStatus: Array<{ status: string; orders: number; revenue: number }>;
  topProducts: Array<{ productId: string | null; name: string; units: number; revenue: number }>;
}

export default function SalesAnalyticsPage() {
  const { currency } = useSession();
  const [range, setRange] = useRange();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['analytics', 'sales', range], queryFn: () => api.get<SalesAnalytics>('/analytics/sales', { range }) });
  const m = (v: number) => money(v, currency, { compact: true });
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  return (
    <>
      <PageHeader title="Sales analytics" description="Revenue and orders excluding cancelled and refunded orders." actions={<RangePicker value={range} onChange={setRange} />} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Revenue" icon={DollarSign} loading={isLoading} value={m(data?.summary.revenue ?? 0)} change={data?.summary.revenueChange} hint="vs previous period" />
        <StatCard label="Orders" icon={ShoppingCart} loading={isLoading} value={number(data?.summary.orders)} change={data?.summary.ordersChange} />
        <StatCard label="Average order value" icon={Receipt} loading={isLoading} value={m(data?.summary.averageOrderValue ?? 0)} />
        <StatCard label="Paid revenue" icon={Wallet} loading={isLoading} value={m(data?.summary.paidRevenue ?? 0)} />
      </div>
      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <TimeSeriesCard title="Revenue" loading={isLoading} data={data?.series} series={[{ key: 'revenue', label: 'Revenue', format: m }]} />
        <BarSeriesCard title="Orders" loading={isLoading} data={data?.series} dataKey="orders" label="Orders" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Top products</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <BarList loading={isLoading} items={(data?.topProducts ?? []).map((p) => ({ label: p.name, value: p.revenue, secondary: `${p.units} sold` }))} valueFormat={m} empty="No product sales in this period" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Revenue by channel</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <BarList loading={isLoading} items={(data?.bySource ?? []).map((s) => ({ label: ORDER_SOURCE[s.source] ?? s.source, value: s.revenue, secondary: `${s.orders} orders` }))} valueFormat={m} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Orders by status</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <BarList loading={isLoading} items={(data?.byStatus ?? []).map((s) => ({ label: ORDER_STATUS[s.status]?.label ?? s.status, value: s.orders }))} />
            <p className="mt-4 mb-2 text-xs font-medium text-muted-foreground">Payment</p>
            <BarList loading={isLoading} items={(data?.byPaymentStatus ?? []).map((s) => ({ label: PAYMENT_STATUS[s.status]?.label ?? s.status, value: s.orders }))} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
