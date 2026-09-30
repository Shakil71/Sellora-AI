'use client';

import { PageHeader } from '@/components/shared/page';
import { WebsiteChatSettings } from '@/features/integrations/website-chat';

export default function WebsiteChatPage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Integrations', href: '/integrations' }, { label: 'Website chat' }]}
        title="Website chat"
        description="Add a chat bubble to your website. Visitors talk to your AI agent and your team, and every chat lands in the inbox."
      />
      <WebsiteChatSettings />
    </>
  );
}
