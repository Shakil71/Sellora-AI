import { Injectable, Logger } from '@nestjs/common';
import {
  LeadStatus,
  NotificationType,
  OrderSource,
  Prisma,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowRunStatus,
  WorkflowStatus,
  WorkflowStepStatus,
} from '@prisma/client';
import { formatMoney } from '@sellora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { QueueService } from '../../queue/queue.module';
import { RealtimeService, REALTIME_EVENTS } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MessagingService } from '../conversations/messaging.service';
import { ConversationsService } from '../conversations/conversations.service';
import { LeadsService } from '../crm/leads.service';
import { TasksService } from '../crm/tasks.service';
import { CustomersService } from '../crm/customers.service';
import { OrdersService } from '../commerce/orders.service';
import { InventoryService } from '../commerce/inventory.service';
import { AgentRuntimeService } from '../ai/agent-runtime.service';
import { systemActor } from '../../common/auth-context';
import { renderTemplate } from '../../common/utils/text.util';

const MAX_STEPS = 60;
const LOOP_GUARD_SECONDS = 60;

type Cfg = Record<string, unknown>;

export interface RunContext {
  tenantId: string;
  timezone: string;
  currency: string;
  payload: Record<string, unknown>;
  customer?: { id: string; name: string; tags: string[]; email: string | null } | null;
  order?: { id: string; number: string; total: number; items: Array<{ productId: string | null }> } | null;
  lead?: { id: string; name: string; status: LeadStatus } | null;
  conversationId?: string | null;
}

const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : Number(v ?? d) || d);
const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(',').map((s) => s.trim()) : []).filter(Boolean);

export function compare(actual: number, operator: string, expected: number): boolean {
  switch (operator) {
    case 'gt':
      return actual > expected;
    case 'gte':
      return actual >= expected;
    case 'lt':
      return actual < expected;
    case 'lte':
      return actual <= expected;
    case 'eq':
      return Math.abs(actual - expected) < 0.0001;
    default:
      return false;
  }
}

export function inTimeWindow(cfg: Cfg, timezone: string, now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const day = parts.find((p) => p.type === 'weekday')!.value.toLowerCase().slice(0, 3);
  const hhmm = `${parts.find((p) => p.type === 'hour')!.value}:${parts.find((p) => p.type === 'minute')!.value}`;
  const days = list(cfg.days).map((d) => d.toLowerCase().slice(0, 3));
  if (days.length && !days.includes(day)) return false;
  const from = str(cfg.from) || '00:00';
  const to = str(cfg.to) || '23:59';
  return from <= to ? hhmm >= from && hhmm < to : hhmm >= from || hhmm < to;
}

/**
 * Executes workflow graphs. Runs are resumable: completed steps are stored in
 * the run context so retries never repeat side effects, and delays resume
 * from the waiting step via a delayed BullMQ job.
 */
@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly queues: QueueService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly messaging: MessagingService,
    private readonly conversations: ConversationsService,
    private readonly leads: LeadsService,
    private readonly tasks: TasksService,
    private readonly customers: CustomersService,
    private readonly orders: OrdersService,
    private readonly inventory: InventoryService,
    private readonly runtime: AgentRuntimeService,
  ) {}

  /** Starts runs for every active workflow listening to this event. */
  async handleEvent(tenantId: string, type: string, payload: Record<string, unknown>) {
    const workflows = await this.prisma.workflow.findMany({ where: { tenantId, status: WorkflowStatus.ACTIVE, triggerType: type }, select: { id: true } });
    const entity = str(payload.conversationId || payload.orderId || payload.leadId || payload.productId || payload.customerId);
    let started = 0;
    for (const wf of workflows) {
      // Loop guard: the same workflow cannot fire twice for the same record within a minute.
      if (entity) {
        const fresh = await this.redis.client.set(`wf:guard:${wf.id}:${type}:${entity}`, '1', 'EX', LOOP_GUARD_SECONDS, 'NX').catch(() => 'OK');
        if (!fresh) continue;
      }
      const run = await this.prisma.workflowRun.create({
        data: { tenantId, workflowId: wf.id, triggerType: type, triggerPayload: payload as Prisma.InputJsonValue },
      });
      await this.queues.runWorkflow(run.id);
      started++;
    }
    return started;
  }

  private async loadContext(tenantId: string, payload: Record<string, unknown>): Promise<RunContext> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true, currency: true } });
    const ctx: RunContext = { tenantId, timezone: tenant.timezone, currency: tenant.currency, payload, conversationId: (payload.conversationId as string) ?? null };
    if (payload.orderId) {
      const order = await this.prisma.order.findFirst({ where: { id: str(payload.orderId), tenantId }, include: { items: { select: { productId: true } } } });
      if (order) {
        ctx.order = { id: order.id, number: order.number, total: Number(order.total), items: order.items };
        ctx.conversationId ??= order.conversationId;
        payload.customerId ??= order.customerId;
      }
    }
    if (payload.leadId) {
      const lead = await this.prisma.lead.findFirst({ where: { id: str(payload.leadId), tenantId } });
      if (lead) {
        ctx.lead = { id: lead.id, name: lead.name, status: lead.status };
        payload.customerId ??= lead.customerId;
      }
    }
    if (ctx.conversationId && !payload.customerId) {
      const conv = await this.prisma.conversation.findFirst({ where: { id: ctx.conversationId, tenantId }, select: { customerId: true } });
      payload.customerId = conv?.customerId;
    }
    if (payload.customerId) {
      ctx.customer = await this.prisma.customer.findFirst({ where: { id: str(payload.customerId), tenantId }, select: { id: true, name: true, tags: true, email: true } });
    }
    return ctx;
  }

  private templateData(ctx: RunContext) {
    return {
      customer: { name: ctx.customer?.name ?? 'there', firstName: ctx.customer?.name?.split(' ')[0] ?? 'there' },
      order: ctx.order ? { number: ctx.order.number, total: formatMoney(ctx.order.total, ctx.currency) } : {},
      lead: ctx.lead ? { name: ctx.lead.name, status: ctx.lead.status } : {},
    };
  }

  private async ensureConversation(ctx: RunContext): Promise<string> {
    if (ctx.conversationId) return ctx.conversationId;
    if (!ctx.customer) throw new Error('No customer in context');
    const conv = await this.prisma.conversation.findFirst({ where: { tenantId: ctx.tenantId, customerId: ctx.customer.id }, orderBy: { lastMessageAt: 'desc' } });
    if (!conv) throw new Error('The customer has no conversation to message');
    ctx.conversationId = conv.id;
    return conv.id;
  }

  async evaluateCondition(node: WorkflowNode, ctx: RunContext): Promise<boolean> {
    const cfg = (node.config ?? {}) as Cfg;
    switch (node.subtype) {
      case 'customer.tag':
        return Boolean(ctx.customer?.tags.includes(str(cfg.tag).toLowerCase()));
      case 'order.amount':
        return ctx.order ? compare(ctx.order.total, str(cfg.operator), num(cfg.value)) : false;
      case 'order.product':
        return Boolean(ctx.order?.items.some((i) => i.productId === cfg.productId));
      case 'lead.status':
        return ctx.lead?.status === cfg.status;
      case 'inventory.level': {
        const productId = str(cfg.productId) || str(ctx.payload.productId);
        if (!productId) return false;
        const a = await this.inventory.availability(ctx.tenantId, productId);
        return compare(a.available, str(cfg.operator), num(cfg.value));
      }
      case 'time.window':
        return inTimeWindow(cfg, ctx.timezone);
      case 'channel.is':
        return str(ctx.payload.channel) === str(cfg.channel);
      case 'message.contains': {
        const text = str(ctx.payload.text).toLowerCase();
        return list(cfg.keywords).some((k) => text.includes(k.toLowerCase()));
      }
      default:
        throw new Error(`Unknown condition ${node.subtype}`);
    }
  }

  async executeAction(node: WorkflowNode, ctx: RunContext, workflowName: string): Promise<Record<string, unknown>> {
    const cfg = (node.config ?? {}) as Cfg;
    const actor = systemActor(ctx.tenantId, `Automation: ${workflowName}`);
    switch (node.subtype) {
      case 'send_whatsapp_message': {
        const conversationId = await this.ensureConversation(ctx);
        const text = renderTemplate(str(cfg.message), this.templateData(ctx)).trim();
        if (!text) throw new Error('Message is empty');
        const message = await this.messaging.queueOutbound(ctx.tenantId, conversationId, { kind: 'text', text }, { senderType: 'SYSTEM' });
        return { messageId: message.id };
      }
      case 'create_lead': {
        if (!ctx.customer) throw new Error('No customer in context');
        const open = await this.prisma.lead.findFirst({ where: { tenantId: ctx.tenantId, customerId: ctx.customer.id, status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } } });
        if (open) {
          ctx.lead = { id: open.id, name: open.name, status: open.status };
          return { skipped: 'Customer already has an open lead', leadId: open.id };
        }
        const lead = await this.leads.create(actor, {
          name: ctx.customer.name,
          email: ctx.customer.email,
          source: str(cfg.source) || 'automation',
          customerId: ctx.customer.id,
          assignedUserId: str(cfg.assignedUserId) || null,
        });
        ctx.lead = { id: lead.id, name: lead.name, status: lead.status };
        return { leadId: lead.id };
      }
      case 'update_lead': {
        let leadId = ctx.lead?.id;
        if (!leadId && ctx.customer) {
          leadId = (await this.prisma.lead.findFirst({ where: { tenantId: ctx.tenantId, customerId: ctx.customer.id }, orderBy: { createdAt: 'desc' } }))?.id;
        }
        if (!leadId) throw new Error('No lead in context');
        const lead = await this.leads.update(actor, leadId, { status: cfg.status as LeadStatus });
        ctx.lead = { id: lead.id, name: lead.name, status: lead.status };
        return { leadId, status: lead.status };
      }
      case 'assign_agent': {
        const conversationId = await this.ensureConversation(ctx);
        await this.conversations.assign(actor, conversationId, { userId: str(cfg.userId) });
        return { conversationId, userId: cfg.userId };
      }
      case 'create_task': {
        const task = await this.tasks.create(actor, {
          title: renderTemplate(str(cfg.title), this.templateData(ctx)).slice(0, 200) || 'Follow up',
          dueDate: cfg.dueInDays !== undefined && cfg.dueInDays !== '' ? new Date(Date.now() + num(cfg.dueInDays, 1) * 86400_000) : null,
          assignedUserId: str(cfg.assignedUserId) || null,
          customerId: ctx.customer?.id ?? null,
          leadId: ctx.lead?.id ?? null,
          orderId: ctx.order?.id ?? null,
          conversationId: ctx.conversationId ?? null,
        });
        return { taskId: task.id };
      }
      case 'create_order': {
        if (!ctx.customer) throw new Error('No customer in context');
        const order = await this.orders.create(
          actor,
          { customerId: ctx.customer.id, items: [{ productId: str(cfg.productId), quantity: Math.max(1, Math.round(num(cfg.quantity, 1))) }], conversationId: ctx.conversationId ?? null, notes: `Created by workflow "${workflowName}"` },
          { source: OrderSource.AUTOMATION },
        );
        return { orderId: order.id, number: order.number };
      }
      case 'update_customer': {
        if (!ctx.customer) throw new Error('No customer in context');
        const updated = await this.customers.addTags(ctx.tenantId, ctx.customer.id, list(cfg.addTags), list(cfg.removeTags));
        ctx.customer = { ...ctx.customer, tags: updated.tags };
        return { tags: updated.tags };
      }
      case 'notify_team': {
        const data = this.templateData(ctx);
        const count = await this.notifications.notify(ctx.tenantId, cfg.userId ? { userIds: [str(cfg.userId)] } : { roles: ['OWNER', 'ADMIN', 'MANAGER'] }, {
          type: NotificationType.SYSTEM,
          title: renderTemplate(str(cfg.title), data).slice(0, 200) || workflowName,
          body: renderTemplate(str(cfg.body), data).slice(0, 1000) || undefined,
          link: ctx.order ? `/orders/${ctx.order.id}` : ctx.conversationId ? `/inbox?conversation=${ctx.conversationId}` : ctx.lead ? `/leads/${ctx.lead.id}` : undefined,
        });
        return { notified: count };
      }
      case 'call_ai_agent': {
        const conversationId = await this.ensureConversation(ctx);
        await this.runtime.assignAndReply(ctx.tenantId, conversationId, str(cfg.agentId));
        return { conversationId, agentId: cfg.agentId };
      }
      case 'transfer_to_human': {
        const conversationId = await this.ensureConversation(ctx);
        await this.conversations.handoffToHuman(ctx.tenantId, conversationId, str(cfg.reason) || `Workflow "${workflowName}"`, 'Automation');
        return { conversationId };
      }
      default:
        throw new Error(`Unknown action ${node.subtype}`);
    }
  }

  /** Executes (or resumes) a run. Throws to let BullMQ retry transient failures. */
  async execute(runId: string, fromNodeKey?: string) {
    const run = await this.prisma.workflowRun.findUnique({ where: { id: runId }, include: { workflow: { include: { nodes: true, edges: true } } } });
    if (!run || run.status === WorkflowRunStatus.SUCCEEDED || run.status === WorkflowRunStatus.CANCELLED) return;
    const wf = run.workflow;
    const completed = new Set<string>(((run.context as { completed?: string[] } | null)?.completed ?? []) as string[]);
    await this.prisma.workflowRun.update({
      where: { id: runId },
      data: { status: WorkflowRunStatus.RUNNING, startedAt: run.startedAt ?? new Date(), attempts: { increment: 1 }, error: null },
    });

    const ctx = await this.loadContext(run.tenantId, { ...(run.triggerPayload as Record<string, unknown>) });
    const nodes = new Map(wf.nodes.map((n) => [n.key, n]));
    const outgoing = (key: string, handle?: string) => wf.edges.filter((e) => e.sourceKey === key && (handle === undefined || e.sourceHandle === handle)).map((e) => e.targetKey);

    const trigger = wf.nodes.find((n) => n.type === WorkflowNodeType.TRIGGER);
    if (!trigger) throw new Error('Workflow has no trigger');
    const queue: string[] = fromNodeKey ? outgoing(fromNodeKey) : [trigger.key];
    let steps = 0;
    let waiting = false;

    const persist = async () => {
      await this.prisma.workflowRun.update({ where: { id: runId }, data: { context: { completed: [...completed] } as Prisma.InputJsonValue } });
    };

    while (queue.length) {
      if (++steps > MAX_STEPS) throw new Error('Too many steps in one run');
      const key = queue.shift()!;
      const node = nodes.get(key);
      if (!node) continue;
      const startedAt = new Date();

      if (node.type === WorkflowNodeType.TRIGGER) {
        queue.push(...outgoing(key));
        continue;
      }
      if (node.type === WorkflowNodeType.CONDITION) {
        const result = await this.evaluateCondition(node, ctx);
        await this.step(run.tenantId, runId, node, WorkflowStepStatus.SUCCEEDED, { result }, undefined, startedAt);
        queue.push(...outgoing(key, result ? 'yes' : 'no'));
        continue;
      }
      // ACTION
      if (completed.has(key)) {
        queue.push(...outgoing(key));
        continue;
      }
      if (node.subtype === 'delay') {
        const minutes = Math.min(60 * 24 * 30, Math.max(1, num((node.config as Cfg).minutes, 5)));
        completed.add(key);
        await persist();
        await this.step(run.tenantId, runId, node, WorkflowStepStatus.SUCCEEDED, { resumeAt: new Date(Date.now() + minutes * 60_000).toISOString() }, undefined, startedAt);
        await this.queues.runWorkflow(runId, minutes * 60_000, key);
        waiting = true;
        continue;
      }
      try {
        const output = await this.executeAction(node, ctx, wf.name);
        completed.add(key);
        await persist();
        await this.step(run.tenantId, runId, node, WorkflowStepStatus.SUCCEEDED, output, undefined, startedAt);
        queue.push(...outgoing(key));
      } catch (err) {
        await this.step(run.tenantId, runId, node, WorkflowStepStatus.FAILED, undefined, (err as Error).message, startedAt);
        await this.prisma.workflowRun.update({ where: { id: runId }, data: { error: `${node.label || node.subtype}: ${(err as Error).message}`.slice(0, 1000), currentNodeKey: key } });
        throw err;
      }
    }

    if (waiting) {
      await this.prisma.workflowRun.update({ where: { id: runId }, data: { status: WorkflowRunStatus.WAITING } });
      return;
    }
    const finished = await this.prisma.workflowRun.update({ where: { id: runId }, data: { status: WorkflowRunStatus.SUCCEEDED, finishedAt: new Date(), currentNodeKey: null } });
    await this.prisma.workflow.update({ where: { id: wf.id }, data: { runCount: { increment: 1 }, lastRunAt: new Date() } });
    this.realtime.toPermission(run.tenantId, 'automation.view', REALTIME_EVENTS.WORKFLOW_COMPLETED, { runId, workflowId: wf.id, status: finished.status });
  }

  private async step(tenantId: string, runId: string, node: WorkflowNode, status: WorkflowStepStatus, output: unknown, error: string | undefined, startedAt: Date) {
    await this.prisma.workflowRunStep.create({
      data: {
        tenantId,
        runId,
        nodeKey: node.key,
        nodeType: node.type,
        subtype: node.subtype,
        status,
        output: output === undefined ? undefined : (JSON.parse(JSON.stringify(output)) as Prisma.InputJsonValue),
        error: error?.slice(0, 1000),
        startedAt,
        finishedAt: new Date(),
      },
    });
  }

  /** Called by the worker after the final retry fails. */
  async markFailed(runId: string, error: string) {
    const run = await this.prisma.workflowRun.findUnique({ where: { id: runId }, include: { workflow: true } });
    if (!run) return;
    await this.prisma.workflowRun.update({ where: { id: runId }, data: { status: WorkflowRunStatus.FAILED, finishedAt: new Date(), error: error.slice(0, 1000) } });
    await this.prisma.workflow.update({ where: { id: run.workflowId }, data: { failureCount: { increment: 1 }, lastRunAt: new Date() } });
    await this.notifications.notify(run.tenantId, { permission: 'automation.update' }, {
      type: NotificationType.WORKFLOW_FAILURE,
      title: `Workflow "${run.workflow.name}" failed`,
      body: error.slice(0, 300),
      link: `/automation/runs/${runId}`,
    });
    this.realtime.toPermission(run.tenantId, 'automation.view', REALTIME_EVENTS.WORKFLOW_COMPLETED, { runId, workflowId: run.workflowId, status: 'FAILED' });
  }

  /** Daily scan for the "customer inactive" trigger. */
  async scanInactiveCustomers() {
    const workflows = await this.prisma.workflow.findMany({ where: { status: WorkflowStatus.ACTIVE, triggerType: 'customer.inactive' }, include: { nodes: true } });
    let started = 0;
    for (const wf of workflows) {
      const trigger = wf.nodes.find((n) => n.type === WorkflowNodeType.TRIGGER);
      const days = Math.max(1, num((trigger?.config as Cfg | undefined)?.days, 30));
      const cutoff = new Date(Date.now() - days * 86400_000);
      const customers = await this.prisma.customer.findMany({
        where: { tenantId: wf.tenantId, lastInteractionAt: { lt: cutoff } },
        select: { id: true },
        take: 200,
        orderBy: { lastInteractionAt: 'asc' },
      });
      for (const c of customers) {
        // Once per customer per inactivity window.
        const recent = await this.prisma.workflowRun.findFirst({
          where: { workflowId: wf.id, createdAt: { gte: cutoff }, triggerPayload: { path: ['customerId'], equals: c.id } },
          select: { id: true },
        });
        if (recent) continue;
        const run = await this.prisma.workflowRun.create({
          data: { tenantId: wf.tenantId, workflowId: wf.id, triggerType: 'customer.inactive', triggerPayload: { customerId: c.id, days } },
        });
        await this.queues.runWorkflow(run.id);
        started++;
      }
    }
    if (started) this.logger.log(`Started ${started} inactive-customer workflow runs`);
    return started;
  }
}
