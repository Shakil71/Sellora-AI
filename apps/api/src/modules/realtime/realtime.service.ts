import { Global, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { Emitter } from '@socket.io/redis-emitter';
import type { Redis } from 'ioredis';
import { createRedisConnection } from '../../redis/redis.service';

export const REALTIME_EVENTS = {
  MESSAGE_NEW: 'message.new',
  MESSAGE_STATUS: 'message.status',
  CONVERSATION_UPDATED: 'conversation.updated',
  LEAD_UPDATED: 'lead.updated',
  ORDER_UPDATED: 'order.updated',
  NOTIFICATION_CREATED: 'notification.created',
  WORKFLOW_COMPLETED: 'workflow.completed',
  DOCUMENT_UPDATED: 'document.updated',
  TYPING: 'typing',
} as const;

export const rooms = {
  tenant: (tenantId: string) => `t:${tenantId}`,
  tenantPermission: (tenantId: string, permission: string) => `t:${tenantId}:p:${permission}`,
  user: (userId: string) => `u:${userId}`,
  conversation: (conversationId: string) => `c:${conversationId}`,
};

/** Permissions that map to realtime rooms a socket may join. */
export const REALTIME_PERMISSION_ROOMS = [
  'conversations.view',
  'orders.view',
  'crm.leads.view',
  'automation.view',
  'ai.knowledge.view',
] as const;

/**
 * Publishes realtime events through Redis so that both the API process and
 * the background worker can reach connected browsers.
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly redis: Redis;
  private readonly emitter: Emitter;

  constructor() {
    this.redis = createRedisConnection({ maxRetriesPerRequest: 2 });
    this.redis.on('error', (err) => this.logger.warn(`Realtime Redis error: ${err.message}`));
    this.emitter = new Emitter(this.redis, { key: 'sellora-socket' });
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }

  private safeEmit(room: string, event: string, data: unknown) {
    try {
      this.emitter.to(room).emit(event, data);
    } catch (err) {
      this.logger.warn(`Realtime emit failed (${event}): ${(err as Error).message}`);
    }
  }

  toTenant(tenantId: string, event: string, data: unknown) {
    this.safeEmit(rooms.tenant(tenantId), event, data);
  }

  toPermission(tenantId: string, permission: (typeof REALTIME_PERMISSION_ROOMS)[number], event: string, data: unknown) {
    this.safeEmit(rooms.tenantPermission(tenantId, permission), event, data);
  }

  toUser(userId: string, event: string, data: unknown) {
    this.safeEmit(rooms.user(userId), event, data);
  }

  toConversation(conversationId: string, event: string, data: unknown) {
    this.safeEmit(rooms.conversation(conversationId), event, data);
  }
}

@Global()
@Module({ providers: [RealtimeService], exports: [RealtimeService] })
export class RealtimeCoreModule {}
