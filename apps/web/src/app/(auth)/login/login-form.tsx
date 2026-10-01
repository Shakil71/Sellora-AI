'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import type { Me } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/primitives';
import { Field } from '@/components/shared/form';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);
  const [challenge, setChallenge] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  const finish = (me: Me) => {
    qc.setQueryData(['me'], me);
    router.replace(me.workspace ? safeNext(params.get('next')) : '/onboarding?create=1');
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api.post<{ twoFactorRequired: boolean; challengeToken?: string } & Partial<Me>>('/auth/login', values);
      if (res.twoFactorRequired && res.challengeToken) {
        setChallenge(res.challengeToken);
        return;
      }
      finish(res as Me);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  const onVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      finish(await api.post<Me>('/auth/login/2fa', { challengeToken: challenge, code }));
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.status === 401 && err.code !== 'INVALID_2FA_CODE') setChallenge(null);
    } finally {
      setBusy(false);
    }
  };

  if (challenge) {
    return (
      <form onSubmit={onVerify} className="space-y-6">
        <div className="space-y-2">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Two-factor verification</h1>
          <p className="text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app.</p>
        </div>
        <Field label="Verification code" htmlFor="code" error={error ?? undefined}>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="h-11 text-center text-lg tracking-[0.5em] tabular"
          />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={busy} disabled={code.length !== 6}>
          Verify and sign in
        </Button>
        <button type="button" onClick={() => setChallenge(null)} className="w-full text-sm text-muted-foreground hover:text-foreground">
          Use a different account
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ai-soft px-2.5 py-1 text-xs font-medium text-ai">
          <Sparkles className="size-3" aria-hidden /> Your AI agent is waiting
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Sign in to see today&apos;s chats, orders and sales.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-sm text-destructive">
            {error}
          </div>
        )}
        <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
          <div className="relative">
            <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="email" type="email" autoComplete="email" autoFocus placeholder="you@company.com" className="h-11 pl-9" aria-invalid={!!form.formState.errors.email} {...form.register('email')} />
          </div>
        </Field>
        <Field
          label={
            <span className="flex w-full items-center justify-between">
              Password
              <Link href="/forgot-password" className="text-xs font-normal text-primary hover:underline">
                Forgot password?
              </Link>
            </span>
          }
          htmlFor="password"
          error={form.formState.errors.password?.message}
        >
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Your password"
              className="h-11 pr-10 pl-9"
              aria-invalid={!!form.formState.errors.password}
              {...form.register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
          Sign in <ArrowRight />
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        New to Sellora AI?{' '}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
