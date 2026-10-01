import type { Metadata } from 'next';
import { CheckCircle2, XCircle } from 'lucide-react';

export const metadata: Metadata = { title: 'Payment', robots: { index: false } };

/**
 * Where customers land after the payment page of a gateway. It only reflects
 * what the customer did; the business is notified by the gateway separately.
 */
export default async function PaymentCompletePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const ok = status !== 'cancelled' && status !== 'failed';
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 text-center shadow-sm">
        <Icon className={`mx-auto size-12 ${ok ? 'text-success' : 'text-destructive'}`} aria-hidden />
        <h1 className="mt-4 text-xl font-semibold">{ok ? 'Thank you!' : status === 'failed' ? 'Payment failed' : 'Payment cancelled'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {ok
            ? 'Your payment is being confirmed. The business will update your order shortly, so you can close this page.'
            : 'No money was taken. Go back to your chat with the business to try again or choose another way to pay.'}
        </p>
      </div>
    </main>
  );
}
