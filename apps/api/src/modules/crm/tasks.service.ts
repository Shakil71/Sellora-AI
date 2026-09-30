import { Injectable } from '@nestjs/common';
import { NotificationType, Prisma, Priority, TaskStatus } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { paginate, toPaginated } from '../../common/pagination';
import { ensureFound, ValidationError } from '../../common/errors';
import type { Actor } from '../../common/auth-context';

export const taskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
  dueDate: z.coerce.date().nullable().optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  leadId: z.string().uuid().nullable().optional(),
  dealId: z.string().uuid().nullable().optional(),
  conversationId: z.string().uuid().nullable().optional(),
  orderId: z.string().uuid().nullable().optional(),
});
export type TaskInput = z.infer<typeof taskSchema>;

export const taskListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  view: z.enum(['all', 'mine', 'overdue', 'today', 'open']).default('open'),
  customerId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
});

const include = {
  assignedUser: { select: { id: true, name: true, avatarUrl: true } },
  customer: { select: { id: true, name: true } },
  lead: { select: { id: true, name: true } },
  deal: { select: { id: true, name: true } },
  order: { select: { id: true, number: true } },
} satisfies Prisma.TaskInclude;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Every referenced record must belong to the same workspace. */
  private async validateRefs(tenantId: string, input: Partial<TaskInput>) {
    const checks: Array<Promise<unknown>> = [];
    if (input.assignedUserId)
      checks.push(this.prisma.userRole.findUnique({ where: { tenantId_userId: { tenantId, userId: input.assignedUserId } } }));
    if (input.customerId) checks.push(this.prisma.customer.findFirst({ where: { id: input.customerId, tenantId } }));
    if (input.leadId) checks.push(this.prisma.lead.findFirst({ where: { id: input.leadId, tenantId } }));
    if (input.dealId) checks.push(this.prisma.deal.findFirst({ where: { id: input.dealId, tenantId } }));
    if (input.conversationId) checks.push(this.prisma.conversation.findFirst({ where: { id: input.conversationId, tenantId } }));
    if (input.orderId) checks.push(this.prisma.order.findFirst({ where: { id: input.orderId, tenantId } }));
    const results = await Promise.all(checks);
    if (results.some((r) => !r)) throw new ValidationError('A linked record does not exist in this workspace.');
  }

  async list(tenantId: string, userId: string | null, q: z.infer<typeof taskListSchema>) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay.getTime() + 86400_000);
    const open = { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS] };
    const viewFilter: Prisma.TaskWhereInput =
      q.view === 'mine'
        ? { assignedUserId: userId ?? '00000000-0000-0000-0000-000000000000', status: open }
        : q.view === 'overdue'
          ? { dueDate: { lt: new Date() }, status: open }
          : q.view === 'today'
            ? { dueDate: { gte: startOfDay, lt: endOfDay }, status: open }
            : q.view === 'open'
              ? { status: open }
              : {};
    const where: Prisma.TaskWhereInput = {
      tenantId,
      ...viewFilter,
      ...(q.status ? { status: q.status } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.leadId ? { leadId: q.leadId } : {}),
      ...(q.dealId ? { dealId: q.dealId } : {}),
      ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.task.findMany({ where, include, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }], ...paginate(q) }),
      this.prisma.task.count({ where }),
    ]);
    return toPaginated(items, total, q);
  }

  async create(actor: Actor, input: TaskInput) {
    await this.validateRefs(actor.tenantId, input);
    const task = await this.prisma.task.create({
      data: { ...input, tenantId: actor.tenantId, createdById: actor.userId },
      include,
    });
    if (task.assignedUserId && task.assignedUserId !== actor.userId) {
      await this.notifications.notify(actor.tenantId, { userIds: [task.assignedUserId] }, {
        type: NotificationType.ASSIGNMENT,
        title: `New task: ${task.title}`,
        body: task.dueDate ? `Due ${task.dueDate.toDateString()}` : undefined,
        link: '/tasks',
      });
    }
    await this.audit.log(actor, { action: 'task.created', entityType: 'Task', entityId: task.id });
    return task;
  }

  async update(actor: Actor, id: string, input: Partial<TaskInput>) {
    const current = ensureFound(await this.prisma.task.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Task');
    await this.validateRefs(actor.tenantId, input);
    const completing = input.status === TaskStatus.DONE && current.status !== TaskStatus.DONE;
    const task = await this.prisma.task.update({
      where: { id },
      data: {
        ...input,
        ...(completing ? { completedAt: new Date() } : input.status && input.status !== TaskStatus.DONE ? { completedAt: null } : {}),
      },
      include,
    });
    if (input.assignedUserId && input.assignedUserId !== current.assignedUserId && input.assignedUserId !== actor.userId) {
      await this.notifications.notify(actor.tenantId, { userIds: [input.assignedUserId] }, {
        type: NotificationType.ASSIGNMENT,
        title: `Task assigned to you: ${task.title}`,
        link: '/tasks',
      });
    }
    await this.audit.log(actor, { action: 'task.updated', entityType: 'Task', entityId: id, metadata: { fields: Object.keys(input) } });
    return task;
  }

  async remove(actor: Actor, id: string) {
    ensureFound(await this.prisma.task.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Task');
    await this.prisma.task.delete({ where: { id } });
    await this.audit.log(actor, { action: 'task.deleted', entityType: 'Task', entityId: id });
    return { deleted: true };
  }
}
