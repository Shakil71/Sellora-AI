'use client';

import { PageHeader } from '@/components/shared/page';
import { PaymentMethodSettings } from '@/features/integrations/payment-methods';

export default function PaymentMethodsPage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Integrations', href: '/integrations' }, { label: 'Payments' }]}
        title="Payment methods"
        description="Choose how your customers pay. Connect an international or local gateway, or add manual methods such as bKash, UPI or bank transfer, per country and currency."
      />
      <PaymentMethodSettings />
    </>
  );
}
