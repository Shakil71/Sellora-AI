'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorMessage } from '@/lib/api';
import type { Me } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/primitives';
import { Field } from '@/components/shared/form';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your full name'),
  workspaceName: z.string().trim().min(2, 'Enter your business name'),
  email: z.string().trim().email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Za-z]/, 'Include a letter')
    .regex(/\d/, 'Include a number'),
});
type Values = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: '', workspaceName: '', email: '', password: '' } });
  const { errors } = form.formState;
  const password = form.watch('password');
  const strength = [password.length >= 8, /[A-Za-z]/.test(password), /\d/.test(password), password.length >= 12 || /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const me = await api.post<Me>('/auth/register', values);
      qc.setQueryData(['me'], me);
      router.replace('/onboarding');
    } catch (err) {
      if (err instanceof ApiError) {
        for (const [path, msg] of Object.entries(err.fieldErrors)) form.setError(path as keyof Values, { message: msg });
      }
      setError(errorMessage(err));
    }
  });

  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
        <p className="text-sm text-muted-foreground">Start selling smarter on WhatsApp in a few minutes.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-sm text-destructive">
            {error}
          </div>
        )}
        <Field label="Full name" htmlFor="name" error={errors.name?.message}>
          <Input id="name" autoComplete="name" autoFocus className="h-10" aria-invalid={!!errors.name} {...form.register('name')} />
        </Field>
        <Field label="Business name" htmlFor="workspaceName" error={errors.workspaceName?.message}>
          <Input id="workspaceName" autoComplete="organization" className="h-10" aria-invalid={!!errors.workspaceName} {...form.register('workspaceName')} />
        </Field>
        <Field label="Work email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" className="h-10" aria-invalid={!!errors.email} {...form.register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message} hint="At least 8 characters with a letter and a number.">
          <Input id="password" type="password" autoComplete="new-password" className="h-10" aria-invalid={!!errors.password} {...form.register('password')} />
          <div className="flex gap-1" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${i < strength ? (strength >= 3 ? 'bg-success' : 'bg-warning') : 'bg-muted'}`} />
            ))}
          </div>
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
          Create account
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          By creating an account you agree to the{' '}
          <Link href="/terms" className="underline hover:text-foreground">
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
