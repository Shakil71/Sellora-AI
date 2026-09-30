import type { BadgeVariant } from '@/components/ui/primitives';

type StatusMap = Record<string, { label: string; variant: BadgeVariant }>;

export const ORDER_STATUS: StatusMap = {
  PENDING: { label: 'Pending', variant: 'warning' },
  CONFIRMED: { label: 'Confirmed', variant: 'info' },
  PROCESSING: { label: 'Processing', variant: 'info' },
  PACKED: { label: 'Packed', variant: 'info' },
  SHIPPED: { label: 'Shipped', variant: 'default' },
  DELIVERED: { label: 'Delivered', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'muted' },
  REFUNDED: { label: 'Refunded', variant: 'destructive' },
};

export const PAYMENT_STATUS: StatusMap = {
  PENDING: { label: 'Unpaid', variant: 'warning' },
  PAID: { label: 'Paid', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'destructive' },
  REFUNDED: { label: 'Refunded', variant: 'muted' },
  PARTIALLY_REFUNDED: { label: 'Partially refunded', variant: 'warning' },
};

export const LEAD_STATUS: StatusMap = {
  NEW: { label: 'New', variant: 'info' },
  CONTACTED: { label: 'Contacted', variant: 'secondary' },
  QUALIFIED: { label: 'Qualified', variant: 'default' },
  PROPOSAL: { label: 'Proposal', variant: 'ai' },
  NEGOTIATION: { label: 'Negotiation', variant: 'warning' },
  WON: { label: 'Won', variant: 'success' },
  LOST: { label: 'Lost', variant: 'muted' },
};

export const STOCK_STATUS: StatusMap = {
  IN_STOCK: { label: 'In stock', variant: 'success' },
  LOW_STOCK: { label: 'Low stock', variant: 'warning' },
  OUT_OF_STOCK: { label: 'Out of stock', variant: 'destructive' },
};

export const PRODUCT_STATUS: StatusMap = {
  ACTIVE: { label: 'Active', variant: 'success' },
  DRAFT: { label: 'Draft', variant: 'muted' },
  ARCHIVED: { label: 'Archived', variant: 'secondary' },
};

export const CONVERSATION_STATUS: StatusMap = {
  OPEN: { label: 'Open', variant: 'info' },
  PENDING: { label: 'Pending', variant: 'warning' },
  RESOLVED: { label: 'Resolved', variant: 'success' },
  CLOSED: { label: 'Closed', variant: 'muted' },
};

export const DELIVERY_STATUS: StatusMap = {
  PENDING: { label: 'Pending', variant: 'warning' },
  SCHEDULED: { label: 'Scheduled', variant: 'info' },
  IN_TRANSIT: { label: 'In transit', variant: 'default' },
  DELIVERED: { label: 'Delivered', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'destructive' },
  RETURNED: { label: 'Returned', variant: 'muted' },
};

export const TASK_STATUS: StatusMap = {
  TODO: { label: 'To do', variant: 'secondary' },
  IN_PROGRESS: { label: 'In progress', variant: 'info' },
  DONE: { label: 'Done', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'muted' },
};

export const PRIORITY: StatusMap = {
  LOW: { label: 'Low', variant: 'muted' },
  MEDIUM: { label: 'Medium', variant: 'secondary' },
  HIGH: { label: 'High', variant: 'warning' },
  URGENT: { label: 'Urgent', variant: 'destructive' },
};

export const DOCUMENT_STATUS: StatusMap = {
  PENDING: { label: 'Queued', variant: 'muted' },
  PROCESSING: { label: 'Processing', variant: 'info' },
  READY: { label: 'Ready', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'destructive' },
};

export const WORKFLOW_STATUS: StatusMap = {
  DRAFT: { label: 'Draft', variant: 'muted' },
  ACTIVE: { label: 'Active', variant: 'success' },
  PAUSED: { label: 'Paused', variant: 'warning' },
};

export const RUN_STATUS: StatusMap = {
  QUEUED: { label: 'Queued', variant: 'muted' },
  RUNNING: { label: 'Running', variant: 'info' },
  WAITING: { label: 'Waiting', variant: 'ai' },
  SUCCEEDED: { label: 'Succeeded', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'destructive' },
  CANCELLED: { label: 'Cancelled', variant: 'muted' },
};

export const WA_ACCOUNT_STATUS: StatusMap = {
  PENDING: { label: 'Not verified', variant: 'warning' },
  CONNECTED: { label: 'Connected', variant: 'success' },
  ERROR: { label: 'Error', variant: 'destructive' },
  DISCONNECTED: { label: 'Disconnected', variant: 'muted' },
};

export const CHANNEL_CONNECTION_STATUS: StatusMap = {
  CONNECTED: { label: 'Connected', variant: 'success' },
  ERROR: { label: 'Needs attention', variant: 'destructive' },
  DISABLED: { label: 'Turned off', variant: 'muted' },
};

export const WEBHOOK_DELIVERY_STATUS: StatusMap = {
  PENDING: { label: 'Retrying', variant: 'warning' },
  SUCCEEDED: { label: 'Delivered', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'destructive' },
};

export const TEMPLATE_STATUS: StatusMap = {
  DRAFT: { label: 'Draft', variant: 'muted' },
  PENDING: { label: 'In review', variant: 'warning' },
  APPROVED: { label: 'Approved', variant: 'success' },
  REJECTED: { label: 'Rejected', variant: 'destructive' },
  PAUSED: { label: 'Paused', variant: 'warning' },
  DISABLED: { label: 'Disabled', variant: 'muted' },
};

export const TOOL_STATUS: StatusMap = {
  SUCCESS: { label: 'Success', variant: 'success' },
  ERROR: { label: 'Error', variant: 'destructive' },
  DENIED: { label: 'Denied', variant: 'warning' },
  DRY_RUN: { label: 'Test run', variant: 'ai' },
};

export const ORDER_SOURCE: Record<string, string> = {
  MANUAL: 'Manual',
  AI: 'AI agent',
  WHATSAPP: 'WhatsApp',
  AUTOMATION: 'Automation',
  API: 'API',
};

export function statusOf(map: StatusMap, key: string | null | undefined) {
  return (key && map[key]) || { label: key ?? '—', variant: 'muted' as BadgeVariant };
}
