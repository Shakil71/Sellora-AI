/** Shapes returned by the Sellora AI API (subset used by the UI). */

export interface Me {
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    phone: string | null;
    emailVerified: boolean;
    twoFactorEnabled: boolean;
    isSuperAdmin: boolean;
    createdAt: string;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    currency: string;
    timezone: string;
    locale: string;
    onboardingStep: number;
    onboardingCompletedAt: string | null;
    isDemo: boolean;
    status: string;
    subscription: { plan: string; status: string } | null;
  } | null;
  role: { id: string; key: string; name: string } | null;
  permissions: string[];
  workspaces: Array<{ id: string; name: string; slug: string; logoUrl: string | null; status: string; role: { key: string; name: string } }>;
}

export interface UserRef {
  id: string;
  name: string;
  avatarUrl?: string | null;
  email?: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  company: string | null;
  avatarUrl: string | null;
  tags: string[];
  notes: string | null;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  postalCode: string | null;
  source: string | null;
  totalSpent: string;
  ordersCount: number;
  lastInteractionAt: string | null;
  isDemo: boolean;
  createdAt: string;
}

export interface Lead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string | null;
  status: string;
  score: number;
  value: string | null;
  assignedUserId: string | null;
  assignedUser: UserRef | null;
  customerId: string | null;
  customer: { id: string; name: string } | null;
  notes: string | null;
  tags: string[];
  lastActivityAt: string;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  price: string;
  salePrice: string | null;
  cost: string | null;
  effectivePrice: number;
  images: string[];
  status: string;
  tags: string[];
  aiNotes: string | null;
  attributes: Record<string, string> | null;
  trackInventory: boolean;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  inventory: { onHand: number; reserved: number; lowStockThreshold: number; status: string } | null;
  available: number | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  status: string;
  position: number;
  productCount: number;
}

export interface OrderItem {
  id: string;
  productId: string | null;
  name: string;
  sku: string | null;
  unitPrice: string;
  quantity: number;
  discount: string;
  total: string;
  product?: { id: string; images: string[]; status: string } | null;
}

export interface Order {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  source: string;
  currency: string;
  subtotal: string;
  discountTotal: string;
  shippingTotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  notes: string | null;
  shippingName: string | null;
  shippingPhone: string | null;
  shippingAddress: string | null;
  shippingCity: string | null;
  shippingCountry: string | null;
  createdAt: string;
  customer: { id: string; name: string; email?: string | null; phone?: string | null; whatsappNumber?: string | null };
  items?: OrderItem[];
  _count?: { items: number };
}

export interface Conversation {
  id: string;
  channel: 'WHATSAPP' | 'TEST' | 'WEB_CHAT' | 'MESSENGER' | 'INSTAGRAM';
  status: 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED';
  handler: 'AI' | 'HUMAN';
  aiAgentId: string | null;
  assignedUserId: string | null;
  unreadCount: number;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  lastInboundAt: string | null;
  tags: string[];
  priority: string;
  subject: string | null;
  summary: string | null;
  summaryUpdatedAt: string | null;
  handoffReason: string | null;
  createdAt: string;
  customer: { id: string; name: string; avatarUrl: string | null; whatsappNumber: string | null; phone: string | null; tags: string[] };
  assignedUser: UserRef | null;
  aiAgent: { id: string; name: string; avatarUrl: string | null } | null;
  whatsappAccount: { id: string; name: string; displayPhoneNumber: string | null } | null;
  /** Website chat, Messenger or Instagram connection */
  channelConnection?: { id: string; name: string; type: string } | null;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  senderType: 'CUSTOMER' | 'AGENT' | 'AI' | 'SYSTEM';
  type: string;
  body: string | null;
  mediaUrl: string | null;
  mediaId: string | null;
  mediaMimeType: string | null;
  mediaFileName: string | null;
  templateName: string | null;
  status: 'RECEIVED' | 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  errorMessage: string | null;
  createdAt: string;
  senderUser: UserRef | null;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface CatalogField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'user' | 'agent' | 'product' | 'tags' | 'time';
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  defaultValue?: string | number;
}

export interface CatalogItem {
  key: string;
  label: string;
  description: string;
  fields: CatalogField[];
}
