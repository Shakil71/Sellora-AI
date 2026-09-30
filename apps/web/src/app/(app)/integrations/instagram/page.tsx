'use client';

import { Camera } from 'lucide-react';
import { PageHeader } from '@/components/shared/page';
import { MetaChannelSettings } from '@/features/integrations/meta-channels';

export default function InstagramPage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Integrations', href: '/integrations' }, { label: 'Instagram' }]}
        title="Instagram"
        description="Reply to Instagram Direct messages with your AI agent and team. Requires an Instagram professional account linked to a Facebook Page."
      />
      <MetaChannelSettings type="INSTAGRAM" icon={Camera} />
    </>
  );
}
