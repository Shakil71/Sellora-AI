import Image from 'next/image';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ShotName = 'dashboard' | 'inbox' | 'orders' | 'pipeline' | 'workflow' | 'analytics';

/**
 * A real Sellora AI screenshot (demo workspace "Acme Commerce") that follows
 * the visitor's theme: the light capture in light mode, the dark one in dark.
 */
export function ThemedShot({
  name,
  alt,
  width = 1920,
  height = 1200,
  priority,
  sizes = '(min-width: 1280px) 1152px, 100vw',
  className,
}: {
  name: ShotName | 'mobile-inbox';
  alt: string;
  width?: number;
  height?: number;
  priority?: boolean;
  sizes?: string;
  className?: string;
}) {
  return (
    <>
      <Image
        src={`/marketing/${name}-light.webp`}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        sizes={sizes}
        className={cn('block h-auto w-full dark:hidden', className)}
      />
      <Image
        src={`/marketing/${name}-dark.webp`}
        alt=""
        aria-hidden
        width={width}
        height={height}
        priority={priority}
        sizes={sizes}
        className={cn('hidden h-auto w-full dark:block', className)}
      />
    </>
  );
}

/** Desktop browser chrome around a screenshot. */
export function BrowserFrame({
  children,
  url = 'your-domain.com',
  className,
}: {
  children: React.ReactNode;
  url?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-card shadow-[0_30px_80px_-30px_rgb(0_0_0/0.35)] ring-1 ring-black/5 dark:ring-white/5',
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b bg-muted/60 px-3 py-2 sm:px-4 sm:py-2.5">
        <div className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="mx-auto flex max-w-xs min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border bg-background/80 px-3 py-1 text-[11px] text-muted-foreground">
          <Lock className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{url}</span>
        </div>
        <div className="w-10 sm:w-12" aria-hidden />
      </div>
      {children}
    </div>
  );
}

/** Modern phone bezel around a mobile screenshot. */
export function PhoneFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative rounded-[2.6rem] border border-black/10 bg-neutral-900 p-2 shadow-[0_40px_80px_-24px_rgb(0_0_0/0.5)] dark:border-white/10',
        className,
      )}
    >
      <div className="relative overflow-hidden rounded-[2.1rem] bg-background">
        <span
          className="absolute top-2 left-1/2 z-10 h-5 w-20 -translate-x-1/2 rounded-full bg-neutral-900"
          aria-hidden
        />
        {children}
      </div>
    </div>
  );
}
