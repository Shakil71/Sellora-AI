import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import { JOBS, QUEUES } from '../queue/queue.constants';
import { QueueService } from '../queue/queue.module';
import { PrismaService } from '../prisma/prisma.service';
import { InboundService } from '../modules/conversations/inbound.service';
import { MessagingService } from '../modules/conversations/messaging.service';
import { AgentRuntimeService } from '../modules/ai/agent-runtime.service';
import { ConversationsService } from '../modules/conversations/conversations.service';
import { KnowledgeService } from '../modules/ai/knowledge.service';
import { MailService } from '../modules/mail/mail.service';
import type { MailTemplate } from '../modules/mail/mail.templates';
import { WorkflowEngineService } from '../modules/automation/workflow-engine.service';
import { MetaWebhookService } from '../modules/integrations/meta-webhook.service';
import { WebhooksService } from '../modules/integrations/webhooks.service';

/** Shared failure handling: after the last attempt, jobs go to the dead-letter queue. */
abstract class BaseProcessor extends WorkerHost {
  protected abstract readonly logger: Logger;

  constructor(protected readonly queues: QueueService) {
    super();
  }

  protected isFinalAttempt(job: Job) {
    return job.attemptsMade >= (job.opts.attempts ?? 1);
  }

  protected async onFinalFailure(_job: Job, _error: Error): Promise<void> {
    /* override */
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, error: Error) {
    if (!job) return;
    this.logger.warn(`${job.queueName}:${job.name} ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts ?? 1}): ${error.message}`);
    if (!this.isFinalAttempt(job)) return;
    try {
      await this.onFinalFailure(job, error);
      await this.queues.toDeadLetter(job, error);
    } catch (err) {
      this.logger.error(`Dead-letter handling failed: ${(err as Error).message}`);
    }
  }
}

@Processor(QUEUES.WHATSAPP, { concurrency: 10 })
@Injectable()
export class WhatsAppProcessor extends BaseProcessor {
  protected readonly logger = new Logger(WhatsAppProcessor.name);

  constructor(
    queues: QueueService,
    private readonly inbound: InboundService,
    private readonly messaging: MessagingService,
  ) {
    super(queues);
  }

  async process(job: Job) {
    switch (job.name) {
      case JOBS.WHATSAPP_WEBHOOK:
        return this.inbound.processWebhookEvent(job.data.eventId);
      case JOBS.WHATSAPP_SEND:
        return this.messaging.deliver(job.data.tenantId, job.data.messageId);
    }
  }

  protected override async onFinalFailure(job: Job, error: Error) {
    if (job.name === JOBS.WHATSAPP_SEND) {
      await this.messaging.markFailed(job.data.tenantId, job.data.messageId, 'DELIVERY_FAILED', error.message);
    }
  }
}

@Processor(QUEUES.AI, { concurrency: 5 })
@Injectable()
export class AIProcessor extends BaseProcessor {
  protected readonly logger = new Logger(AIProcessor.name);

  constructor(
    queues: QueueService,
    private readonly runtime: AgentRuntimeService,
    private readonly conversations: ConversationsService,
  ) {
    super(queues);
  }

  async process(job: Job) {
    switch (job.name) {
      case JOBS.AI_REPLY:
        return this.runtime.replyToConversation(job.data.tenantId, job.data.conversationId, job.data.messageId);
      case JOBS.AI_SUMMARIZE:
        return this.runtime.summarize(job.data.tenantId, job.data.conversationId);
    }
  }

  protected override async onFinalFailure(job: Job) {
    if (job.name !== JOBS.AI_REPLY) return;
    // Never leave a customer without an answer: hand over to the team.
    await this.conversations.handoffToHuman(job.data.tenantId, job.data.conversationId, 'The AI provider is temporarily unavailable', 'System');
  }
}

@Processor(QUEUES.NOTIFICATIONS, { concurrency: 5 })
@Injectable()
export class NotificationsProcessor extends BaseProcessor {
  protected readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    queues: QueueService,
    private readonly mail: MailService,
  ) {
    super(queues);
  }

  async process(job: Job) {
    if (job.name === JOBS.EMAIL_SEND) {
      await this.mail.deliver(job.data.to, job.data.template as MailTemplate, job.data.data ?? {});
    }
  }
}

@Processor(QUEUES.DOCUMENTS, { concurrency: 2 })
@Injectable()
export class DocumentsProcessor extends BaseProcessor {
  protected readonly logger = new Logger(DocumentsProcessor.name);

  constructor(
    queues: QueueService,
    private readonly knowledge: KnowledgeService,
  ) {
    super(queues);
  }

  async process(job: Job) {
    if (job.name === JOBS.DOCUMENT_PROCESS) await this.knowledge.process(job.data.tenantId, job.data.documentId);
  }
}

@Processor(QUEUES.AUTOMATION, { concurrency: 5 })
@Injectable()
export class AutomationProcessor extends BaseProcessor {
  protected readonly logger = new Logger(AutomationProcessor.name);

  constructor(
    queues: QueueService,
    private readonly engine: WorkflowEngineService,
  ) {
    super(queues);
  }

  async process(job: Job) {
    switch (job.name) {
      case JOBS.AUTOMATION_EVENT:
        return this.engine.handleEvent(job.data.tenantId, job.data.type, job.data.payload ?? {});
      case JOBS.AUTOMATION_RUN:
        return this.engine.execute(job.data.runId, job.data.fromNodeKey);
    }
  }

  protected override async onFinalFailure(job: Job, error: Error) {
    if (job.name === JOBS.AUTOMATION_RUN) await this.engine.markFailed(job.data.runId, error.message);
  }
}

@Processor(QUEUES.ANALYTICS, { concurrency: 1 })
@Injectable()
export class MaintenanceProcessor extends BaseProcessor implements OnModuleInit {
  protected readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    queues: QueueService,
    private readonly engine: WorkflowEngineService,
    private readonly prisma: PrismaService,
  ) {
    super(queues);
  }

  /** Registers recurring jobs (idempotent across restarts). */
  async onModuleInit() {
    try {
      await this.queues.analytics.upsertJobScheduler('inactive-customers-daily', { pattern: '0 9 * * *' }, { name: JOBS.INACTIVE_CUSTOMERS_SCAN });
      await this.queues.analytics.upsertJobScheduler('sessions-cleanup-daily', { pattern: '30 3 * * *' }, { name: JOBS.SESSION_CLEANUP });
    } catch (err) {
      this.logger.warn(`Could not register scheduled jobs: ${(err as Error).message}`);
    }
  }

  async process(job: Job) {
    switch (job.name) {
      case JOBS.INACTIVE_CUSTOMERS_SCAN:
        return this.engine.scanInactiveCustomers();
      case JOBS.SESSION_CLEANUP: {
        const cutoff = new Date(Date.now() - 7 * 86400_000);
        const monthAgo = new Date(Date.now() - 30 * 86400_000);
        const [sessions, tokens, webhooks, deliveries] = await Promise.all([
          this.prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }] } }),
          this.prisma.verificationToken.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
          this.prisma.webhookEvent.deleteMany({ where: { createdAt: { lt: monthAgo }, status: { in: ['PROCESSED', 'IGNORED'] } } }),
          this.prisma.webhookDelivery.deleteMany({ where: { createdAt: { lt: monthAgo } } }),
        ]);
        return { sessions: sessions.count, tokens: tokens.count, webhooks: webhooks.count, deliveries: deliveries.count };
      }
    }
  }
}

/** Messenger/Instagram webhooks and outgoing webhook deliveries. */
@Processor(QUEUES.INTEGRATIONS, { concurrency: 10 })
@Injectable()
export class IntegrationsProcessor extends BaseProcessor {
  protected readonly logger = new Logger(IntegrationsProcessor.name);

  constructor(
    queues: QueueService,
    private readonly meta: MetaWebhookService,
    private readonly webhooks: WebhooksService,
  ) {
    super(queues);
  }

  async process(job: Job) {
    switch (job.name) {
      case JOBS.META_WEBHOOK:
        return this.meta.process(job.data.eventId);
      case JOBS.WEBHOOK_FANOUT:
        return this.webhooks.fanout(job.data.tenantId, job.data.event, job.data.data ?? {});
      case JOBS.WEBHOOK_DELIVER:
        // attemptsMade counts earlier attempts, so +1 is this one.
        return this.webhooks.deliver(job.data.deliveryId, job.attemptsMade + 1 >= (job.opts.attempts ?? 1));
    }
  }
}

export const PROCESSORS = [WhatsAppProcessor, AIProcessor, NotificationsProcessor, DocumentsProcessor, AutomationProcessor, MaintenanceProcessor, IntegrationsProcessor];
