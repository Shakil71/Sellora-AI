export interface WorkflowDraft {
  name: string;
  description?: string | null;
  nodes: Array<{ key: string; type: 'TRIGGER' | 'CONDITION' | 'ACTION'; subtype: string; label?: string | null; config: Record<string, unknown>; positionX: number; positionY: number }>;
  edges: Array<{ sourceKey: string; targetKey: string; sourceHandle?: 'yes' | 'no' | null }>;
}

export const WORKFLOW_TEMPLATES: Array<{ id: string; title: string; description: string; draft: WorkflowDraft }> = [
  {
    id: 'blank',
    title: 'Start from scratch',
    description: 'An empty workflow with a trigger to configure.',
    draft: {
      name: 'Untitled workflow',
      nodes: [{ key: 'trigger', type: 'TRIGGER', subtype: 'message.received', config: {}, positionX: 250, positionY: 40 }],
      edges: [],
    },
  },
  {
    id: 'lead-followup',
    title: 'Follow up new leads',
    description: 'Create a task and notify the team whenever a new lead arrives.',
    draft: {
      name: 'Follow up new leads',
      description: 'Creates a follow-up task for every new lead.',
      nodes: [
        { key: 'trigger', type: 'TRIGGER', subtype: 'lead.created', config: {}, positionX: 250, positionY: 40 },
        { key: 'task', type: 'ACTION', subtype: 'create_task', config: { title: 'Call {{lead.name}}', dueInDays: 1 }, positionX: 250, positionY: 190 },
        { key: 'notify', type: 'ACTION', subtype: 'notify_team', config: { title: 'New lead: {{lead.name}}' }, positionX: 250, positionY: 340 },
      ],
      edges: [
        { sourceKey: 'trigger', targetKey: 'task' },
        { sourceKey: 'task', targetKey: 'notify' },
      ],
    },
  },
  {
    id: 'order-thanks',
    title: 'Thank customers after payment',
    description: 'Send a WhatsApp thank-you when an order is paid.',
    draft: {
      name: 'Thank you after payment',
      nodes: [
        { key: 'trigger', type: 'TRIGGER', subtype: 'order.paid', config: {}, positionX: 250, positionY: 40 },
        { key: 'msg', type: 'ACTION', subtype: 'send_whatsapp_message', config: { message: 'Thank you {{customer.firstName}}! We received your payment for order {{order.number}} ({{order.total}}). We will let you know when it ships.' }, positionX: 250, positionY: 190 },
      ],
      edges: [{ sourceKey: 'trigger', targetKey: 'msg' }],
    },
  },
  {
    id: 'vip',
    title: 'Tag VIP customers',
    description: 'Tag customers with large orders and alert the team.',
    draft: {
      name: 'VIP customers',
      nodes: [
        { key: 'trigger', type: 'TRIGGER', subtype: 'order.created', config: {}, positionX: 250, positionY: 40 },
        { key: 'cond', type: 'CONDITION', subtype: 'order.amount', config: { operator: 'gte', value: 250 }, positionX: 250, positionY: 180 },
        { key: 'tag', type: 'ACTION', subtype: 'update_customer', config: { addTags: ['vip'] }, positionX: 80, positionY: 340 },
        { key: 'notify', type: 'ACTION', subtype: 'notify_team', config: { title: 'Large order {{order.number}}', body: '{{customer.name}} ordered {{order.total}}' }, positionX: 80, positionY: 480 },
      ],
      edges: [
        { sourceKey: 'trigger', targetKey: 'cond' },
        { sourceKey: 'cond', targetKey: 'tag', sourceHandle: 'yes' },
        { sourceKey: 'tag', targetKey: 'notify' },
      ],
    },
  },
  {
    id: 'after-hours',
    title: 'Route human requests',
    description: 'When customers ask for a person, hand over and create a task.',
    draft: {
      name: 'Route human requests',
      nodes: [
        { key: 'trigger', type: 'TRIGGER', subtype: 'message.received', config: {}, positionX: 250, positionY: 40 },
        { key: 'cond', type: 'CONDITION', subtype: 'message.contains', config: { keywords: ['agent', 'human', 'person', 'manager'] }, positionX: 250, positionY: 180 },
        { key: 'handoff', type: 'ACTION', subtype: 'transfer_to_human', config: { reason: 'Customer asked for a person' }, positionX: 80, positionY: 340 },
        { key: 'task', type: 'ACTION', subtype: 'create_task', config: { title: 'Reply to {{customer.name}}', dueInDays: 0 }, positionX: 80, positionY: 480 },
      ],
      edges: [
        { sourceKey: 'trigger', targetKey: 'cond' },
        { sourceKey: 'cond', targetKey: 'handoff', sourceHandle: 'yes' },
        { sourceKey: 'handoff', targetKey: 'task' },
      ],
    },
  },
  {
    id: 'winback',
    title: 'Win back inactive customers',
    description: 'Message customers who have been quiet for 60 days.',
    draft: {
      name: 'Win back inactive customers',
      nodes: [
        { key: 'trigger', type: 'TRIGGER', subtype: 'customer.inactive', config: { days: 60 }, positionX: 250, positionY: 40 },
        { key: 'msg', type: 'ACTION', subtype: 'send_whatsapp_message', config: { message: 'Hi {{customer.firstName}}, we miss you! Reply to see what is new this month.' }, positionX: 250, positionY: 190 },
      ],
      edges: [{ sourceKey: 'trigger', targetKey: 'msg' }],
    },
  },
];
