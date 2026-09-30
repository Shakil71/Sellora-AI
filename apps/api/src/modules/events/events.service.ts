import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { WorkflowTriggerKey } from '@sellora/shared';
import { QueueService } from '../../queue/queue.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Domain event bus. Events are pushed to the automation queue where matching
 * workflows are started. Emitting never fails the calling business action.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(private readonly queues: QueueService) {}

  async emit(tenantId: string, type: WorkflowTriggerKey, payload: Record<string, unknown>) {
    try {
      await this.queues.automationEvent(tenantId, type, payload);
    } catch (err) {
      this.logger.warn(`Could not publish event ${type}: ${(err as Error).message}`);
    }
  }
}

export type ActivityEntity = 'CUSTOMER' | 'LEAD' | 'DEAL' | 'ORDER' | 'CONVERSATION';

/** Timeline entries shown on customer, lead, deal and order pages. */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    tenantId: string,
    entityType: ActivityEntity,
    entityId: string,
    type: string,
    description: string,
    actor?: { userId?: string | null; name?: string | null },
    metadata?: Record<string, unknown>,
  ) {
    try {
      await this.prisma.activity.create({
        data: {
          tenantId,
          entityType,
          entityId,
          type,
          description: description.slice(0, 500),
          actorId: actor?.userId ?? null,
          actorName: actor?.name ?? null,
          metadata: metadata as Prisma.InputJsonValue | undefined,
        },
      });
    } catch {
      /* timeline entries are best-effort */
    }
  }

  list(tenantId: string, entityType: ActivityEntity, entityId: string, take = 50) {
    return this.prisma.activity.findMany({
      where: { tenantId, entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
