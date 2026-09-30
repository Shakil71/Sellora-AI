'use client';

import * as React from 'react';
import { FilterChips } from '@/components/shared/data-table';

export type Range = '7d' | '30d' | '90d' | '12m';

export function useRange() {
  return React.useState<Range>('30d');
}

export function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <FilterChips
      value={value}
      onChange={onChange}
      options={[
        { value: '7d', label: '7 days' },
        { value: '30d', label: '30 days' },
        { value: '90d', label: '90 days' },
        { value: '12m', label: '12 months' },
      ]}
    />
  );
}
