import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  Boxes,
  BookOpen,
  Brain,
  CalendarCheck,
  Contact,
  CreditCard,
  FileText,
  Gauge,
  GitBranch,
  Inbox,
  KanbanSquare,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  MessageCircle,
  MessagesSquare,
  Package,
  PieChart,
  Play,
  Receipt,
  ScrollText,
  Settings,
  Shield,
  ShoppingCart,
  Sparkles,
  Tags,
  Target,
  Truck,
  UserCog,
  Users,
  Webhook,
  Workflow,
  Zap,
  Building2,
  Handshake,
  Smartphone,
  FileStack,
  Plug,
  Globe,
  MessageSquareMore,
  Camera,
  Send,
  Wallet,
  Code2,
} from 'lucide-react';

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  permission?: string;
  /** Additional path prefixes that mark this item active */
  match?: string[];
  /** Active only on this exact path (not its sub-pages) */
  exact?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: '',
    items: [{ title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'dashboard.view' }],
  },
  {
    title: 'Sales',
    items: [
      { title: 'Inbox', href: '/inbox', icon: Inbox, permission: 'conversations.view' },
      { title: 'Conversations', href: '/conversations', icon: MessagesSquare, permission: 'conversations.view' },
      { title: 'Leads', href: '/leads', icon: Target, permission: 'crm.leads.view' },
      { title: 'Customers', href: '/customers', icon: Users, permission: 'contacts.view' },
      { title: 'Deals', href: '/deals', icon: Handshake, permission: 'crm.deals.view' },
      { title: 'Pipelines', href: '/pipelines', icon: KanbanSquare, permission: 'crm.deals.view' },
      { title: 'Tasks', href: '/tasks', icon: CalendarCheck, permission: 'tasks.view' },
    ],
  },
  {
    title: 'Commerce',
    items: [
      { title: 'Products', href: '/products', icon: Package, permission: 'products.view' },
      { title: 'Categories', href: '/categories', icon: Tags, permission: 'products.view' },
      { title: 'Inventory', href: '/inventory', icon: Boxes, permission: 'inventory.view' },
      { title: 'Orders', href: '/orders', icon: ShoppingCart, permission: 'orders.view' },
      { title: 'Invoices', href: '/invoices', icon: Receipt, permission: 'orders.view' },
      { title: 'Payments', href: '/payments', icon: CreditCard, permission: 'orders.view' },
      { title: 'Deliveries', href: '/deliveries', icon: Truck, permission: 'orders.view' },
    ],
  },
  {
    title: 'WhatsApp',
    items: [
      { title: 'Accounts', href: '/whatsapp/accounts', icon: Smartphone, permission: 'whatsapp.view' },
      { title: 'Inbox', href: '/inbox?channel=WHATSAPP', icon: MessageCircle, permission: 'conversations.view', match: [] },
      { title: 'Templates', href: '/whatsapp/templates', icon: FileStack, permission: 'conversations.view' },
      { title: 'Contacts', href: '/whatsapp/contacts', icon: Contact, permission: 'whatsapp.view' },
      { title: 'Webhooks', href: '/whatsapp/webhooks', icon: Webhook, permission: 'whatsapp.view' },
    ],
  },
  {
    title: 'Integrations',
    items: [
      { title: 'Overview', href: '/integrations', icon: Plug, permission: 'integrations.view', exact: true },
      { title: 'Website Chat', href: '/integrations/website-chat', icon: Globe, permission: 'integrations.view' },
      { title: 'Messenger', href: '/integrations/messenger', icon: MessageSquareMore, permission: 'integrations.view' },
      { title: 'Instagram', href: '/integrations/instagram', icon: Camera, permission: 'integrations.view' },
      { title: 'Payments', href: '/integrations/payments', icon: Wallet, permission: 'integrations.view' },
      { title: 'Webhooks', href: '/integrations/webhooks', icon: Send, permission: 'integrations.view' },
      { title: 'Developer API', href: '/integrations/api', icon: Code2, permission: 'integrations.view' },
    ],
  },
  {
    title: 'AI',
    items: [
      { title: 'AI Agents', href: '/ai/agents', icon: Bot, permission: 'ai.agents.view' },
      { title: 'Knowledge Base', href: '/ai/knowledge', icon: BookOpen, permission: 'ai.knowledge.view' },
      { title: 'AI Instructions', href: '/ai/instructions', icon: ScrollText, permission: 'ai.agents.view' },
      { title: 'Product Knowledge', href: '/ai/product-knowledge', icon: Brain, permission: 'products.view' },
      { title: 'Conversation Summaries', href: '/ai/summaries', icon: Sparkles, permission: 'conversations.view' },
      { title: 'AI Usage', href: '/ai/usage', icon: Gauge, permission: 'ai.usage.view' },
    ],
  },
  {
    title: 'Automation',
    items: [
      { title: 'Workflows', href: '/automation/workflows', icon: Workflow, permission: 'automation.view' },
      { title: 'Triggers', href: '/automation/triggers', icon: Zap, permission: 'automation.view' },
      { title: 'Actions', href: '/automation/actions', icon: ListChecks, permission: 'automation.view' },
      { title: 'Workflow Runs', href: '/automation/runs', icon: Play, permission: 'automation.view' },
    ],
  },
  {
    title: 'Analytics',
    items: [
      { title: 'Sales Analytics', href: '/analytics/sales', icon: BarChart3, permission: 'analytics.view' },
      { title: 'CRM Analytics', href: '/analytics/crm', icon: PieChart, permission: 'analytics.view' },
      { title: 'Conversation Analytics', href: '/analytics/conversations', icon: Activity, permission: 'analytics.view' },
      { title: 'AI Analytics', href: '/analytics/ai', icon: GitBranch, permission: 'analytics.view' },
    ],
  },
  {
    title: 'Settings',
    items: [
      { title: 'Workspace', href: '/settings/workspace', icon: Building2, permission: 'settings.view' },
      { title: 'Users', href: '/settings/users', icon: UserCog, permission: 'users.view' },
      { title: 'Roles', href: '/settings/roles', icon: Shield, permission: 'users.view' },
      { title: 'WhatsApp', href: '/settings/whatsapp', icon: MessageCircle, permission: 'whatsapp.view' },
      { title: 'AI', href: '/settings/ai', icon: Bot, permission: 'settings.view' },
      { title: 'Notifications', href: '/settings/notifications', icon: Bell },
      { title: 'API', href: '/settings/api', icon: KeyRound, permission: 'api_keys.manage' },
      { title: 'Billing', href: '/settings/billing', icon: FileText, permission: 'billing.view' },
      { title: 'Security', href: '/settings/security', icon: Settings },
    ],
  },
];

export function filterNav(can: (p?: string) => boolean): NavSection[] {
  return NAV_SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => can(i.permission)) })).filter((s) => s.items.length);
}

/** Title lookup for breadcrumbs. */
export function findNavItem(pathname: string): { section: string; item: NavItem } | undefined {
  for (const section of NAV_SECTIONS) {
    const item = [...section.items]
      .sort((a, b) => b.href.length - a.href.length)
      .find((i) => !i.href.includes('?') && (pathname === i.href || pathname.startsWith(`${i.href}/`)));
    if (item) return { section: section.title, item };
  }
  return undefined;
}

export const ICONS = { Users, Target, ShoppingCart, Package, MessagesSquare, Handshake };
