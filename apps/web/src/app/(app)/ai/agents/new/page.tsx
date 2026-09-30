'use client';

import { PageHeader } from '@/components/shared/page';
import { AgentEditor } from '@/features/ai/agent-editor';

export default function NewAgentPage() {
  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'AI agents', href: '/ai/agents' }, { label: 'New' }]} title="New AI agent" description="Starts from the Sales Assistant template. Adjust anything before saving." />
      <AgentEditor />
    </>
  );
}
