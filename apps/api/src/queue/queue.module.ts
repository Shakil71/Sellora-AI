import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { Job, JobsOptions, Queue } from 'bullmq';
import { env } from '../config/env';
import { DeadLetterPayload, DEFAULT_JOB_OPTIONS, JOBS, QUEUES } from './queue.constants';

function redisConnectionOptions() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : 0,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

/** Typed producer for all background queues. */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(QUEUES.WHATSAPP) readonly whatsapp: Queue,
    @InjectQueue(QUEUES.AI) readonly ai: Queue,
    @InjectQueue(QUEUES.NOTIFICATIONS) readonly notifications: Queue,
    @InjectQueue(QUEUES.DOCUMENTS) readonly documents: Queue,
    @InjectQueue(QUEUES.AUTOMATION) readonly automation: Queue,
    @InjectQueue(QUEUES.ANALYTICS) readonly analytics: Queue,
    @InjectQueue(QUEUES.INTEGRATIONS) readonly integrations: Queue,
    @InjectQueue(QUEUES.DEAD_LETTER) readonly deadLetter: Queue,
  ) {}

  all(): Queue[] {
    return [this.whatsapp, this.ai, this.notifications, this.documents, this.automation, this.analytics, this.deadLetter];
  }

  byName(name: string): Queue | undefined {
    return this.all().find((q) => q.name === name);
  }

  async add(queue: Queue, name: string, data: unknown, opts: JobsOptions = {}) {
    try {
      return await queue.add(name, data, { ...DEFAULT_JOB_OPTIONS, ...opts });
    } catch (err) {
      this.logger.error(`Failed to enqueue ${queue.name}:${name}: ${(err as Error).message}`);
      throw err;
    }
  }

  processWebhook(eventId: string) {
    return this.add(this.whatsapp, JOBS.WHATSAPP_WEBHOOK, { eventId }, { jobId: `wh-${eventId}`, attempts: 5 });
  }

  sendMessage(tenantId: string, messageId: string) {
    return this.add(this.whatsapp, JOBS.WHATSAPP_SEND, { tenantId, messageId }, { jobId: `send-${messageId}-${Date.now()}`, attempts: 4 });
  }

  aiReply(tenantId: string, conversationId: string, messageId: string, agentId?: string) {
    // One pending reply per conversation+message: debounces bursts of messages.
    return this.add(
      this.ai,
      JOBS.AI_REPLY,
      { tenantId, conversationId, messageId, agentId },
      { jobId: `ai-${conversationId}-${messageId}`, delay: 1500, attempts: 2 },
    );
  }

  aiSummarize(tenantId: string, conversationId: string) {
    return this.add(this.ai, JOBS.AI_SUMMARIZE, { tenantId, conversationId }, { attempts: 2 });
  }

  email(payload: { to: string; template: string; data: Record<string, unknown>; tenantId?: string }) {
    return this.add(this.notifications, JOBS.EMAIL_SEND, payload, { attempts: 5 });
  }

  processDocument(tenantId: string, documentId: string) {
    return this.add(this.documents, JOBS.DOCUMENT_PROCESS, { tenantId, documentId }, { jobId: `doc-${documentId}-${Date.now()}` });
  }

  automationEvent(tenantId: string, type: string, payload: Record<string, unknown>) {
    return this.add(this.automation, JOBS.AUTOMATION_EVENT, { tenantId, type, payload });
  }

  runWorkflow(runId: string, delayMs = 0, fromNodeKey?: string) {
    return this.add(
      this.automation,
      JOBS.AUTOMATION_RUN,
      { runId, fromNodeKey },
      { delay: delayMs, jobId: `run-${runId}-${fromNodeKey ?? 'start'}-${Date.now()}` },
    );
  }

  /** Messenger / Instagram webhook stored as a WebhookEvent. */
  processMetaWebhook(eventId: string) {
    return this.add(this.integrations, JOBS.META_WEBHOOK, { eventId }, { jobId: `meta-${eventId}`, attempts: 5 });
  }

  /** Finds webhook endpoints subscribed to an event and schedules deliveries. */
  webhookFanout(tenantId: string, event: string, data: Record<string, unknown>, occurredAt: string) {
    return this.add(this.integrations, JOBS.WEBHOOK_FANOUT, { tenantId, event, data, occurredAt }, { attempts: 3 });
  }

  /** One signed HTTP delivery, retried with backoff for about an hour. */
  deliverWebhook(deliveryId: string, attempts = 6) {
    return this.add(
      this.integrations,
      JOBS.WEBHOOK_DELIVER,
      { deliveryId },
      { jobId: `whd-${deliveryId}-${Date.now()}`, attempts, backoff: { type: 'exponential', delay: 30_000 } },
    );
  }

  async toDeadLetter(job: Job, error: Error) {
    const payload: DeadLetterPayload = {
      queue: job.queueName,
      jobName: job.name,
      jobId: job.id,
      data: job.data,
      error: error.message?.slice(0, 2000) ?? 'Unknown error',
      attemptsMade: job.attemptsMade,
      failedAt: new Date().toISOString(),
    };
    await this.deadLetter.add('failed-job', payload, { removeOnComplete: false, removeOnFail: false, attempts: 1 });
  }
}

const queueNames = Object.values(QUEUES);

@Global()
@Module({
  imports: [
    BullModule.forRoot({ connection: redisConnectionOptions(), prefix: 'sellora' }),
    BullModule.registerQueue(...queueNames.map((name) => ({ name }))),
  ],
  providers: [QueueService],
  exports: [QueueService, BullModule],
})
export class QueueModule {}
