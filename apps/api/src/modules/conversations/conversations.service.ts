import { Injectable } from '@nestjs/common';
import {
  ChannelType,
  ConversationHandler,
  ConversationStatus,
  MessageDirection,
  MessageSenderType,
  MessageStatus,
  MessageType,
  NotificationType,
  Prisma,
  Priority,
} from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ActivityService, EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService, REALTIME_EVENTS, rooms } from '../realtime/realtime.service';
import { QueueService } from '../../queue/queue.module';
import { ensureFound, ValidationError } from '../../common/errors';
import type { Actor } from '../../common/auth-context';

export const conversationListSchema = z.object({
  view: z.enum(['all', 'mine', 'unassigned', 'unread', 'ai', 'human']).default('all'),
  status: z.nativeEnum(ConversationStatus).optional(),
  statusGroup: z.enum(['active', 'closed', 'any']).default('active'),
  channel: z.nativeEnum(ChannelType).optional(),
  search: z.string().trim().max(100).optional(),
  assignedUserId: z.string().uuid().optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  hasSummary: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

export const assignSchema = z.object({
  userId: z.string().uuid().nullable(),
  team: z.string().trim().max(60).nullable().optional(),
});

export const handlerSchema = z.object({
  handler: z.nativeEnum(ConversationHandler),
  agentId: z.string().uuid().optional(),
  reason: z.string().trim().max(300).optional(),
});

export const statusSchema = z.object({ status: z.nativeEnum(ConversationStatus) });

export const conversationUpdateSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  priority: z.nativeEnum(Priority).optional(),
  subject: z.string().trim().max(200).nullable().optional(),
});

export const listInclude = {
  customer: { select: { id: true, name: true, avatarUrl: true, whatsappNumber: true, phone: true, tags: true } },
  assignedUser: { select: { id: true, name: true, avatarUrl: true } },
  aiAgent: { select: { id: true, name: true, avatarUrl: true } },
  whatsappAccount: { select: { id: true, name: true, displayPhoneNumber: true } },
} satisfies Prisma.ConversationInclude;

const ACTIVE: ConversationStatus[] = [ConversationStatus.OPEN, ConversationStatus.PENDING];
const CLOSED: ConversationStatus[] = [ConversationStatus.RESOLVED, ConversationStatus.CLOSED];

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly queues: QueueService,
  ) {}

  /** Cursor-paginated inbox list, newest activity first. */
  async list(tenantId: string, userId: string | null, q: z.infer<typeof conversationListSchema>) {
    const where: Prisma.ConversationWhereInput = {
      tenantId,
      ...(q.status ? { status: q.status } : q.statusGroup === 'active' ? { status: { in: ACTIVE } } : q.statusGroup === 'closed' ? { status: { in: CLOSED } } : {}),
      ...(q.channel ? { channel: q.channel } : {}),
      ...(q.assignedUserId ? { assignedUserId: q.assignedUserId } : {}),
      ...(q.view === 'mine' ? { assignedUserId: userId ?? '00000000-0000-0000-0000-000000000000' } : {}),
      ...(q.view === 'unassigned' ? { assignedUserId: null, handler: ConversationHandler.HUMAN } : {}),
      ...(q.view === 'unread' ? { unreadCount: { gt: 0 } } : {}),
      ...(q.view === 'ai' ? { handler: ConversationHandler.AI } : {}),
      ...(q.view === 'human' ? { handler: ConversationHandler.HUMAN } : {}),
      ...(q.hasSummary === true ? { summary: { not: null } } : {}),
      ...(q.cursor ? { lastMessageAt: { lt: new Date(q.cursor) } } : {}),
      ...(q.search
        ? {
            OR: [
              { customer: { name: { contains: q.search, mode: 'insensitive' } } },
              { customer: { whatsappNumber: { contains: q.search } } },
              { customer: { phone: { contains: q.search } } },
              { lastMessagePreview: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const items = await this.prisma.conversation.findMany({
      where,
      include: listInclude,
      orderBy: { lastMessageAt: 'desc' },
      take: q.limit + 1,
    });
    const hasMore = items.length > q.limit;
    const page = hasMore ? items.slice(0, q.limit) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1]!.lastMessageAt.toISOString() : null };
  }

  async counts(tenantId: string, userId: string | null) {
    const base = { tenantId, status: { in: ACTIVE } };
    const [all, mine, unassigned, unread, ai, human] = await Promise.all([
      this.prisma.conversation.count({ where: base }),
      this.prisma.conversation.count({ where: { ...base, assignedUserId: userId ?? undefined } }),
      this.prisma.conversation.count({ where: { ...base, assignedUserId: null, handler: ConversationHandler.HUMAN } }),
      this.prisma.conversation.count({ where: { ...base, unreadCount: { gt: 0 } } }),
      this.prisma.conversation.count({ where: { ...base, handler: ConversationHandler.AI } }),
      this.prisma.conversation.count({ where: { ...base, handler: ConversationHandler.HUMAN } }),
    ]);
    return { all, mine: userId ? mine : 0, unassigned, unread, ai, human };
  }

  async get(tenantId: string, id: string) {
    const conversation = ensureFound(
      await this.prisma.conversation.findFirst({
        where: { id, tenantId },
        include: {
          ...listInclude,
          customer: {
            select: {
              id: true, name: true, email: true, phone: true, whatsappNumber: true, avatarUrl: true, tags: true, notes: true,
              company: true, city: true, country: true, addressLine: true, totalSpent: true, ordersCount: true, lastInteractionAt: true, createdAt: true,
            },
          },
        },
      }),
      'Conversation',
    );
    const [orders, leads, openTasks] = await Promise.all([
      this.prisma.order.findMany({
        where: { tenantId, customerId: conversation.customerId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, number: true, status: true, total: true, currency: true, createdAt: true, paymentStatus: true },
      }),
      this.prisma.lead.findMany({ where: { tenantId, customerId: conversation.customerId }, orderBy: { createdAt: 'desc' }, take: 3, select: { id: true, name: true, status: true, score: true } }),
      this.prisma.task.findMany({ where: { tenantId, conversationId: id, status: { in: ['TODO', 'IN_PROGRESS'] } }, take: 5 }),
    ]);
    const windowOpen = conversation.channel !== ChannelType.WHATSAPP || (conversation.lastInboundAt ? Date.now() - conversation.lastInboundAt.getTime() < 24 * 3600 * 1000 : false);
    return { ...conversation, orders, leads, openTasks, windowOpen };
  }

  async messages(tenantId: string, conversationId: string, q: { before?: string; limit: number }) {
    ensureFound(await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId }, select: { id: true } }), 'Conversation');
    const rows = await this.prisma.message.findMany({
      where: { tenantId, conversationId, ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}) },
      include: { senderUser: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
      take: q.limit + 1,
    });
    const hasMore = rows.length > q.limit;
    const page = (hasMore ? rows.slice(0, q.limit) : rows).reverse();
    return { items: page, nextCursor: hasMore ? page[0]!.createdAt.toISOString() : null };
  }

  async markRead(tenantId: string, id: string) {
    const conversation = ensureFound(await this.prisma.conversation.findFirst({ where: { id, tenantId } }), 'Conversation');
    if (conversation.unreadCount > 0) {
      await this.prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } });
      this.broadcastUpdate(tenantId, id, { unreadCount: 0 });
    }
    return { unreadCount: 0 };
  }

  broadcastUpdate(tenantId: string, id: string, patch: Record<string, unknown> = {}) {
    this.realtime.toPermission(tenantId, 'conversations.view', REALTIME_EVENTS.CONVERSATION_UPDATED, { id, ...patch });
  }

  /** Adds a system line to the thread (assignment, handoff, status changes). */
  async systemMessage(tenantId: string, conversationId: string, body: string, metadata?: Record<string, unknown>) {
    const message = await this.prisma.message.create({
      data: {
        tenantId,
        conversationId,
        direction: MessageDirection.OUTBOUND,
        senderType: MessageSenderType.SYSTEM,
        type: MessageType.SYSTEM,
        body,
        status: MessageStatus.SENT,
        metadata: metadata as Prisma.InputJsonValue | undefined,
      },
    });
    this.realtime.toConversation(conversationId, REALTIME_EVENTS.MESSAGE_NEW, message);
    this.realtime.toPermission(tenantId, 'conversations.view', REALTIME_EVENTS.MESSAGE_NEW, { conversationId, message });
    return message;
  }

  async assign(actor: Actor, id: string, input: z.infer<typeof assignSchema>) {
    const conversation = ensureFound(await this.prisma.conversation.findFirst({ where: { id, tenantId: actor.tenantId }, include: { customer: true } }), 'Conversation');
    let assigneeName = 'nobody';
    if (input.userId) {
      const member = await this.prisma.userRole.findUnique({
        where: { tenantId_userId: { tenantId: actor.tenantId, userId: input.userId } },
        include: { user: { select: { name: true } } },
      });
      if (!member || member.status !== 'ACTIVE') throw new ValidationError('The selected team member is not active in this workspace.');
      assigneeName = member.user.name;
    }
    await this.prisma.conversation.update({
      where: { id },
      data: {
        assignedUserId: input.userId,
        ...(input.team !== undefined ? { assignedTeam: input.team } : {}),
        // Assigning a person implies human handling.
        ...(input.userId ? { handler: ConversationHandler.HUMAN } : {}),
      },
    });
    await this.systemMessage(actor.tenantId, id, input.userId ? `${actor.name} assigned the conversation to ${assigneeName}` : `${actor.name} unassigned the conversation`);
    if (input.userId && input.userId !== actor.userId) {
      await this.notifications.notify(actor.tenantId, { userIds: [input.userId] }, {
        type: NotificationType.ASSIGNMENT,
        title: `Conversation with ${conversation.customer.name} assigned to you`,
        link: `/inbox?conversation=${id}`,
      });
    }
    await this.audit.log(actor, { action: 'conversation.assigned', entityType: 'Conversation', entityId: id, metadata: { userId: input.userId, team: input.team } });
    this.broadcastUpdate(actor.tenantId, id);
    return this.get(actor.tenantId, id);
  }

  /** Human takeover / AI takeover. */
  async setHandler(actor: Actor, id: string, input: z.infer<typeof handlerSchema>) {
    const conversation = ensureFound(await this.prisma.conversation.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Conversation');
    let agentId = conversation.aiAgentId;
    if (input.handler === ConversationHandler.AI) {
      const agent = input.agentId
        ? await this.prisma.aIAgent.findFirst({ where: { id: input.agentId, tenantId: actor.tenantId, isActive: true } })
        : agentId
          ? await this.prisma.aIAgent.findFirst({ where: { id: agentId, tenantId: actor.tenantId, isActive: true } })
          : await this.prisma.aIAgent.findFirst({ where: { tenantId: actor.tenantId, isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
      if (!agent) throw new ValidationError('Create and activate an AI agent before handing the conversation to AI.');
      agentId = agent.id;
    }
    await this.prisma.conversation.update({
      where: { id },
      data: {
        handler: input.handler,
        aiAgentId: agentId,
        ...(input.handler === ConversationHandler.HUMAN
          ? { handoffAt: new Date(), handoffReason: input.reason ?? 'Taken over by a team member', assignedUserId: conversation.assignedUserId ?? actor.userId }
          : { handoffReason: null }),
      },
    });
    await this.systemMessage(
      actor.tenantId,
      id,
      input.handler === ConversationHandler.HUMAN ? `${actor.name} took over the conversation from AI` : `${actor.name} handed the conversation to the AI agent`,
    );
    await this.audit.log(actor, { action: 'conversation.handler_changed', entityType: 'Conversation', entityId: id, metadata: { handler: input.handler } });
    this.broadcastUpdate(actor.tenantId, id);
    return this.get(actor.tenantId, id);
  }

  /** Called by the AI transferToHuman tool and the automation engine. */
  async handoffToHuman(tenantId: string, id: string, reason: string, by = 'AI agent') {
    const conversation = await this.prisma.conversation.findFirst({ where: { id, tenantId }, include: { customer: true } });
    if (!conversation) return;
    await this.prisma.conversation.update({
      where: { id },
      data: { handler: ConversationHandler.HUMAN, handoffAt: new Date(), handoffReason: reason.slice(0, 300), status: ConversationStatus.OPEN },
    });
    await this.systemMessage(tenantId, id, `${by} transferred the conversation to a human: ${reason}`);
    await this.notifications.notify(
      tenantId,
      conversation.assignedUserId ? { userIds: [conversation.assignedUserId] } : { permission: 'conversations.assign' },
      {
        type: NotificationType.AI_ESCALATION,
        title: `${conversation.customer.name} needs a human`,
        body: reason,
        link: `/inbox?conversation=${id}`,
      },
    );
    await this.queues.aiSummarize(tenantId, id).catch(() => undefined);
    this.broadcastUpdate(tenantId, id);
  }

  async setStatus(actor: Actor, id: string, status: ConversationStatus) {
    const conversation = ensureFound(await this.prisma.conversation.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Conversation');
    if (conversation.status === status) return this.get(actor.tenantId, id);
    await this.prisma.conversation.update({
      where: { id },
      data: {
        status,
        ...(status === ConversationStatus.RESOLVED ? { resolvedAt: new Date(), unreadCount: 0 } : {}),
        ...(status === ConversationStatus.CLOSED ? { closedAt: new Date(), unreadCount: 0 } : {}),
      },
    });
    await this.systemMessage(actor.tenantId, id, `${actor.name} marked the conversation as ${status.toLowerCase()}`);
    await this.audit.log(actor, { action: 'conversation.status_changed', entityType: 'Conversation', entityId: id, metadata: { from: conversation.status, to: status } });
    if (status === ConversationStatus.RESOLVED) {
      await this.events.emit(actor.tenantId, 'conversation.resolved', { conversationId: id, customerId: conversation.customerId, channel: conversation.channel });
      await this.queues.aiSummarize(actor.tenantId, id).catch(() => undefined);
    }
    if (ACTIVE.includes(status) && CLOSED.includes(conversation.status)) {
      await this.events.emit(actor.tenantId, 'conversation.opened', { conversationId: id, customerId: conversation.customerId, channel: conversation.channel });
    }
    this.broadcastUpdate(actor.tenantId, id, { status });
    return this.get(actor.tenantId, id);
  }

  async update(actor: Actor, id: string, input: z.infer<typeof conversationUpdateSchema>) {
    ensureFound(await this.prisma.conversation.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Conversation');
    await this.prisma.conversation.update({ where: { id }, data: { ...input, ...(input.tags ? { tags: input.tags.map((t) => t.toLowerCase()) } : {}) } });
    this.broadcastUpdate(actor.tenantId, id);
    return this.get(actor.tenantId, id);
  }

  /** Creates an internal test conversation (no WhatsApp needed) to try the AI end-to-end. */
  async createTestConversation(actor: Actor, input: { customerName: string; agentId?: string }) {
    const agent = input.agentId
      ? await this.prisma.aIAgent.findFirst({ where: { id: input.agentId, tenantId: actor.tenantId } })
      : await this.prisma.aIAgent.findFirst({ where: { tenantId: actor.tenantId, isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
    const customer = await this.prisma.customer.create({
      data: { tenantId: actor.tenantId, name: input.customerName, source: 'test', tags: ['test'] },
    });
    const conversation = await this.prisma.conversation.create({
      data: {
        tenantId: actor.tenantId,
        channel: ChannelType.TEST,
        customerId: customer.id,
        handler: agent ? ConversationHandler.AI : ConversationHandler.HUMAN,
        aiAgentId: agent?.id,
        subject: 'Test conversation',
        tags: ['test'],
      },
    });
    await this.systemMessage(actor.tenantId, conversation.id, 'Test conversation created. Messages you send as the customer run through the real AI agent and tools. Nothing is sent to WhatsApp.');
    await this.activity.record(actor.tenantId, 'CUSTOMER', customer.id, 'test_conversation', 'Test conversation started', actor);
    return this.get(actor.tenantId, conversation.id);
  }

  joinRoomName(id: string) {
    return rooms.conversation(id);
  }
}
