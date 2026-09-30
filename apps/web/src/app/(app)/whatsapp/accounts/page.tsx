'use client';

import { PageHeader } from '@/components/shared/page';
import { WhatsAppAccounts } from '@/features/whatsapp/accounts';

export default function WhatsAppAccountsPage() {
  return (
    <>
      <PageHeader title="WhatsApp accounts" description="Connect your WhatsApp Business numbers through the official Meta Cloud API." />
      <WhatsAppAccounts />
    </>
  );
}
