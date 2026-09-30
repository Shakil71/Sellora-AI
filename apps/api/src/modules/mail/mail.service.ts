import { Global, Injectable, Logger, Module } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../../config/env';
import { QueueService } from '../../queue/queue.module';
import { MailTemplate, renderMail } from './mail.templates';

export interface EmailProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(message: { to: string; subject: string; html: string; text: string }): Promise<void>;
}

/** SMTP implementation of the email provider abstraction. */
class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private transporter?: Transporter;

  isConfigured() {
    return Boolean(env.SMTP_HOST);
  }

  private transport(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      });
    }
    return this.transporter;
  }

  async send(message: { to: string; subject: string; html: string; text: string }) {
    await this.transport().sendMail({ from: env.MAIL_FROM, ...message });
  }

  async verify(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      await this.transport().verify();
      return true;
    } catch {
      return false;
    }
  }
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly provider = new SmtpEmailProvider();

  constructor(private readonly queues: QueueService) {}

  isConfigured() {
    return this.provider.isConfigured();
  }

  verifyConnection() {
    return this.provider.verify();
  }

  /** Queue an email for background delivery (preferred). */
  async queue(to: string, template: MailTemplate, data: Record<string, unknown>) {
    if (!this.isConfigured()) {
      this.logger.warn(`SMTP not configured — "${template}" email to ${to} was not sent.`);
      return { queued: false };
    }
    await this.queues.email({ to, template, data });
    return { queued: true };
  }

  /** Deliver immediately (used by the notifications worker). */
  async deliver(to: string, template: MailTemplate, data: Record<string, unknown>) {
    if (!this.isConfigured()) {
      this.logger.warn(`SMTP not configured — skipping "${template}" email.`);
      return;
    }
    const rendered = renderMail(template, data);
    await this.provider.send({ to, ...rendered });
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
