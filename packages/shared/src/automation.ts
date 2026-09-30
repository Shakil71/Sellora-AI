/**
 * Automation catalog shared by the workflow engine (API) and the visual
 * workflow builder (web). Adding a new trigger/condition/action starts here.
 */
export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'user'
  | 'agent'
  | 'product'
  | 'tags'
  | 'time';

export interface CatalogField {
  key: string;
  label: string;
  type: FieldType;
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

export const LEAD_STATUS_OPTIONS = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
  'LOST',
].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }));

const COMPARATORS = [
  { value: 'gt', label: 'Greater than' },
  { value: 'gte', label: 'Greater than or equal' },
  { value: 'lt', label: 'Less than' },
  { value: 'lte', label: 'Less than or equal' },
  { value: 'eq', label: 'Equal to' },
];

export const WORKFLOW_TRIGGERS = [
  {
    key: 'message.received',
    label: 'New WhatsApp message',
    description: 'A customer sends a message on a connected channel.',
    fields: [],
  },
  {
    key: 'conversation.opened',
    label: 'Conversation opened',
    description: 'A new conversation starts or a closed one is reopened.',
    fields: [],
  },
  {
    key: 'conversation.resolved',
    label: 'Conversation resolved',
    description: 'An agent or the AI marks a conversation as resolved.',
    fields: [],
  },
  {
    key: 'lead.created',
    label: 'New lead',
    description: 'A lead is created manually, by the AI or through the API.',
    fields: [],
  },
  {
    key: 'order.created',
    label: 'Order created',
    description: 'A new order is placed.',
    fields: [],
  },
  {
    key: 'order.paid',
    label: 'Order paid',
    description: 'An order becomes fully paid.',
    fields: [],
  },
  {
    key: 'order.cancelled',
    label: 'Order cancelled',
    description: 'An order is cancelled.',
    fields: [],
  },
  {
    key: 'inventory.low',
    label: 'Low inventory',
    description: 'Available stock of a product drops to or below its low-stock threshold.',
    fields: [],
  },
  {
    key: 'customer.inactive',
    label: 'Customer inactive',
    description: 'A customer has had no interaction for a number of days (checked daily).',
    fields: [
      {
        key: 'days',
        label: 'Inactive for (days)',
        type: 'number',
        required: true,
        defaultValue: 30,
      },
    ],
  },
] as const satisfies readonly CatalogItem[];

export const WORKFLOW_CONDITIONS = [
  {
    key: 'customer.tag',
    label: 'Customer has tag',
    description: 'Continue on the "yes" branch when the customer has the tag.',
    fields: [{ key: 'tag', label: 'Tag', type: 'text', required: true }],
  },
  {
    key: 'order.amount',
    label: 'Order amount',
    description: 'Compare the order total with a value.',
    fields: [
      { key: 'operator', label: 'Operator', type: 'select', required: true, options: COMPARATORS },
      { key: 'value', label: 'Amount', type: 'number', required: true },
    ],
  },
  {
    key: 'order.product',
    label: 'Order contains product',
    description: 'The order includes the selected product.',
    fields: [{ key: 'productId', label: 'Product', type: 'product', required: true }],
  },
  {
    key: 'lead.status',
    label: 'Lead status',
    description: 'The lead has the selected status.',
    fields: [
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        required: true,
        options: LEAD_STATUS_OPTIONS,
      },
    ],
  },
  {
    key: 'inventory.level',
    label: 'Inventory level',
    description: 'Compare available stock of a product with a value.',
    fields: [
      { key: 'productId', label: 'Product', type: 'product', help: 'Defaults to the trigger product' },
      { key: 'operator', label: 'Operator', type: 'select', required: true, options: COMPARATORS },
      { key: 'value', label: 'Quantity', type: 'number', required: true },
    ],
  },
  {
    key: 'time.window',
    label: 'Time window',
    description: 'Current time (workspace timezone) is within the window.',
    fields: [
      { key: 'from', label: 'From', type: 'time', required: true, defaultValue: '09:00' },
      { key: 'to', label: 'To', type: 'time', required: true, defaultValue: '18:00' },
      {
        key: 'days',
        label: 'Days',
        type: 'tags',
        help: 'mon, tue, wed, thu, fri, sat, sun — empty means every day',
      },
    ],
  },
  {
    key: 'channel.is',
    label: 'Channel is',
    description: 'The event came from the selected channel.',
    fields: [
      {
        key: 'channel',
        label: 'Channel',
        type: 'select',
        required: true,
        options: [{ value: 'WHATSAPP', label: 'WhatsApp' }],
      },
    ],
  },
  {
    key: 'message.contains',
    label: 'Message contains',
    description: 'The customer message contains any of the keywords (case-insensitive).',
    fields: [{ key: 'keywords', label: 'Keywords', type: 'tags', required: true }],
  },
] as const satisfies readonly CatalogItem[];

export const WORKFLOW_ACTIONS = [
  {
    key: 'send_whatsapp_message',
    label: 'Send WhatsApp message',
    description: 'Send a text message to the customer. Supports {{customer.name}} and {{order.number}}.',
    fields: [{ key: 'message', label: 'Message', type: 'textarea', required: true }],
  },
  {
    key: 'create_lead',
    label: 'Create lead',
    description: 'Create a lead for the customer if one is not already open.',
    fields: [
      { key: 'source', label: 'Source', type: 'text', defaultValue: 'automation' },
      { key: 'assignedUserId', label: 'Assign to', type: 'user' },
    ],
  },
  {
    key: 'update_lead',
    label: 'Update lead',
    description: 'Change the status of the lead in context.',
    fields: [
      {
        key: 'status',
        label: 'New status',
        type: 'select',
        required: true,
        options: LEAD_STATUS_OPTIONS,
      },
    ],
  },
  {
    key: 'assign_agent',
    label: 'Assign agent',
    description: 'Assign the conversation to a team member.',
    fields: [{ key: 'userId', label: 'Team member', type: 'user', required: true }],
  },
  {
    key: 'create_task',
    label: 'Create task',
    description: 'Create a follow-up task.',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'dueInDays', label: 'Due in (days)', type: 'number', defaultValue: 1 },
      { key: 'assignedUserId', label: 'Assign to', type: 'user' },
    ],
  },
  {
    key: 'create_order',
    label: 'Create order',
    description: 'Create a pending order for the customer with a fixed product.',
    fields: [
      { key: 'productId', label: 'Product', type: 'product', required: true },
      { key: 'quantity', label: 'Quantity', type: 'number', required: true, defaultValue: 1 },
    ],
  },
  {
    key: 'update_customer',
    label: 'Update customer',
    description: 'Add or remove customer tags.',
    fields: [
      { key: 'addTags', label: 'Add tags', type: 'tags' },
      { key: 'removeTags', label: 'Remove tags', type: 'tags' },
    ],
  },
  {
    key: 'notify_team',
    label: 'Notify team',
    description: 'Send an in-app notification to team members.',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'body', label: 'Message', type: 'textarea' },
      { key: 'userId', label: 'Only this member', type: 'user', help: 'Empty notifies admins and managers' },
    ],
  },
  {
    key: 'call_ai_agent',
    label: 'Call AI agent',
    description: 'Let an AI agent reply to the conversation.',
    fields: [{ key: 'agentId', label: 'AI agent', type: 'agent', required: true }],
  },
  {
    key: 'transfer_to_human',
    label: 'Transfer to human',
    description: 'Switch the conversation from AI to a human agent.',
    fields: [{ key: 'reason', label: 'Reason', type: 'text' }],
  },
  {
    key: 'delay',
    label: 'Wait',
    description: 'Pause the workflow before the next step.',
    fields: [{ key: 'minutes', label: 'Minutes', type: 'number', required: true, defaultValue: 5 }],
  },
] as const satisfies readonly CatalogItem[];

export type WorkflowTriggerKey = (typeof WORKFLOW_TRIGGERS)[number]['key'];
export type WorkflowConditionKey = (typeof WORKFLOW_CONDITIONS)[number]['key'];
export type WorkflowActionKey = (typeof WORKFLOW_ACTIONS)[number]['key'];

export const WORKFLOW_TRIGGER_KEYS = WORKFLOW_TRIGGERS.map((t) => t.key) as WorkflowTriggerKey[];

export function findCatalogItem(
  nodeType: 'TRIGGER' | 'CONDITION' | 'ACTION',
  key: string,
): CatalogItem | undefined {
  const list: readonly CatalogItem[] =
    nodeType === 'TRIGGER'
      ? WORKFLOW_TRIGGERS
      : nodeType === 'CONDITION'
        ? WORKFLOW_CONDITIONS
        : WORKFLOW_ACTIONS;
  return list.find((i) => i.key === key);
}
