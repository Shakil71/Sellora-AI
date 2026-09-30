'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { useSession } from '@/components/session';
import { PageHeader, Section } from '@/components/shared/page';
import { Badge, Card, CardContent, Input } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Field, ImageUpload } from '@/components/shared/form';

export default function ProfilePage() {
  const { me, refresh } = useSession();
  const [name, setName] = React.useState(me.user.name);
  const [phone, setPhone] = React.useState(me.user.phone ?? '');
  const [avatar, setAvatar] = React.useState<string[]>(me.user.avatarUrl ? [me.user.avatarUrl] : []);
  const save = useMutation({
    mutationFn: () => api.patch('/auth/profile', { name, phone: phone || null, avatarUrl: avatar[0] ?? null }),
    onSuccess: () => {
      toast.success('Profile saved');
      refresh();
    },
  });
  return (
    <>
      <PageHeader title="Your profile" description={`Member since ${date(me.user.createdAt)}`} />
      <Card>
        <CardContent>
          <Section title="Personal details">
            <div className="max-w-md space-y-4">
              <Field label="Photo">
                <ImageUpload value={avatar} onChange={setAvatar} max={1} purpose="avatar" />
              </Field>
              <Field label="Full name" htmlFor="p-name">
                <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Phone" htmlFor="p-phone">
                <Input id="p-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <Field label="Email" hint="Contact your administrator to change your sign-in email.">
                <div className="flex items-center gap-2">
                  <Input value={me.user.email} readOnly disabled />
                  {me.user.emailVerified ? <Badge variant="success">Verified</Badge> : <Badge variant="warning">Unverified</Badge>}
                </div>
              </Field>
              <Button onClick={() => save.mutate()} loading={save.isPending} disabled={name.trim().length < 2}>
                Save profile
              </Button>
            </div>
          </Section>
          <Section title="Workspace role">
            <p className="text-sm">
              {me.role?.name} in <strong>{me.workspace?.name}</strong>
            </p>
            <Button variant="link" className="h-auto p-0" asChild>
              <Link href="/settings/security">Security settings →</Link>
            </Button>
          </Section>
        </CardContent>
      </Card>
    </>
  );
}
