import Link from 'next/link';
import { Lock } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { AuthShowcase } from '@/components/auth/auth-showcase';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden lg:block">
        <Link href="/" className="absolute top-8 left-10 z-30 xl:left-12" aria-label="Sellora AI home">
          <Logo className="[&_span]:text-white" />
        </Link>
        <AuthShowcase />
      </aside>
      <main className="relative flex flex-col overflow-hidden px-4 py-8 sm:px-10">
        <div className="pointer-events-none absolute -top-40 -right-40 size-[420px] rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 -left-32 size-[380px] rounded-full bg-ai/10 blur-3xl" aria-hidden />
        <div className="relative lg:hidden">
          <Link href="/">
            <Logo />
          </Link>
        </div>
        <div className="relative mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-10">
          <div className="rounded-2xl border bg-card/80 p-6 shadow-xl shadow-primary/5 backdrop-blur sm:p-8" style={{ animation: 'auth-rise 0.6s ease-out both' }}>
            {children}
          </div>
          <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3" aria-hidden /> Encrypted connection · Your data stays private
          </p>
        </div>
      </main>
    </div>
  );
}
