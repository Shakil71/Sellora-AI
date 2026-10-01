'use client';

import { useSession } from '@/components/session';
import { EmptyState, PageHeader } from '@/components/shared/page';
import { HomepageEditor } from '@/features/admin/homepage-editor';

export default function HomepageAdminPage() {
  const { me } = useSession();
  if (!me.user.isSuperAdmin) return <EmptyState title="Platform administrators only" description="You don't have access to this area." />;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Platform admin', href: '/admin' }, { label: 'Home page' }]}
        title="Edit the home page"
        description="Change the words, buttons, feature cards, FAQ and testimonials visitors see. Add, delete, reorder or hide sections. Changes appear on the public home page within 30 seconds of saving."
      />
      <HomepageEditor />
    </>
  );
}
