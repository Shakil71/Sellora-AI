'use client';

import * as React from 'react';
import Link from 'next/link';
import { KeyRound, Send } from 'lucide-react';
import { useSession } from '@/components/session';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/primitives';
import { CodeBlock } from './common';

interface Example {
  id: string;
  title: string;
  description: string;
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  body?: Record<string, unknown>;
  permission: string;
}

const EXAMPLES: Example[] = [
  {
    id: 'products',
    title: 'List products',
    description: 'Search your catalog to show prices and stock on your website.',
    method: 'GET',
    path: '/products?search=headphones&pageSize=20',
    permission: 'products.view',
  },
  {
    id: 'lead',
    title: 'Send a contact form to Sellora',
    description: 'Every website enquiry becomes a lead your team (and automations) can follow up.',
    method: 'POST',
    path: '/leads',
    body: {
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+15551234567',
      source: 'website',
      notes: 'Asked about bulk pricing',
    },
    permission: 'crm.leads.create',
  },
  {
    id: 'customer',
    title: 'Find or create a customer',
    description: 'Look the shopper up by email first; create them only if they are new.',
    method: 'POST',
    path: '/customers',
    body: {
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+15551234567',
      city: 'Chicago',
      source: 'website',
    },
    permission: 'contacts.create',
  },
  {
    id: 'order',
    title: 'Create an order from your checkout',
    description:
      'Prices, tax and shipping are calculated by Sellora from your catalog; stock is reserved automatically.',
    method: 'POST',
    path: '/orders',
    body: {
      customerId: 'CUSTOMER_ID',
      items: [{ productId: 'PRODUCT_ID', quantity: 2 }],
      shippingName: 'Jane Doe',
      shippingPhone: '+15551234567',
      shippingAddress: '221B Baker Street',
      shippingCity: 'Chicago',
      notes: 'Website order #1042',
    },
    permission: 'orders.create',
  },
  {
    id: 'stock',
    title: 'Sync stock from your warehouse',
    description: 'Set, add or remove stock. Low-stock alerts and automations fire as usual.',
    method: 'POST',
    path: '/inventory/PRODUCT_ID/adjust',
    body: { mode: 'set', quantity: 120, reason: 'Nightly warehouse sync' },
    permission: 'inventory.update',
  },
  {
    id: 'status',
    title: 'Check an order',
    description: 'Show order and payment status on your “Track my order” page.',
    method: 'GET',
    path: '/orders/ORDER_ID',
    permission: 'orders.view',
  },
];

function curl(base: string, e: Example) {
  const lines = [`curl -X ${e.method} "${base}${e.path}" \\`, '  -H "x-api-key: $SELLORA_API_KEY"'];
  if (e.body) {
    lines[lines.length - 1] += ' \\';
    lines.push('  -H "Content-Type: application/json" \\', `  -d '${JSON.stringify(e.body)}'`);
  }
  return lines.join('\n');
}

function js(base: string, e: Example) {
  const body = e.body
    ? `,\n  headers: { 'x-api-key': process.env.SELLORA_API_KEY, 'Content-Type': 'application/json' },\n  body: JSON.stringify(${JSON.stringify(e.body, null, 2).replace(/\n/g, '\n  ')}),`
    : `,\n  headers: { 'x-api-key': process.env.SELLORA_API_KEY },`;
  return `const res = await fetch('${base}${e.path}', {\n  method: '${e.method}'${body}\n});\nconst { success, data, error } = await res.json();\nif (!success) throw new Error(error.message);`;
}

function php(base: string, e: Example) {
  const lines = [
    `$ch = curl_init('${base}${e.path}');`,
    'curl_setopt_array($ch, [',
    `    CURLOPT_CUSTOMREQUEST => '${e.method}',`,
    '    CURLOPT_RETURNTRANSFER => true,',
    `    CURLOPT_HTTPHEADER => ['x-api-key: ' . getenv('SELLORA_API_KEY')${e.body ? ", 'Content-Type: application/json'" : ''}],`,
  ];
  if (e.body) lines.push(`    CURLOPT_POSTFIELDS => json_encode(${phpArray(e.body, 2)}),`);
  lines.push(
    ']);',
    '$result = json_decode(curl_exec($ch), true);',
    'curl_close($ch);',
    "$data = $result['data'] ?? null;",
  );
  return lines.join('\n');
}

function phpArray(value: unknown, depth: number): string {
  const pad = '    '.repeat(depth);
  if (Array.isArray(value))
    return `[\n${value.map((v) => `${pad}${phpArray(v, depth + 1)}`).join(',\n')},\n${'    '.repeat(depth - 1)}]`;
  if (value && typeof value === 'object') {
    return `[\n${Object.entries(value)
      .map(([k, v]) => `${pad}'${k}' => ${phpArray(v, depth + 1)}`)
      .join(',\n')},\n${'    '.repeat(depth - 1)}]`;
  }
  return typeof value === 'string' ? `'${value.replace(/'/g, "\\'")}'` : String(value);
}

export function ApiGuide({ baseUrl }: { baseUrl: string }) {
  const { can } = useSession();
  const [lang, setLang] = React.useState<'curl' | 'js' | 'php'>('curl');
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Getting started</CardTitle>
            <CardDescription className="mt-1">
              Connect your website, app, ERP or any other system to Sellora with a REST API.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-2">
            <p className="text-sm font-medium">1. Create an API key</p>
            <p className="text-sm text-muted-foreground">
              Give it only the permissions it needs. Keys are shown once; store them on your server,
              never in browser code.
            </p>
            {can('api_keys.manage') && (
              <Button variant="outline" size="sm" asChild>
                <Link href="/settings/api">
                  <KeyRound /> Manage API keys
                </Link>
              </Button>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">2. Call the API</p>
            <p className="text-sm text-muted-foreground">
              Send the key in the <code className="rounded bg-muted px-1">x-api-key</code> header.
              Responses look like{' '}
              <code className="rounded bg-muted px-1">{'{ success, data }'}</code>.
            </p>
            <CodeBlock code={baseUrl} label="Base URL" />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">3. Receive events</p>
            <p className="text-sm text-muted-foreground">
              Get notified the moment orders, leads and messages happen instead of polling the API.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/integrations/webhooks">
                <Send /> Set up webhooks
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Common tasks</h2>
        <Tabs value={lang} onValueChange={(v) => setLang(v as typeof lang)}>
          <TabsList>
            <TabsTrigger value="curl">cURL</TabsTrigger>
            <TabsTrigger value="js">JavaScript</TabsTrigger>
            <TabsTrigger value="php">PHP</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {EXAMPLES.map((e) => (
          <Card key={e.id}>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${e.method === 'GET' ? 'bg-info/12 text-info' : 'bg-success/12 text-success'}`}
                  >
                    {e.method}
                  </span>
                  {e.title}
                </CardTitle>
                <CardDescription className="mt-1">
                  {e.description} Needs{' '}
                  <code className="rounded bg-muted px-1">{e.permission}</code>.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <CodeBlock
                code={
                  lang === 'curl'
                    ? curl(baseUrl, e)
                    : lang === 'js'
                      ? js(baseUrl, e)
                      : php(baseUrl, e)
                }
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Good to know</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
            <li>
              <strong className="text-foreground">Lists</strong> accept{' '}
              <code className="rounded bg-muted px-1">page</code>,{' '}
              <code className="rounded bg-muted px-1">pageSize</code> (max 100) and{' '}
              <code className="rounded bg-muted px-1">search</code>, and return{' '}
              <code className="rounded bg-muted px-1">{'{ items, meta }'}</code>.
            </li>
            <li>
              <strong className="text-foreground">Errors</strong> return{' '}
              <code className="rounded bg-muted px-1">
                {'{ success: false, error: { code, message, requestId } }'}
              </code>
              . Quote the requestId when asking for help.
            </li>
            <li>
              <strong className="text-foreground">Rate limits</strong> apply per key; on HTTP 429
              wait and retry with backoff.
            </li>
            <li>
              <strong className="text-foreground">Money</strong> is in your workspace currency.
              Order totals are always computed by Sellora from your catalog.
            </li>
            <li>
              <strong className="text-foreground">Status codes</strong>: 401 bad key, 403 missing
              permission, 404 not found, 409 conflict (e.g. out of stock), 422 validation error.
            </li>
            <li>
              <strong className="text-foreground">Full reference</strong>: every endpoint is listed
              in <code className="rounded bg-muted px-1">docs/API.md</code> in the Sellora
              repository.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
