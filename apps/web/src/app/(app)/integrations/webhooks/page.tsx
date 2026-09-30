'use client';

import { PageHeader } from '@/components/shared/page';
import { WebhookSettings } from '@/features/integrations/webhooks';

export default function WebhooksPage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Integrations', href: '/integrations' }, { label: 'Webhooks' }]}
        title="Webhooks"
        description="Send real-time, signed notifications to your website, ERP or any other system when things happen in Sellora."
      />
      <WebhookSettings />
    </>
  );
}
