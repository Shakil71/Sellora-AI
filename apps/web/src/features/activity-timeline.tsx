import { relative, dateTime } from '@/lib/format';

export function ActivityTimeline({ items }: { items: Array<{ id: string; description: string; actorName: string | null; createdAt: string; type?: string }> }) {
  return (
    <ol className="relative space-y-4 border-l pl-5">
      {items.map((a) => (
        <li key={a.id} className="relative">
          <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-card bg-primary" aria-hidden />
          <p className="text-sm">{a.description}</p>
          <p className="text-xs text-muted-foreground">
            {a.actorName ? `${a.actorName} · ` : ''}
            <time dateTime={a.createdAt} title={dateTime(a.createdAt)}>
              {relative(a.createdAt)}
            </time>
          </p>
        </li>
      ))}
    </ol>
  );
}
