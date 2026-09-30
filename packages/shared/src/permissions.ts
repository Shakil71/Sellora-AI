/**
 * Central permission catalog. Every API endpoint and UI action is gated by
 * one of these keys. Roles are collections of permission keys.
 */
export const PERMISSION_GROUPS = [
  {
    group: 'Dashboard',
    permissions: [{ key: 'dashboard.view', description: 'View the dashboard' }],
  },
  {
    group: 'Contacts & Customers',
    permissions: [
      { key: 'contacts.view', description: 'View customers and contacts' },
      { key: 'contacts.create', description: 'Create customers and contacts' },
      { key: 'contacts.update', description: 'Update customers and contacts' },
      { key: 'contacts.delete', description: 'Delete customers and contacts' },
    ],
  },
  {
    group: 'Conversations',
    permissions: [
      { key: 'conversations.view', description: 'View conversations and messages' },
      { key: 'conversations.reply', description: 'Reply to customers and add notes' },
      { key: 'conversations.assign', description: 'Assign, transfer and hand off conversations' },
      { key: 'conversations.close', description: 'Resolve and close conversations' },
    ],
  },
  {
    group: 'Products',
    permissions: [
      { key: 'products.view', description: 'View products and categories' },
      { key: 'products.create', description: 'Create products and categories' },
      { key: 'products.update', description: 'Update products and categories' },
      { key: 'products.delete', description: 'Delete products and categories' },
    ],
  },
  {
    group: 'Inventory',
    permissions: [
      { key: 'inventory.view', description: 'View stock levels and movements' },
      { key: 'inventory.update', description: 'Adjust stock levels' },
    ],
  },
  {
    group: 'Orders',
    permissions: [
      { key: 'orders.view', description: 'View orders, invoices, payments and deliveries' },
      { key: 'orders.create', description: 'Create orders and invoices' },
      { key: 'orders.update', description: 'Update orders, payments and deliveries' },
      { key: 'orders.cancel', description: 'Cancel and refund orders' },
    ],
  },
  {
    group: 'CRM',
    permissions: [
      { key: 'crm.leads.view', description: 'View leads' },
      { key: 'crm.leads.create', description: 'Create leads' },
      { key: 'crm.leads.update', description: 'Update leads' },
      { key: 'crm.leads.delete', description: 'Delete leads' },
      { key: 'crm.deals.view', description: 'View deals and pipelines' },
      { key: 'crm.deals.create', description: 'Create deals' },
      { key: 'crm.deals.update', description: 'Update and move deals' },
      { key: 'crm.deals.delete', description: 'Delete deals' },
      { key: 'crm.pipelines.manage', description: 'Manage pipelines and stages' },
      { key: 'tasks.view', description: 'View tasks' },
      { key: 'tasks.manage', description: 'Create, update and delete tasks' },
    ],
  },
  {
    group: 'WhatsApp',
    permissions: [
      { key: 'whatsapp.view', description: 'View WhatsApp accounts, templates and webhooks' },
      { key: 'whatsapp.manage', description: 'Connect accounts and manage templates' },
    ],
  },
  {
    group: 'AI',
    permissions: [
      { key: 'ai.agents.view', description: 'View AI agents' },
      { key: 'ai.agents.create', description: 'Create AI agents' },
      { key: 'ai.agents.update', description: 'Update, test and delete AI agents' },
      { key: 'ai.knowledge.view', description: 'View knowledge bases' },
      { key: 'ai.knowledge.manage', description: 'Manage knowledge bases and documents' },
      { key: 'ai.usage.view', description: 'View AI usage and tool logs' },
    ],
  },
  {
    group: 'Automation',
    permissions: [
      { key: 'automation.view', description: 'View workflows and runs' },
      { key: 'automation.create', description: 'Create workflows' },
      { key: 'automation.update', description: 'Update and delete workflows' },
      { key: 'automation.execute', description: 'Run workflows manually and retry runs' },
    ],
  },
  {
    group: 'Analytics',
    permissions: [{ key: 'analytics.view', description: 'View analytics' }],
  },
  {
    group: 'Settings',
    permissions: [
      { key: 'settings.view', description: 'View workspace settings' },
      { key: 'settings.update', description: 'Update workspace settings' },
      { key: 'api_keys.manage', description: 'Create and revoke API keys' },
      { key: 'billing.view', description: 'View subscription and usage' },
      { key: 'billing.manage', description: 'Change subscription plan' },
      { key: 'audit.view', description: 'View audit logs' },
    ],
  },
  {
    group: 'Team',
    permissions: [
      { key: 'users.view', description: 'View team members' },
      { key: 'users.create', description: 'Invite team members' },
      { key: 'users.update', description: 'Change member roles and status' },
      { key: 'users.delete', description: 'Remove team members' },
      { key: 'roles.manage', description: 'Create and edit roles' },
    ],
  },
] as const;

type Groups = typeof PERMISSION_GROUPS;
export type Permission = Groups[number]['permissions'][number]['key'];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.key as Permission),
);

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as string[]).includes(value);
}

export const SYSTEM_ROLE_KEYS = [
  'OWNER',
  'ADMIN',
  'MANAGER',
  'SALES',
  'SUPPORT',
  'AGENT',
  'VIEWER',
] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

/** SUPER_ADMIN is a platform-level role stored on the user, not a workspace role. */
export const PLATFORM_ROLE_SUPER_ADMIN = 'SUPER_ADMIN';

const without = (list: Permission[], excluded: Permission[]): Permission[] =>
  list.filter((p) => !excluded.includes(p));

const VIEW_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p.endsWith('.view'));

export const SYSTEM_ROLES: Record<
  SystemRoleKey,
  { name: string; description: string; permissions: Permission[] }
> = {
  OWNER: {
    name: 'Owner',
    description: 'Full access to the workspace, including billing.',
    permissions: [...ALL_PERMISSIONS],
  },
  ADMIN: {
    name: 'Admin',
    description: 'Full access except subscription changes.',
    permissions: without(ALL_PERMISSIONS, ['billing.manage']),
  },
  MANAGER: {
    name: 'Manager',
    description: 'Runs sales, commerce, conversations and automation.',
    permissions: without(ALL_PERMISSIONS, [
      'billing.manage',
      'roles.manage',
      'api_keys.manage',
      'users.update',
      'users.delete',
      'settings.update',
      'audit.view',
    ]),
  },
  SALES: {
    name: 'Sales',
    description: 'Works leads, deals, customers and orders.',
    permissions: [
      'dashboard.view',
      'contacts.view',
      'contacts.create',
      'contacts.update',
      'conversations.view',
      'conversations.reply',
      'crm.leads.view',
      'crm.leads.create',
      'crm.leads.update',
      'crm.deals.view',
      'crm.deals.create',
      'crm.deals.update',
      'tasks.view',
      'tasks.manage',
      'products.view',
      'inventory.view',
      'orders.view',
      'orders.create',
      'orders.update',
      'analytics.view',
    ],
  },
  SUPPORT: {
    name: 'Support',
    description: 'Handles customer conversations and order questions.',
    permissions: [
      'dashboard.view',
      'contacts.view',
      'contacts.create',
      'contacts.update',
      'conversations.view',
      'conversations.reply',
      'conversations.assign',
      'conversations.close',
      'crm.leads.view',
      'crm.leads.create',
      'tasks.view',
      'tasks.manage',
      'products.view',
      'inventory.view',
      'orders.view',
      'orders.update',
      'whatsapp.view',
    ],
  },
  AGENT: {
    name: 'Agent',
    description: 'Replies to customer conversations.',
    permissions: [
      'dashboard.view',
      'contacts.view',
      'contacts.update',
      'conversations.view',
      'conversations.reply',
      'conversations.close',
      'products.view',
      'inventory.view',
      'orders.view',
      'tasks.view',
      'tasks.manage',
    ],
  },
  VIEWER: {
    name: 'Viewer',
    description: 'Read-only access to business data.',
    permissions: without(VIEW_PERMISSIONS, ['settings.view', 'users.view', 'billing.view']),
  },
};

export function permissionGroupOf(key: string): string | undefined {
  return PERMISSION_GROUPS.find((g) => g.permissions.some((p) => p.key === key))?.group;
}
