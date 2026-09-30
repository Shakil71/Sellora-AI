'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';

function Verify() {
  const token = useSearchParams().get('token');
  const [state, setState] = React.useState<'loading' | 'ok' | 'error'>(token ? 'loading' : 'error');
  const [message, setMessage] = React.useState('This verification link is incomplete.');
  const ran = React.useRef(false);

  React.useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    api
      .post('/auth/verify-email', { token })
      .then(() => setState('ok'))
      .catch((err) => {
        setMessage(errorMessage(err));
        setState('error');
      });
  }, [token]);

  return (
    <div className="space-y-5 text-center">
      {state === 'loading' && <Loader2 className="mx-auto size-10 animate-spin text-muted-foreground" />}
      {state === 'ok' && <CheckCircle2 className="mx-auto size-10 text-success" />}
      {state === 'error' && <XCircle className="mx-auto size-10 text-destructive" />}
      <h1 className="text-2xl font-semibold tracking-tight">
        {state === 'loading' ? 'Verifying your email…' : state === 'ok' ? 'Email verified' : 'Verification failed'}
      </h1>
      <p className="text-sm text-muted-foreground">{state === 'ok' ? 'Thanks! Your email address is confirmed.' : state === 'error' ? message : 'One moment.'}</p>
      {state !== 'loading' && (
        <Button asChild className="w-full" size="lg">
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <React.Suspense>
      <Verify />
    </React.Suspense>
  );
}
