import { Injectable } from '@nestjs/common';
import { Prisma, WorkflowNodeType, WorkflowRunStatus, WorkflowStatus } from '@prisma/client';
import { z } from 'zod';
import { findCatalogItem, WORKFLOW_ACTIONS, WORKFLOW_CONDITIONS, WORKFLOW_TRIGGERS, WORKFLOW_TRIGGER_KEYS } from '@sellora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UsageService } from '../billing/usage.service';
import { QueueService } from '../../queue/queue.module';
import { ensureFound, ValidationError } from '../../common/errors';
import { paginate, toPaginated } from '../../common/pagination';
import type { Actor } from '../../common/auth-context';

const nodeSchema = z.object({
  key: z.string().trim().min(1).max(60).regex(/^[\w-]+$/),
  type: z.nativeEnum(WorkflowNodeType),
  subtype: z.string().trim().min(1).max(60),
  label: z.string().trim().max(100).nullable().optional(),
  config: z.record(z.string().max(60), z.unknown()).default({}),
  positionX: z.number().min(-100000).max(100000).default(0),
  positionY: z.number().min(-100000).max(100000).default(0),
});

const edgeSchema = z.object({
  sourceKey: z.string().min(1).max(60),
  targetKey: z.string().min(1).max(60),
  sourceHandle: z.enum(['yes', 'no']).nullable().optional(),
});

export const workflowSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  nodes: z.array(nodeSchema).min(1).max(50),
  edges: z.array(edgeSchema).max(100),
});
export type WorkflowInput = z.infer<typeof workflowSchema>;

export const runListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  workflowId: z.string().uuid().optional(),
  status: z.nativeEnum(WorkflowRunStatus).optional(),
});

export const manualRunSchema = z.object({
  customerId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  text: z.string().max(1000).optional(),
});

/** Validates the graph: one trigger, known node types, valid edges, no cycles, required fields. */
export function validateWorkflowGraph(input: WorkflowInput, strict: boolean): { triggerType: string; errors: string[] } {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const n of input.nodes) {
    if (keys.has(n.key)) errors.push(`Duplicate node key ${n.key}`);
    keys.add(n.key);
    const item = findCatalogItem(n.type, n.subtype);
    if (!item) {
      errors.push(`Unknown ${n.type.toLowerCase()} "${n.subtype}"`);
      continue;
    }
    if (strict) {
      for (const f of item.fields) {
        const v = (n.config as Record<string, unknown>)[f.key];
        if (f.required && (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0))) {
          errors.push(`${n.label || item.label}: "${f.label}" is required`);
        }
      }
    }
  }
  const triggers = input.nodes.filter((n) => n.type === WorkflowNodeType.TRIGGER);
  if (triggers.length !== 1) errors.push('A workflow needs exactly one trigger');
  for (const e of input.edges) {
    if (!keys.has(e.sourceKey) || !keys.has(e.targetKey)) errors.push('An edge points to a missing step');
    if (e.sourceKey === e.targetKey) errors.push('A step cannot connect to itself');
    const source = input.nodes.find((n) => n.key === e.sourceKey);
    if (source?.type === WorkflowNodeType.CONDITION && !e.sourceHandle) errors.push('Condition branches must be "yes" or "no"');
    if (input.nodes.find((n) => n.key === e.targetKey)?.type === WorkflowNodeType.TRIGGER) errors.push('Nothing can connect into the trigger');
  }
  // Cycle detection (DFS)
  const adj = new Map<string, string[]>();
  input.edges.forEach((e) => adj.set(e.sourceKey, [...(adj.get(e.sourceKey) ?? []), e.targetKey]));
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (k: string): boolean => {
    if (state.get(k) === 1) return true;
    if (state.get(k) === 2) return false;
    state.set(k, 1);
    for (const next of adj.get(k) ?? []) if (visit(next)) return true;
    state.set(k, 2);
    return false;
  };
  if ([...keys].some((k) => visit(k))) errors.push('Workflows cannot contain loops');
  if (strict && triggers.length === 1 && !input.edges.some((e) => e.sourceKey === triggers[0]!.key)) errors.push('Connect the trigger to at least one step');
  return { triggerType: triggers[0]?.subtype ?? '', errors: [...new Set(errors)] };
}

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly usage: UsageService,
    private readonly queues: QueueService,
  ) {}

  catalog() {
    return { triggers: WORKFLOW_TRIGGERS, conditions: WORKFLOW_CONDITIONS, actions: WORKFLOW_ACTIONS };
  }

  async list(tenantId: string) {
    const workflows = await this.prisma.workflow.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { nodes: true } } },
    });
    return workflows.map(({ _count, ...w }) => ({ ...w, stepCount: _count.nodes }));
  }

  async get(tenantId: string, id: string) {
    return ensureFound(
      await this.prisma.workflow.findFirst({ where: { id, tenantId }, include: { nodes: true, edges: true } }),
      'Workflow',
    );
  }

  private async assertReferences(tenantId: string, input: WorkflowInput) {
    const ids = { user: new Set<string>(), product: new Set<string>(), agent: new Set<string>() };
    for (const n of input.nodes) {
      const cfg = n.config as Record<string, unknown>;
      for (const [k, v] of Object.entries(cfg)) {
        if (typeof v !== 'string' || !v) continue;
        if (k === 'userId' || k === 'assignedUserId') ids.user.add(v);
        if (k === 'productId') ids.product.add(v);
        if (k === 'agentId') ids.agent.add(v);
      }
    }
    const [users, products, agents] = await Promise.all([
      ids.user.size ? this.prisma.userRole.count({ where: { tenantId, userId: { in: [...ids.user] } } }) : 0,
      ids.product.size ? this.prisma.product.count({ where: { tenantId, id: { in: [...ids.product] } } }) : 0,
      ids.agent.size ? this.prisma.aIAgent.count({ where: { tenantId, id: { in: [...ids.agent] } } }) : 0,
    ]);
    if (users !== ids.user.size || products !== ids.product.size || agents !== ids.agent.size) {
      throw new ValidationError('A step references a team member, product or AI agent that does not exist in this workspace.');
    }
  }

  private async writeGraph(tx: Prisma.TransactionClient, tenantId: string, workflowId: string, input: WorkflowInput) {
    await tx.workflowNode.deleteMany({ where: { workflowId } });
    await tx.workflowEdge.deleteMany({ where: { workflowId } });
    await tx.workflowNode.createMany({
      data: input.nodes.map((n) => ({ ...n, config: n.config as Prisma.InputJsonValue, tenantId, workflowId })),
    });
    await tx.workflowEdge.createMany({ data: input.edges.map((e) => ({ ...e, sourceHandle: e.sourceHandle ?? null, tenantId, workflowId })) });
  }

  async create(actor: Actor, input: WorkflowInput) {
    await this.usage.assertWithin(actor.tenantId, 'workflows');
    const { triggerType, errors } = validateWorkflowGraph(input, false);
    if (errors.length) throw new ValidationError(errors[0]!, errors);
    await this.assertReferences(actor.tenantId, input);
    const workflow = await this.prisma.$transaction(async (tx) => {
      const w = await tx.workflow.create({
        data: { tenantId: actor.tenantId, name: input.name, description: input.description, triggerType, createdById: actor.userId },
      });
      await this.writeGraph(tx, actor.tenantId, w.id, input);
      return w;
    });
    await this.audit.log(actor, { action: 'workflow.created', entityType: 'Workflow', entityId: workflow.id, metadata: { name: workflow.name, trigger: triggerType } });
    return this.get(actor.tenantId, workflow.id);
  }

  async update(actor: Actor, id: string, input: WorkflowInput) {
    const current = await this.get(actor.tenantId, id);
    const strict = current.status === WorkflowStatus.ACTIVE;
    const { triggerType, errors } = validateWorkflowGraph(input, strict);
    if (errors.length) throw new ValidationError(errors[0]!, errors);
    await this.assertReferences(actor.tenantId, input);
    await this.prisma.$transaction(async (tx) => {
      await tx.workflow.update({ where: { id }, data: { name: input.name, description: input.description, triggerType, version: { increment: 1 } } });
      await this.writeGraph(tx, actor.tenantId, id, input);
    });
    await this.audit.log(actor, { action: 'workflow.updated', entityType: 'Workflow', entityId: id, metadata: { name: input.name, version: current.version + 1 } });
    return this.get(actor.tenantId, id);
  }

  async setStatus(actor: Actor, id: string, status: WorkflowStatus) {
    const wf = await this.get(actor.tenantId, id);
    if (status === WorkflowStatus.ACTIVE) {
      const { errors } = validateWorkflowGraph(
        {
          name: wf.name,
          nodes: wf.nodes.map((n) => ({ ...n, config: (n.config ?? {}) as Record<string, unknown> })),
          edges: wf.edges.map((e) => ({ sourceKey: e.sourceKey, targetKey: e.targetKey, sourceHandle: e.sourceHandle as 'yes' | 'no' | null })),
        },
        true,
      );
      if (errors.length) throw new ValidationError(`Fix these issues before activating: ${errors.join('; ')}`, errors);
      if (!(WORKFLOW_TRIGGER_KEYS as string[]).includes(wf.triggerType)) throw new ValidationError('Unknown trigger');
    }
    await this.prisma.workflow.update({ where: { id }, data: { status } });
    await this.audit.log(actor, { action: 'workflow.status_changed', entityType: 'Workflow', entityId: id, metadata: { status } });
    return this.get(actor.tenantId, id);
  }

  async remove(actor: Actor, id: string) {
    const wf = await this.get(actor.tenantId, id);
    await this.prisma.workflow.delete({ where: { id } });
    await this.audit.log(actor, { action: 'workflow.deleted', entityType: 'Workflow', entityId: id, metadata: { name: wf.name } });
    return { deleted: true };
  }

  async duplicate(actor: Actor, id: string) {
    const wf = await this.get(actor.tenantId, id);
    return this.create(actor, {
      name: `${wf.name} (copy)`.slice(0, 100),
      description: wf.description,
      nodes: wf.nodes.map((n) => ({ key: n.key, type: n.type, subtype: n.subtype, label: n.label, config: n.config as Record<string, unknown>, positionX: n.positionX, positionY: n.positionY })),
      edges: wf.edges.map((e) => ({ sourceKey: e.sourceKey, targetKey: e.targetKey, sourceHandle: e.sourceHandle as 'yes' | 'no' | null })),
    });
  }

  /** Starts a run manually with a chosen context (Run now / test). */
  async runManually(actor: Actor, id: string, payload: z.infer<typeof manualRunSchema>) {
    const wf = await this.get(actor.tenantId, id);
    const checks: Array<Promise<unknown>> = [];
    if (payload.customerId) checks.push(this.prisma.customer.findFirst({ where: { id: payload.customerId, tenantId: actor.tenantId } }));
    if (payload.orderId) checks.push(this.prisma.order.findFirst({ where: { id: payload.orderId, tenantId: actor.tenantId } }));
    if (payload.leadId) checks.push(this.prisma.lead.findFirst({ where: { id: payload.leadId, tenantId: actor.tenantId } }));
    if (payload.conversationId) checks.push(this.prisma.conversation.findFirst({ where: { id: payload.conversationId, tenantId: actor.tenantId } }));
    if (payload.productId) checks.push(this.prisma.product.findFirst({ where: { id: payload.productId, tenantId: actor.tenantId } }));
    if ((await Promise.all(checks)).some((r) => !r)) throw new ValidationError('A selected record does not exist in this workspace.');
    const run = await this.prisma.workflowRun.create({
      data: { tenantId: actor.tenantId, workflowId: wf.id, triggerType: wf.triggerType, triggerPayload: { ...payload, manual: true, startedBy: actor.name } as Prisma.InputJsonValue },
    });
    await this.queues.runWorkflow(run.id);
    await this.audit.log(actor, { action: 'workflow.run_manually', entityType: 'Workflow', entityId: id, metadata: { runId: run.id } });
    return run;
  }

  async listRuns(tenantId: string, q: z.infer<typeof runListSchema>) {
    const where: Prisma.WorkflowRunWhereInput = {
      tenantId,
      ...(q.workflowId ? { workflowId: q.workflowId } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const [items, total, counts] = await Promise.all([
      this.prisma.workflowRun.findMany({
        where,
        include: { workflow: { select: { id: true, name: true } }, _count: { select: { steps: true } } },
        orderBy: { createdAt: 'desc' },
        ...paginate(q),
      }),
      this.prisma.workflowRun.count({ where }),
      this.prisma.workflowRun.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
    ]);
    return { ...toPaginated(items, total, q), statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
  }

  async getRun(tenantId: string, id: string) {
    return ensureFound(
      await this.prisma.workflowRun.findFirst({
        where: { id, tenantId },
        include: { workflow: { select: { id: true, name: true, nodes: { select: { key: true, label: true, subtype: true, type: true } } } }, steps: { orderBy: { startedAt: 'asc' } } },
      }),
      'Workflow run',
    );
  }

  async retryRun(actor: Actor, id: string) {
    const run = await this.getRun(actor.tenantId, id);
    if (run.status !== WorkflowRunStatus.FAILED) throw new ValidationError('Only failed runs can be retried.');
    await this.prisma.workflowRun.update({ where: { id }, data: { status: WorkflowRunStatus.QUEUED, error: null } });
    await this.queues.runWorkflow(id);
    await this.audit.log(actor, { action: 'workflow.run_retried', entityType: 'WorkflowRun', entityId: id });
    return { queued: true };
  }
}
