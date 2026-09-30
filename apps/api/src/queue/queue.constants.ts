import type { JobsOptions } from 'bullmq';

export const QUEUES = {
  WHATSAPP: 'whatsapp',
  AI: 'ai',
  NOTIFICATIONS: 'notifications',
  DOCUMENTS: 'documents',
  AUTOMATION: 'automation',
  ANALYTICS: 'analytics',
  DEAD_LETTER: 'dead-letter',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOBS = {
  WHATSAPP_WEBHOOK: 'webhook.process',
  WHATSAPP_SEND: 'message.send',
  AI_REPLY: 'conversation.reply',
  AI_SUMMARIZE: 'conversation.summarize',
  EMAIL_SEND: 'email.send',
  DOCUMENT_PROCESS: 'document.process',
  AUTOMATION_EVENT: 'event',
  AUTOMATION_RUN: 'workflow.run',
  INVENTORY_SCAN: 'inventory.scan',
  INACTIVE_CUSTOMERS_SCAN: 'customers.inactive.scan',
  SESSION_CLEANUP: 'sessions.cleanup',
} as const;

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 2000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export interface DeadLetterPayload {
  queue: string;
  jobName: string;
  jobId?: string;
  data: unknown;
  error: string;
  attemptsMade: number;
  failedAt: string;
}
