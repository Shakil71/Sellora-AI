'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader, PageSkeleton } from '@/components/shared/page';
import { ApiGuide } from '@/features/integrations/api-guide';
import type { IntegrationsOverview } from '@/features/integrations/common';

export default function DeveloperApiPage() {
  const { data } = useQuery({
    queryKey: ['integrations', 'overview'],
    queryFn: () => api.get<IntegrationsOverview>('/integrations/overview'),
  });
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Integrations', href: '/integrations' }, { label: 'Developer API' }]}
        title="Developer API"
        description="Connect your website, mobile app, ERP or any other software to Sellora."
      />
      {data ? <ApiGuide baseUrl={data.apiBaseUrl} /> : <PageSkeleton />}
    </>
  );
}
