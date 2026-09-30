import {
  Camera,
  FlaskConical,
  Globe,
  MessageCircle,
  MessageSquareMore,
  type LucideIcon,
} from 'lucide-react';
import { CHANNEL_LABELS, type ChannelKey } from '@sellora/shared';
import { cn } from '@/lib/utils';

const STYLE: Record<ChannelKey, { icon: LucideIcon; className: string }> = {
  WHATSAPP: {
    icon: MessageCircle,
    className: 'bg-[#25d366]/12 text-[#128c4a] dark:text-[#4ade80]',
  },
  WEB_CHAT: { icon: Globe, className: 'bg-primary/10 text-primary' },
  MESSENGER: {
    icon: MessageSquareMore,
    className: 'bg-[#0866ff]/10 text-[#0866ff] dark:text-[#6ea8ff]',
  },
  INSTAGRAM: { icon: Camera, className: 'bg-[#e1306c]/10 text-[#c2185b] dark:text-[#f472b6]' },
  TEST: { icon: FlaskConical, className: 'bg-muted text-muted-foreground' },
};

export function channelLabel(channel: string) {
  return CHANNEL_LABELS[channel as ChannelKey] ?? channel;
}

/** Small pill showing where a conversation comes from. */
export function ChannelBadge({
  channel,
  compact,
  className,
}: {
  channel: string;
  compact?: boolean;
  className?: string;
}) {
  const s = STYLE[channel as ChannelKey] ?? STYLE.TEST;
  const Icon = s.icon;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
        s.className,
        compact && 'px-1',
        className,
      )}
      title={channelLabel(channel)}
    >
      <Icon className="size-3" aria-hidden />
      {compact ? <span className="sr-only">{channelLabel(channel)}</span> : channelLabel(channel)}
    </span>
  );
}
