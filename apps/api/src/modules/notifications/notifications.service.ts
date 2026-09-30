import { Injectable, Logger } from '@nestjs/common';
import { MembershipStatus, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService, REALTIME_EVENTS } from '../realtime/realtime.service';
import { MailService } from '../mail/mail.service';
import { env } from '../../config/env';
import { paginate, toPaginated } from '../../common/pagination';

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  data?: Record<string, unknown>;
}

export type Recipients = { userIds: string[] } | { permission: string } | { roles: string[] };

type Prefs = Partial<Record<NotificationType, { inApp?: boolean; email?: boolean }>>;

/** Default email preference per notification type (in-app is always on by default). */
const EMAIL_DEFAULTS: Partial<Record<NotificationType, boolean>> = {
  AI_ESCALATION: true,
  WORKFLOW_FAILURE: true,
  ASSIGNMENT: true,
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly mail: MailService,
  ) {}

  private async resolveRecipients(tenantId: string, recipients: Recipients) {
    const where: Prisma.UserRoleWhereInput = { tenantId, status: MembershipStatus.ACTIVE };
    if ('userIds' in recipients) where.userId = { in: recipients.userIds };
    else if ('roles' in recipients) where.role = { key: { in: recipients.roles } };
    else where.role = { permissions: { some: { permission: { key: recipients.permission } } } };
    return this.prisma.userRole.findMany({
      where,
      select: { userId: true, notificationPrefs: true, user: { select: { email: true, name: true } } },
    });
  }

  /** Creates notifications for recipients, honouring their preferences. Never throws. */
  async notify(tenantId: string, recipients: Recipients, input: NotifyInput): Promise<number> {
    try {
      const members = await this.resolveRecipients(tenantId, recipients);
      let created = 0;
      for (const m of members) {
        const prefs = (m.notificationPrefs ?? {}) as Prefs;
        const pref = prefs[input.type] ?? {};
        if (pref.inApp !== false) {
          const notification = await this.prisma.notification.create({
            data: {
              tenantId,
              userId: m.userId,
              type: input.type,
              title: input.title.slice(0, 200),
              body: input.body?.slice(0, 1000),
              link: input.link,
              data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
            },
          });
          this.realtime.toUser(m.userId, REALTIME_EVENTS.NOTIFICATION_CREATED, notification);
          created++;
        }
        const wantsEmail = pref.email ?? EMAIL_DEFAULTS[input.type] ?? false;
        if (wantsEmail && this.mail.isConfigured()) {
          await this.mail.queue(m.user.email, 'workflow-notification', {
            title: input.title,
            body: input.body ?? '',
            url: input.link ? `${env.APP_URL}${input.link}` : undefined,
          });
        }
      }
      return created;
    } catch (err) {
      this.logger.warn(`Notification failed (${input.type}): ${(err as Error).message}`);
      return 0;
    }
  }

  async list(tenantId: string, userId: string, q: { page: number; pageSize: number; unread?: boolean }) {
    const where: Prisma.NotificationWhereInput = { tenantId, userId, ...(q.unread ? { readAt: null } : {}) };
    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...paginate(q) }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { tenantId, userId, readAt: null } }),
    ]);
    return { ...toPaginated(items, total, q), unread };
  }

  async unreadCount(tenantId: string, userId: string) {
    return { unread: await this.prisma.notification.count({ where: { tenantId, userId, readAt: null } }) };
  }

  async markRead(tenantId: string, userId: string, ids: string[]) {
    const res = await this.prisma.notification.updateMany({
      where: { tenantId, userId, id: { in: ids }, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  }

  async markAllRead(tenantId: string, userId: string) {
    const res = await this.prisma.notification.updateMany({
      where: { tenantId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  }

  async getPreferences(tenantId: string, userId: string) {
    const m = await this.prisma.userRole.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
    const prefs = (m?.notificationPrefs ?? {}) as Prefs;
    return Object.values(NotificationType).map((type) => ({
      type,
      inApp: prefs[type]?.inApp ?? true,
      email: prefs[type]?.email ?? EMAIL_DEFAULTS[type] ?? false,
    }));
  }

  async setPreferences(tenantId: string, userId: string, items: Array<{ type: NotificationType; inApp: boolean; email: boolean }>) {
    const prefs: Prefs = {};
    for (const i of items) prefs[i.type] = { inApp: i.inApp, email: i.email };
    await this.prisma.userRole.update({
      where: { tenantId_userId: { tenantId, userId } },
      data: { notificationPrefs: prefs as Prisma.InputJsonValue },
    });
    return this.getPreferences(tenantId, userId);
  }
}
