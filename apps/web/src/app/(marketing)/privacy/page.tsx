import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy Policy', alternates: { canonical: '/privacy' } };

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-4 px-4 py-16 text-sm leading-relaxed sm:px-6 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="text-muted-foreground">
        This is a template provided with Sellora AI. The operator of this installation must review and adapt it to their business and local law before going live.
      </p>
      <h2>Data we process</h2>
      <p>Account details of workspace members, customer contact details and conversation content received through connected channels, catalog and order data, and technical logs needed to operate and secure the service.</p>
      <h2>How we use it</h2>
      <p>To provide the service: routing and answering conversations, generating AI replies through the configured AI provider, managing orders and producing analytics for the workspace that owns the data.</p>
      <h2>Sub-processors</h2>
      <p>Hosting, Meta (WhatsApp Cloud API), the configured AI provider, email delivery and payment providers, as configured by the operator.</p>
      <h2>Security</h2>
      <p>Workspace data is isolated, secrets are encrypted at rest, access is role-based and administrative actions are audited.</p>
      <h2>Your rights</h2>
      <p>Contact the operator of this installation to access, correct or delete your data.</p>
    </article>
  );
}
