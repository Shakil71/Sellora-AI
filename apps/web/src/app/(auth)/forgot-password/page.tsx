'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/primitives';
import { Field } from '@/components/shared/form';

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState('');
  const [state, setState] = React.useState<'idle' | 'busy' | 'sent'>('idle');
  const [emailConfigured, setEmailConfigured] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setState('busy');
    try {
      const res = await api.post<{ sent: boolean; emailConfigured: boolean }>('/auth/forgot-password', { email });
      setEmailConfigured(res.emailConfigured);
      setState('sent');
    } catch (err) {
      setError(errorMessage(err));
      setState('idle');
    }
  };

  if (state === 'sent') {
    return (
      <div className="space-y-6">
        <span className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <MailCheck className="size-5" />
        </span>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            If an account exists for <strong className="text-foreground">{email}</strong>, we sent a link to reset your password. It expires in one hour.
          </p>
          {!emailConfigured && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              Email delivery is not configured on this server. Ask your administrator to configure SMTP or reset your password for you.
            </p>
          )}
        </div>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">
            <ArrowLeft /> Back to sign in
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">Enter your email and we&apos;ll send you a reset link.</p>
      </div>
      <Field label="Email" htmlFor="email" error={error ?? undefined}>
        <Input id="email" type="email" required autoFocus autoComplete="email" className="h-10" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={state === 'busy'}>
        Send reset link
      </Button>
      <Link href="/login" className="flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Back to sign in
      </Link>
    </form>
  );
}
