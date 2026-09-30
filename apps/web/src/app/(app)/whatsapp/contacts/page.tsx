'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Contact } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { relative } from '@/lib/format';
import { PageHeader } from '@/components/shared/page';
import { DataTable, Pagination, SearchInput, Toolbar } from '@/components/shared/data-table';
import { Avatar } from '@/components/ui/primitives';
import { useListState } from '@/hooks/use-list-state';

interface WaContact {
  id: string;
  waId: string;
  profileName: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  customer: { id: string; name: string } | null;
  account: { id: string; name: string };
}

export default function WhatsAppContactsPage() {
  const router = useRouter();
  const list = useListState();
  const { data, isLoading } = useQuery({
    queryKey: ['wa-contacts', list.query],
    queryFn: () => api.get<Paginated<WaContact>>('/whatsapp/contacts', { ...list.query, pageSize: 25 }),
    placeholderData: (p) => p,
  });
  return (
    <>
      <PageHeader title="WhatsApp contacts" description="People who have messaged your connected WhatsApp numbers. Each contact is linked to a customer profile." />
      <Toolbar>
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Name or number" />
      </Toolbar>
      <DataTable
        rows={data?.items}
        loading={isLoading}
        onRowClick={(c) => c.customer && router.push(`/customers/${c.customer.id}`)}
        empty={{ icon: Contact, title: 'No WhatsApp contacts yet', description: 'Contacts appear automatically when customers message your connected number.' }}
        mobileCard={(c) => (
          <div className="flex items-center gap-3">
            <Avatar name={c.profileName ?? c.waId} size={34} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{c.profileName ?? `+${c.waId}`}</p>
              <p className="text-xs text-muted-foreground">+{c.waId}</p>
            </div>
            <span className="text-xs text-muted-foreground">{relative(c.lastMessageAt)}</span>
          </div>
        )}
        columns={[
          {
            key: 'name',
            header: 'Contact',
            cell: (c) => (
              <span className="flex items-center gap-3">
                <Avatar name={c.profileName ?? c.waId} size={30} />
                <span className="font-medium">{c.profileName ?? '—'}</span>
              </span>
            ),
          },
          { key: 'number', header: 'WhatsApp number', cell: (c) => <span className="font-mono text-xs">+{c.waId}</span> },
          { key: 'customer', header: 'Customer', hideBelow: 'md', cell: (c) => c.customer?.name ?? '—' },
          { key: 'account', header: 'Number', hideBelow: 'lg', cell: (c) => <span className="text-muted-foreground">{c.account.name}</span> },
          { key: 'last', header: 'Last message', align: 'right', cell: (c) => <span className="text-muted-foreground">{relative(c.lastMessageAt)}</span> },
        ]}
        footer={data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={list.setPage} label="contacts" />}
      />
    </>
  );
}
