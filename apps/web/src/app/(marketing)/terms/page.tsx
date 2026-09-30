import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terms of Service', alternates: { canonical: '/terms' } };

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-4 px-4 py-16 text-sm leading-relaxed sm:px-6 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold">
      <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
      <p className="text-muted-foreground">This is a template provided with Sellora AI. The operator of this installation must adapt it before going live.</p>
      <h2>Use of the service</h2>
      <p>You are responsible for the content you send to customers and for complying with the WhatsApp Business Policy and messaging laws in your countries of operation.</p>
      <h2>AI features</h2>
      <p>AI replies are generated automatically. Review your agent configuration, catalog and policies regularly; transfer sensitive matters to a human.</p>
      <h2>Plans and limits</h2>
      <p>Usage is limited by your plan. When a limit is reached, related actions are paused until the next period or an upgrade.</p>
      <h2>Liability</h2>
      <p>The service is provided as is, to the extent permitted by law.</p>
    </article>
  );
}
