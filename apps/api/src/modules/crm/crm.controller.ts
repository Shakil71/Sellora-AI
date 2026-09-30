import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Auth, CurrentActor, RequirePermissions, TenantId } from '../../common/decorators';
import type { Actor, AuthContext } from '../../common/auth-context';
import { zBody, ZodPipe } from '../../common/zod.pipe';
import { CustomersService, customerListSchema, customerSchema } from './customers.service';
import { LeadsService, leadListSchema, leadSchema } from './leads.service';
import { dealListSchema, DealsService, dealSchema, moveDealSchema, pipelineSchema } from './deals.service';
import { TasksService, taskListSchema, taskSchema } from './tasks.service';

const uuid = new ParseUUIDPipe();

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions('contacts.view')
  list(@TenantId() tenantId: string, @Query(new ZodPipe(customerListSchema)) q: z.infer<typeof customerListSchema>) {
    return this.customers.list(tenantId, q);
  }

  @Get('tags')
  @RequirePermissions('contacts.view')
  tags(@TenantId() tenantId: string) {
    return this.customers.tags(tenantId);
  }

  @Get(':id')
  @RequirePermissions('contacts.view')
  get(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.customers.get(tenantId, id);
  }

  @Post()
  @RequirePermissions('contacts.create')
  create(@CurrentActor() actor: Actor, @Body(zBody(customerSchema)) body: z.infer<typeof customerSchema>) {
    return this.customers.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('contacts.update')
  update(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(customerSchema.partial())) body: Partial<z.infer<typeof customerSchema>>) {
    return this.customers.update(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions('contacts.delete')
  remove(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.customers.remove(actor, id);
  }
}

const convertSchema = z.object({
  createDeal: z.boolean().default(true),
  dealName: z.string().trim().max(150).optional(),
  amount: z.number().min(0).optional(),
});

@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @RequirePermissions('crm.leads.view')
  list(@TenantId() tenantId: string, @Query(new ZodPipe(leadListSchema)) q: z.infer<typeof leadListSchema>) {
    return this.leads.list(tenantId, q);
  }

  @Get(':id')
  @RequirePermissions('crm.leads.view')
  get(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.leads.get(tenantId, id);
  }

  @Post()
  @RequirePermissions('crm.leads.create')
  create(@CurrentActor() actor: Actor, @Body(zBody(leadSchema)) body: z.infer<typeof leadSchema>) {
    return this.leads.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('crm.leads.update')
  update(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(leadSchema.partial())) body: Partial<z.infer<typeof leadSchema>>) {
    return this.leads.update(actor, id, body);
  }

  @Post(':id/convert')
  @RequirePermissions('crm.leads.update', 'contacts.create')
  convert(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(convertSchema)) body: z.infer<typeof convertSchema>) {
    return this.leads.convert(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions('crm.leads.delete')
  remove(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.leads.remove(actor, id);
  }
}

const boardQuery = z.object({ assignedUserId: z.string().uuid().optional(), search: z.string().trim().max(100).optional() });

@Controller('pipelines')
export class PipelinesController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  @RequirePermissions('crm.deals.view')
  list(@TenantId() tenantId: string) {
    return this.deals.listPipelines(tenantId);
  }

  @Get(':id/board')
  @RequirePermissions('crm.deals.view')
  board(@TenantId() tenantId: string, @Param('id', uuid) id: string, @Query(new ZodPipe(boardQuery)) q: z.infer<typeof boardQuery>) {
    return this.deals.board(tenantId, id, q);
  }

  @Post()
  @RequirePermissions('crm.pipelines.manage')
  create(@CurrentActor() actor: Actor, @Body(zBody(pipelineSchema)) body: z.infer<typeof pipelineSchema>) {
    return this.deals.createPipeline(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('crm.pipelines.manage')
  update(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(pipelineSchema)) body: z.infer<typeof pipelineSchema>) {
    return this.deals.updatePipeline(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions('crm.pipelines.manage')
  remove(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.deals.deletePipeline(actor, id);
  }
}

@Controller('deals')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  @RequirePermissions('crm.deals.view')
  list(@TenantId() tenantId: string, @Query(new ZodPipe(dealListSchema)) q: z.infer<typeof dealListSchema>) {
    return this.deals.list(tenantId, q);
  }

  @Get(':id')
  @RequirePermissions('crm.deals.view')
  get(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.deals.get(tenantId, id);
  }

  @Post()
  @RequirePermissions('crm.deals.create')
  create(@CurrentActor() actor: Actor, @Body(zBody(dealSchema)) body: z.infer<typeof dealSchema>) {
    return this.deals.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('crm.deals.update')
  update(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(dealSchema.partial())) body: Partial<z.infer<typeof dealSchema>>) {
    return this.deals.update(actor, id, body);
  }

  @Post(':id/move')
  @RequirePermissions('crm.deals.update')
  move(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(moveDealSchema)) body: z.infer<typeof moveDealSchema>) {
    return this.deals.move(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions('crm.deals.delete')
  remove(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.deals.remove(actor, id);
  }
}

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermissions('tasks.view')
  list(@TenantId() tenantId: string, @Auth() auth: AuthContext, @Query(new ZodPipe(taskListSchema)) q: z.infer<typeof taskListSchema>) {
    return this.tasks.list(tenantId, auth.userId, q);
  }

  @Post()
  @RequirePermissions('tasks.manage')
  create(@CurrentActor() actor: Actor, @Body(zBody(taskSchema)) body: z.infer<typeof taskSchema>) {
    return this.tasks.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('tasks.manage')
  update(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(taskSchema.partial())) body: Partial<z.infer<typeof taskSchema>>) {
    return this.tasks.update(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions('tasks.manage')
  remove(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.tasks.remove(actor, id);
  }
}
