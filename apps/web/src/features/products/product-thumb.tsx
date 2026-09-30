import { ImageIcon } from 'lucide-react';

export function ProductThumb({ src, name, size = 40 }: { src?: string; name: string; size?: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={name} width={size} height={size} className="shrink-0 rounded-md border object-cover" style={{ width: size, height: size }} loading="lazy" />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground" style={{ width: size, height: size }} aria-hidden>
      <ImageIcon className="size-4" />
    </span>
  );
}
