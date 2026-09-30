'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/shared/page';
import { WhatsAppAccounts } from '@/features/whatsapp/accounts';
import { Button } from '@/components/ui/button';

export default function WhatsAppSettingsPage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Settings' }, { label: 'WhatsApp' }]}
        title="WhatsApp settings"
        description="Numbers, webhook credentials and which AI agent answers new conversations."
        actions={
          <Button variant="outline" asChild>
            <Link href="/whatsapp/templates">Message templates</Link>
          </Button>
        }
      />
      <WhatsAppAccounts />
    </>
  );
}
