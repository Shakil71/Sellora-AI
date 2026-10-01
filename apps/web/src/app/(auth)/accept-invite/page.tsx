'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Users } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { Me } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/primitives';
import { Field } from '@/components/shared/form';

function Accept() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.post<{ email: string; workspace: string; role: string; accountExists: boolean }>('/auth/invitations/preview', { token }),
    enabled: Boolean(token),
    retry: false,
  });

  if (!token || preview.isError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Invitation unavailable</h1>
        <p className="text-sm text-muted-foreground">{preview.error ? errorMessage(preview.error) : 'This invitation link is incomplete.'}</p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }
  if (!preview.data) return <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" />;
  const inv = preview.data;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await api.post<Me>('/auth/invitations/accept', { token, password, ...(inv.accountExists ? {} : { name }) });
      qc.setQueryData(['me'], me);
      router.replace('/dashboard');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Users className="size-5" />
      </span>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Join {inv.workspace}</h1>
        <p className="text-sm text-muted-foreground">
          You&apos;ve been invited as <strong className="text-foreground">{inv.role}</strong> using {inv.email}.
        </p>
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}
      {!inv.accountExists && (
        <Field label="Full name" htmlFor="name">
          <Input id="name" required autoComplete="name" className="h-10" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      <Field
        label={inv.accountExists ? 'Your password' : 'Create a password'}
        htmlFor="password"
        hint={inv.accountExists ? 'Confirm with the password of your existing account.' : 'At least 10 characters with a letter and a number.'}
      >
        <Input id="password" type="password" required autoComplete={inv.accountExists ? 'current-password' : 'new-password'} className="h-10" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        Accept invitation
      </Button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <React.Suspense>
      <Accept />
    </React.Suspense>
  );
}
