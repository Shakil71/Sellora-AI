import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { z } from 'zod';
import { TenantId, UserId } from '../../common/decorators';
import { zBody, ZodPipe } from '../../common/zod.pipe';
import { NotificationsService } from './notifications.service';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
const markSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });
const prefsSchema = z.object({
  items: z.array(z.object({ type: z.nativeEnum(NotificationType), inApp: z.boolean(), email: z.boolean() })).max(50),
});

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@TenantId() tenantId: string, @UserId() userId: string, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.notifications.list(tenantId, userId, q);
  }

  @Get('unread-count')
  unread(@TenantId() tenantId: string, @UserId() userId: string) {
    return this.notifications.unreadCount(tenantId, userId);
  }

  @Post('read')
  markRead(@TenantId() tenantId: string, @UserId() userId: string, @Body(zBody(markSchema)) body: z.infer<typeof markSchema>) {
    return this.notifications.markRead(tenantId, userId, body.ids);
  }

  @Post('read-all')
  markAll(@TenantId() tenantId: string, @UserId() userId: string) {
    return this.notifications.markAllRead(tenantId, userId);
  }

  @Get('preferences')
  prefs(@TenantId() tenantId: string, @UserId() userId: string) {
    return this.notifications.getPreferences(tenantId, userId);
  }

  @Put('preferences')
  setPrefs(@TenantId() tenantId: string, @UserId() userId: string, @Body(zBody(prefsSchema)) body: z.infer<typeof prefsSchema>) {
    return this.notifications.setPreferences(tenantId, userId, body.items);
  }
}
