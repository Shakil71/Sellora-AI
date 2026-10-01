import { Body, Controller, Delete, Get, Injectable, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Prisma, TenantStatus } from '@prisma/client';
import { z } from 'zod';
import { PLAN_KEYS } from '@sellora/shared';
import { Auth, SuperAdminOnly, AllowNoTenant } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zBody, ZodPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.module';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { billingSettingsSchema, PlanPaymentsService, planPaymentListSchema, reviewPlanPaymentSchema } from '../billing/plan-payments.service';
import { AccessService } from '../auth/access.service';
import { DEFAULT_JOB_OPTIONS, DeadLetterPayload } from '../../queue/queue.constants';
import { ensureFound, ValidationError } from '../../common/errors';
import { paginate, toPaginated } from '../../common/pagination';

const tenantsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
});
const tenantUpdate = z.object({ status: z.nativeEnum(TenantStatus).optional(), plan: z.enum(PLAN_KEYS).optional() });

/** Platform administration for SUPER_ADMIN users. */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
    private readonly access: AccessService,
    readonly planPayments: PlanPaymentsService,
  ) {}

  async overview() {
    const [tenants, users, orders, messages, queues] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.user.count(),
      this.prisma.order.count(),
      this.prisma.message.count(),
      this.queueStats(),
    ]);
    return { tenants, users, orders, messages, queues };
  }

  async queueStats() {
    return Promise.all(
      this.queues.all().map(async (q) => {
        try {
          const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
          const workers = q.name === 'dead-letter' ? null : (await q.getWorkers()).length;
          return { name: q.name, ...counts, workers };
        } catch {
          return { name: q.name, error: 'unavailable' };
        }
      }),
    );
  }

  async tenants(q: z.infer<typeof tenantsQuery>) {
    const where: Prisma.TenantWhereInput = q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { slug: { contains: q.search } }] } : {};
    const [items, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, slug: true, status: true, createdAt: true, isDemo: true,
          subscription: { select: { plan: true, status: true } },
          _count: { select: { members: true, orders: true, conversations: true } },
        },
        ...paginate(q),
      }),
      this.prisma.tenant.count({ where }),
    ]);
    return toPaginated(items, total, q);
  }

  async updateTenant(auth: AuthContext, id: string, input: z.infer<typeof tenantUpdate>) {
    ensureFound(await this.prisma.tenant.findUnique({ where: { id } }), 'Workspace');
    const actor = { tenantId: id, userId: auth.userId, name: `${auth.name} (platform admin)`, type: 'USER' as const };
    if (input.status) {
      await this.prisma.tenant.update({ where: { id }, data: { status: input.status } });
      await this.access.invalidateTenant(id);
      await this.audit.log(actor, { action: 'platform.tenant_status_changed', entityType: 'Tenant', entityId: id, metadata: { status: input.status } });
    }
    if (input.plan) await this.billing.setPlan(actor, id, input.plan);
    return this.prisma.tenant.findUnique({ where: { id }, include: { subscription: true } });
  }

  async deadLetters(page = 1, pageSize = 25) {
    const start = (page - 1) * pageSize;
    const [jobs, total] = await Promise.all([
      this.queues.deadLetter.getJobs(['waiting', 'completed', 'failed', 'delayed'], start, start + pageSize - 1, false),
      this.queues.deadLetter.getJobCountByTypes('waiting', 'completed', 'failed', 'delayed'),
    ]);
    return {
      items: jobs.filter(Boolean).map((j) => ({ id: j.id, ...(j.data as DeadLetterPayload), timestamp: new Date(j.timestamp).toISOString() })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async retryDeadLetter(auth: AuthContext, jobId: string) {
    const job = await this.queues.deadLetter.getJob(jobId);
    if (!job) throw new ValidationError('Job not found');
    const payload = job.data as DeadLetterPayload;
    const target = this.queues.byName(payload.queue);
    if (!target) throw new ValidationError(`Unknown queue ${payload.queue}`);
    await target.add(payload.jobName, payload.data, { ...DEFAULT_JOB_OPTIONS });
    await job.remove();
    await this.audit.log({ userId: auth.userId, name: auth.name, type: 'USER' }, { action: 'platform.dead_letter_retried', metadata: { queue: payload.queue, job: payload.jobName } });
    return { retried: true };
  }

  async removeDeadLetter(jobId: string) {
    const job = await this.queues.deadLetter.getJob(jobId);
    if (job) await job.remove();
    return { removed: true };
  }
}

@Controller('admin')
@SuperAdminOnly()
@AllowNoTenant()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Get('tenants')
  tenants(@Query(new ZodPipe(tenantsQuery)) q: z.infer<typeof tenantsQuery>) {
    return this.admin.tenants(q);
  }

  @Patch('tenants/:id')
  updateTenant(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zBody(tenantUpdate)) body: z.infer<typeof tenantUpdate>) {
    return this.admin.updateTenant(auth, id, body);
  }

  @Get('plan-payments')
  planPaymentList(@Query(new ZodPipe(planPaymentListSchema)) q: z.infer<typeof planPaymentListSchema>) {
    return this.admin.planPayments.list(q);
  }

  @Post('plan-payments/:id/approve')
  approvePlanPayment(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zBody(reviewPlanPaymentSchema)) body: z.infer<typeof reviewPlanPaymentSchema>) {
    return this.admin.planPayments.approve(auth, id, body);
  }

  @Post('plan-payments/:id/reject')
  rejectPlanPayment(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zBody(reviewPlanPaymentSchema)) body: z.infer<typeof reviewPlanPaymentSchema>) {
    return this.admin.planPayments.reject(auth, id, body);
  }

  @Get('billing-settings')
  billingSettings() {
    return this.admin.planPayments.settings();
  }

  @Put('billing-settings')
  saveBillingSettings(@Auth() auth: AuthContext, @Body(zBody(billingSettingsSchema)) body: z.infer<typeof billingSettingsSchema>) {
    return this.admin.planPayments.saveSettings(auth, body);
  }

  @Get('queues')
  queues() {
    return this.admin.queueStats();
  }

  @Get('dead-letter')
  deadLetters(@Query('page') page?: string) {
    return this.admin.deadLetters(Math.max(1, Number(page) || 1));
  }

  @Post('dead-letter/:jobId/retry')
  retry(@Auth() auth: AuthContext, @Param('jobId') jobId: string) {
    return this.admin.retryDeadLetter(auth, jobId);
  }

  @Delete('dead-letter/:jobId')
  remove(@Param('jobId') jobId: string) {
    return this.admin.removeDeadLetter(jobId);
  }
}
