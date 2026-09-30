'use client';

import { MessageSquareMore } from 'lucide-react';
import { PageHeader } from '@/components/shared/page';
import { MetaChannelSettings } from '@/features/integrations/meta-channels';

export default function MessengerPage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Integrations', href: '/integrations' }, { label: 'Messenger' }]}
        title="Facebook Messenger"
        description="Answer messages sent to your Facebook Page with your AI agent and team, from the same inbox."
      />
      <MetaChannelSettings type="MESSENGER" icon={MessageSquareMore} />
    </>
  );
}
