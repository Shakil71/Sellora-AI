import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Sellora AI mark: a flowing "S" (conversation → sale) inside a rounded tile,
 * with a small spark representing the AI assistant.
 */
export function LogoMark({ className, size = 32, title = 'Sellora AI' }: { className?: string; size?: number; title?: string }) {
  // A unique gradient id per instance: a hidden copy (display: none) would otherwise break every other one.
  const gradient = `sellora-tile-${React.useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={title} className={cn('shrink-0', className)}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#14b8a6" />
          <stop offset="1" stopColor="#0f5f5a" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gradient})`} />
      <path
        d="M21.2 10.6c-1.2-1.5-3.1-2.4-5.3-2.4-3.2 0-5.4 1.8-5.4 4.2 0 5.3 10.9 3.1 10.9 8.8 0 2.5-2.4 4.3-5.6 4.3-2.4 0-4.4-.9-5.7-2.5"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path d="M24.6 5.8l.55 1.35 1.35.55-1.35.55-.55 1.35-.55-1.35-1.35-.55 1.35-.55z" fill="#fff" opacity="0.95" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark size={28} />
      {!compact && (
        <span className="text-[15px] font-semibold tracking-tight">
          Sellora<span className="text-primary"> AI</span>
        </span>
      )}
    </span>
  );
}
