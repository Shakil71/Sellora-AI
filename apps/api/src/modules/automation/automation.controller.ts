import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { WorkflowStatus } from '@prisma/client';
import { z } from 'zod';
import { CurrentActor, RequirePermissions, TenantId } from '../../common/decorators';
import type { Actor } from '../../common/auth-context';
import { zBody, ZodPipe } from '../../common/zod.pipe';
import { manualRunSchema, runListSchema, workflowSchema, WorkflowsService } from './workflows.service';

const uuid = new ParseUUIDPipe();
const statusSchema = z.object({ status: z.nativeEnum(WorkflowStatus) });

@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get('catalog')
  @RequirePermissions('automation.view')
  catalog() {
    return this.workflows.catalog();
  }

  @Get()
  @RequirePermissions('automation.view')
  list(@TenantId() tenantId: string) {
    return this.workflows.list(tenantId);
  }

  @Get('runs')
  @RequirePermissions('automation.view')
  runs(@TenantId() tenantId: string, @Query(new ZodPipe(runListSchema)) q: z.infer<typeof runListSchema>) {
    return this.workflows.listRuns(tenantId, q);
  }

  @Get('runs/:id')
  @RequirePermissions('automation.view')
  run(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.workflows.getRun(tenantId, id);
  }

  @Post('runs/:id/retry')
  @RequirePermissions('automation.execute')
  retry(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.workflows.retryRun(actor, id);
  }

  @Get(':id')
  @RequirePermissions('automation.view')
  get(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.workflows.get(tenantId, id);
  }

  @Post()
  @RequirePermissions('automation.create')
  create(@CurrentActor() actor: Actor, @Body(zBody(workflowSchema)) body: z.infer<typeof workflowSchema>) {
    return this.workflows.create(actor, body);
  }

  @Put(':id')
  @RequirePermissions('automation.update')
  update(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(workflowSchema)) body: z.infer<typeof workflowSchema>) {
    return this.workflows.update(actor, id, body);
  }

  @Post(':id/status')
  @RequirePermissions('automation.update')
  status(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(statusSchema)) body: z.infer<typeof statusSchema>) {
    return this.workflows.setStatus(actor, id, body.status);
  }

  @Post(':id/duplicate')
  @RequirePermissions('automation.create')
  duplicate(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.workflows.duplicate(actor, id);
  }

  @Post(':id/run')
  @RequirePermissions('automation.execute')
  runNow(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(manualRunSchema)) body: z.infer<typeof manualRunSchema>) {
    return this.workflows.runManually(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions('automation.update')
  remove(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.workflows.remove(actor, id);
  }
}
