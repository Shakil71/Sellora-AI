'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Globe, MoreVertical, Palette, Plus, Power, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_WEB_CHAT_SETTINGS, type WebChatSettings } from '@sellora/shared';
import { api } from '@/lib/api';
import { CHANNEL_CONNECTION_STATUS } from '@/lib/status';
import { useSession } from '@/components/session';
import { useConfirm } from '@/components/shared/confirm';
import { EmptyState, StatusBadge } from '@/components/shared/page';
import { Field, FormGrid, TagInput } from '@/components/shared/form';
import { AgentSelect } from '@/components/shared/pickers';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@/components/ui/primitives';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { CodeBlock, Steps, type ChannelConnection } from './common';

const PRESET_COLORS = ['#0f766e', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#111827'];

function settingsOf(c?: ChannelConnection | null): WebChatSettings {
  return { ...DEFAULT_WEB_CHAT_SETTINGS, ...((c?.settings ?? {}) as Partial<WebChatSettings>) };
}

function CustomizeDialog({
  open,
  onOpenChange,
  connection,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  connection?: ChannelConnection | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = React.useState('');
  const [agentId, setAgentId] = React.useState<string | null>(null);
  const [s, setS] = React.useState<WebChatSettings>(DEFAULT_WEB_CHAT_SETTINGS);
  React.useEffect(() => {
    if (!open) return;
    setName(connection?.name ?? 'Website chat');
    setAgentId(connection?.defaultAgentId ?? null);
    setS(settingsOf(connection));
  }, [open, connection]);
  const save = useMutation({
    mutationFn: () =>
      connection
        ? api.patch<ChannelConnection>(`/integrations/channels/${connection.id}`, {
            name,
            defaultAgentId: agentId,
            settings: s,
          })
        : api.post<ChannelConnection>('/integrations/channels/web-chat', {
            name,
            defaultAgentId: agentId,
            settings: s,
          }),
    onSuccess: () => {
      toast.success(
        connection ? 'Website chat updated' : 'Website chat created — add the code to your website',
      );
      qc.invalidateQueries({ queryKey: ['integrations'] });
      onOpenChange(false);
    },
  });
  const validColor = /^#[0-9a-fA-F]{6}$/.test(s.color);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{connection ? 'Customize website chat' : 'Add website chat'}</DialogTitle>
          <DialogDescription>
            Visitors chat with your AI agent and your team from any page of your website. Messages
            arrive in your inbox.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <FormGrid>
            <Field label="Name (internal)" htmlFor="wc-name" required>
              <Input
                id="wc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Main website"
              />
            </Field>
            <Field
              label="AI agent"
              htmlFor="wc-agent"
              hint="Without an agent, chats go straight to your team."
            >
              <AgentSelect id="wc-agent" value={agentId} onChange={setAgentId} />
            </Field>
          </FormGrid>
          <FormGrid>
            <Field label="Chat title" htmlFor="wc-title">
              <Input
                id="wc-title"
                maxLength={60}
                value={s.title}
                onChange={(e) => setS({ ...s, title: e.target.value })}
              />
            </Field>
            <Field
              label="Brand colour"
              htmlFor="wc-color"
              error={validColor ? undefined : 'Use a hex colour such as #0f766e'}
            >
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Pick colour"
                  value={validColor ? s.color : '#0f766e'}
                  onChange={(e) => setS({ ...s, color: e.target.value })}
                  className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
                />
                <Input
                  id="wc-color"
                  value={s.color}
                  onChange={(e) => setS({ ...s, color: e.target.value.trim() })}
                  className="font-mono"
                />
              </div>
              <div className="mt-1 flex gap-1.5">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Use ${c}`}
                    onClick={() => setS({ ...s, color: c })}
                    className="size-5 rounded-full ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    style={{
                      background: c,
                      boxShadow:
                        s.color === c ? `0 0 0 2px var(--background), 0 0 0 4px ${c}` : undefined,
                    }}
                  />
                ))}
              </div>
            </Field>
          </FormGrid>
          <Field label="Greeting" htmlFor="wc-greet" hint="The first message visitors see.">
            <Textarea
              id="wc-greet"
              rows={2}
              maxLength={300}
              value={s.greeting}
              onChange={(e) => setS({ ...s, greeting: e.target.value })}
            />
          </Field>
          <Field label="Position">
            <RadioGroup
              value={s.position}
              onValueChange={(v) => setS({ ...s, position: v as 'left' | 'right' })}
              className="flex gap-6"
            >
              {(['right', 'left'] as const).map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value={p} /> Bottom {p}
                </label>
              ))}
            </RadioGroup>
          </Field>
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label htmlFor="wc-contact">Ask for contact details first</Label>
              <p className="text-xs text-muted-foreground">
                Visitors enter their name and email or phone before chatting, so you can follow up.
              </p>
            </div>
            <Switch
              id="wc-contact"
              checked={s.askForContact}
              onCheckedChange={(v) => setS({ ...s, askForContact: v })}
            />
          </div>
          <Field
            label="Allowed websites"
            htmlFor="wc-domains"
            hint="Leave empty to allow any website. Add domains such as shop.example.com, or *.example.com for all subdomains."
          >
            <TagInput
              id="wc-domains"
              value={s.allowedDomains}
              onChange={(v) => setS({ ...s, allowedDomains: v })}
              placeholder="example.com and press Enter"
              max={20}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={name.trim().length < 2 || !validColor || !s.title.trim()}
          >
            {connection ? 'Save changes' : 'Create website chat'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewDialog({
  connection,
  onOpenChange,
}: {
  connection: ChannelConnection | null;
  onOpenChange: (o: boolean) => void;
}) {
  const s = settingsOf(connection);
  const origin = s.allowedDomains[0] ? `https://${s.allowedDomains[0].replace(/^\*\./, '')}` : '';
  return (
    <Dialog open={Boolean(connection)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px] p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>Live preview</DialogTitle>
          <DialogDescription>
            This is the real chat. Messages you send here appear in your inbox as a website visitor.
          </DialogDescription>
        </DialogHeader>
        {connection && (
          <iframe
            title="Website chat preview"
            src={`/widget/${connection.externalId}?preview=1${origin ? `&origin=${encodeURIComponent(origin)}` : ''}`}
            className="mx-auto mb-4 block h-[600px] max-h-[70vh] w-full max-w-[420px] rounded-xl bg-muted/40"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function InstallGuide({ embed }: { embed: string }) {
  return (
    <Tabs defaultValue="html">
      <TabsList className="flex-wrap">
        <TabsTrigger value="html">Any website</TabsTrigger>
        <TabsTrigger value="wordpress">WordPress</TabsTrigger>
        <TabsTrigger value="shopify">Shopify</TabsTrigger>
        <TabsTrigger value="builders">Wix · Squarespace · Webflow</TabsTrigger>
        <TabsTrigger value="gtm">Google Tag Manager</TabsTrigger>
      </TabsList>
      <TabsContent value="html" className="space-y-3 pt-3">
        <p className="text-sm text-muted-foreground">
          Paste this line just before the closing{' '}
          <code className="rounded bg-muted px-1">&lt;/body&gt;</code> tag on every page (or in your
          site template).
        </p>
        <CodeBlock code={embed} label="Embed code" />
      </TabsContent>
      <TabsContent value="wordpress" className="pt-3">
        <Steps
          items={[
            'Install a header/footer code plugin such as “WPCode” (or edit your theme’s footer.php).',
            'Add a new footer snippet and paste the embed code below.',
            'Save and open your website: the chat bubble appears in the corner.',
          ]}
        />
        <CodeBlock code={embed} className="mt-3" />
      </TabsContent>
      <TabsContent value="shopify" className="pt-3">
        <Steps
          items={[
            'In Shopify admin open Online Store → Themes → ⋯ → Edit code.',
            <>
              Open <code className="rounded bg-muted px-1">layout/theme.liquid</code> and paste the
              code just before <code className="rounded bg-muted px-1">&lt;/body&gt;</code>.
            </>,
            'Save. The chat appears on every store page.',
          ]}
        />
        <CodeBlock code={embed} className="mt-3" />
      </TabsContent>
      <TabsContent value="builders" className="pt-3">
        <Steps
          items={[
            'Wix: Settings → Custom code → Add code, place in “Body - end”, apply to all pages.',
            'Squarespace: Settings → Advanced → Code injection → Footer.',
            'Webflow: Project settings → Custom code → Footer code, then publish.',
          ]}
        />
        <CodeBlock code={embed} className="mt-3" />
      </TabsContent>
      <TabsContent value="gtm" className="pt-3">
        <Steps
          items={[
            'Create a new tag of type “Custom HTML”.',
            'Paste the embed code and trigger it on “All Pages”.',
            'Submit and publish the container.',
          ]}
        />
        <CodeBlock code={embed} className="mt-3" />
      </TabsContent>
    </Tabs>
  );
}

export function WebsiteChatSettings() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const manage = can('integrations.manage');
  const { data, isLoading } = useQuery({
    queryKey: ['integrations', 'channels', 'WEB_CHAT'],
    queryFn: () => api.get<ChannelConnection[]>('/integrations/channels', { type: 'WEB_CHAT' }),
  });
  const [dialog, setDialog] = React.useState<{
    open: boolean;
    connection?: ChannelConnection | null;
  }>({ open: false });
  const [preview, setPreview] = React.useState<ChannelConnection | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['integrations'] });
  const toggle = useMutation({
    mutationFn: (c: ChannelConnection) =>
      api.patch(`/integrations/channels/${c.id}`, { enabled: c.status === 'DISABLED' }),
    onSuccess: () => invalidate(),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/integrations/channels/${id}`),
    onSuccess: () => {
      toast.success('Website chat removed');
      invalidate();
    },
  });

  if (isLoading) return <Skeleton className="h-72 rounded-xl" />;

  return (
    <div className="space-y-4">
      {manage && data && data.length > 0 && (
        <Button onClick={() => setDialog({ open: true })}>
          <Plus /> Add another website
        </Button>
      )}
      {!data?.length ? (
        <Card>
          <EmptyState
            icon={Globe}
            title="Add live chat to your website"
            description="Visitors ask questions and place orders from any page. Your AI agent answers instantly and your team can take over from the inbox."
            action={
              manage ? (
                <Button onClick={() => setDialog({ open: true })}>
                  <Plus /> Add website chat
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        data.map((c) => {
          const s = settingsOf(c);
          return (
            <Card key={c.id}>
              <CardHeader>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-full"
                    style={{ background: s.color }}
                    aria-hidden
                  >
                    <Globe className="size-5 text-white" />
                  </span>
                  <div className="min-w-0">
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {c.name} <StatusBadge map={CHANNEL_CONNECTION_STATUS} value={c.status} />
                    </CardTitle>
                    <CardDescription className="mt-0.5">
                      {c.counts?.conversations ?? 0} conversations ·{' '}
                      {s.allowedDomains.length
                        ? `Allowed on ${s.allowedDomains.join(', ')}`
                        : 'Allowed on any website'}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPreview(c)}>
                    <Eye /> Preview
                  </Button>
                  {manage && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="Website chat actions">
                          <MoreVertical />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => setDialog({ open: true, connection: c })}>
                          <Palette /> Customize
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => toggle.mutate(c)}>
                          <Power /> {c.status === 'DISABLED' ? 'Turn on' : 'Turn off'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          destructive
                          onSelect={async () =>
                            (await confirm({
                              title: `Remove ${c.name}?`,
                              description:
                                'The chat disappears from your website. Existing conversations and customers are kept.',
                              destructive: true,
                              confirmLabel: 'Remove',
                            })) && remove.mutate(c.id)
                          }
                        >
                          <Trash2 /> Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {c.status === 'DISABLED' && (
                  <p className="mb-4 rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
                    This chat is turned off, so it is hidden on your website.
                  </p>
                )}
                <InstallGuide embed={c.embedCode ?? ''} />
              </CardContent>
            </Card>
          );
        })
      )}
      <CustomizeDialog
        open={dialog.open}
        onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
        connection={dialog.connection}
      />
      <PreviewDialog connection={preview} onOpenChange={(o) => !o && setPreview(null)} />
    </div>
  );
}
