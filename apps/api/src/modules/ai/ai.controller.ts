import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { AIToolStatus } from '@prisma/client';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { AI_TOOLS } from '@sellora/shared';
import { CurrentActor, RequirePermissions, TenantId } from '../../common/decorators';
import type { Actor } from '../../common/auth-context';
import { zBody, ZodPipe } from '../../common/zod.pipe';
import { AppException } from '../../common/errors';
import { env } from '../../config/env';
import { agentSchema, AgentsService, SALES_ASSISTANT_TEMPLATE } from './agents.service';
import { AgentRuntimeService } from './agent-runtime.service';
import { AIProviderService, aiSettingsSchema } from './ai-provider.service';
import { KnowledgeService, knowledgeBaseSchema, textDocumentSchema, urlDocumentSchema } from './knowledge.service';

const uuid = new ParseUUIDPipe();
const testSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['customer', 'assistant']), content: z.string().trim().min(1).max(2000) })).min(1).max(30),
  customerId: z.string().uuid().optional(),
});
const toolLogQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  toolName: z.string().max(60).optional(),
  status: z.nativeEnum(AIToolStatus).optional(),
  agentId: z.string().uuid().optional(),
});
const searchSchema = z.object({ query: z.string().trim().min(2).max(500) });

@Controller('ai')
export class AIController {
  constructor(
    private readonly agents: AgentsService,
    private readonly runtime: AgentRuntimeService,
    private readonly provider: AIProviderService,
    private readonly knowledge: KnowledgeService,
  ) {}

  @Get('tools')
  @RequirePermissions('ai.agents.view')
  tools() {
    return AI_TOOLS;
  }

  @Get('agents')
  @RequirePermissions('ai.agents.view')
  listAgents(@TenantId() tenantId: string) {
    return this.agents.list(tenantId);
  }

  @Get('agents/template')
  @RequirePermissions('ai.agents.create')
  template() {
    return SALES_ASSISTANT_TEMPLATE;
  }

  @Get('agents/:id')
  @RequirePermissions('ai.agents.view')
  getAgent(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.agents.get(tenantId, id);
  }

  @Post('agents')
  @RequirePermissions('ai.agents.create')
  createAgent(@CurrentActor() actor: Actor, @Body(zBody(agentSchema)) body: z.infer<typeof agentSchema>) {
    return this.agents.create(actor, body);
  }

  @Patch('agents/:id')
  @RequirePermissions('ai.agents.update')
  updateAgent(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(agentSchema.partial())) body: Partial<z.infer<typeof agentSchema>>) {
    return this.agents.update(actor, id, body);
  }

  @Delete('agents/:id')
  @RequirePermissions('ai.agents.update')
  deleteAgent(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.agents.remove(actor, id);
  }

  /** Playground: runs the agent with dry-run write tools. */
  @Post('agents/:id/test')
  @RequirePermissions('ai.agents.update')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async testAgent(@TenantId() tenantId: string, @Param('id', uuid) id: string, @Body(zBody(testSchema)) body: z.infer<typeof testSchema>) {
    if (!(await this.provider.isConfigured(tenantId))) {
      throw new AppException('NOT_CONFIGURED', 'Add an AI provider key in Settings → AI to test agents.', 412);
    }
    return this.runtime.test(tenantId, id, body.messages, body.customerId);
  }

  @Get('settings')
  @RequirePermissions('settings.view')
  settings(@TenantId() tenantId: string) {
    return this.provider.getSettings(tenantId);
  }

  @Put('settings')
  @RequirePermissions('settings.update')
  updateSettings(@CurrentActor() actor: Actor, @Body(zBody(aiSettingsSchema)) body: z.infer<typeof aiSettingsSchema>) {
    return this.provider.updateSettings(actor, body);
  }

  @Put('instructions')
  @RequirePermissions('ai.agents.update')
  async updateInstructions(@CurrentActor() actor: Actor, @Body(zBody(z.object({ instructions: z.string().trim().max(8000).nullable() }))) body: { instructions: string | null }) {
    const current = await this.provider.getSettings(actor.tenantId);
    return this.provider.updateSettings(actor, {
      provider: 'openai',
      baseUrl: current.baseUrl || undefined,
      chatModel: current.chatModel || undefined,
      embeddingModel: current.embeddingModel || undefined,
      instructions: body.instructions,
    });
  }

  @Post('settings/test')
  @RequirePermissions('settings.update')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  testSettings(@TenantId() tenantId: string) {
    return this.provider.testConnection(tenantId);
  }

  @Get('usage')
  @RequirePermissions('ai.usage.view')
  usage(@TenantId() tenantId: string, @Query('days') days?: string) {
    const d = Math.min(365, Math.max(1, Number(days) || 30));
    return this.agents.usageOverview(tenantId, d);
  }

  @Get('tool-executions')
  @RequirePermissions('ai.usage.view')
  toolExecutions(@TenantId() tenantId: string, @Query(new ZodPipe(toolLogQuery)) q: z.infer<typeof toolLogQuery>) {
    return this.agents.toolExecutions(tenantId, q);
  }

  // --------------------------------------------------------- knowledge base

  @Get('knowledge-bases')
  @RequirePermissions('ai.knowledge.view')
  listKb(@TenantId() tenantId: string) {
    return this.knowledge.list(tenantId);
  }

  @Get('knowledge-bases/:id')
  @RequirePermissions('ai.knowledge.view')
  getKb(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.knowledge.get(tenantId, id);
  }

  @Post('knowledge-bases')
  @RequirePermissions('ai.knowledge.manage')
  createKb(@CurrentActor() actor: Actor, @Body(zBody(knowledgeBaseSchema)) body: z.infer<typeof knowledgeBaseSchema>) {
    return this.knowledge.create(actor, body);
  }

  @Patch('knowledge-bases/:id')
  @RequirePermissions('ai.knowledge.manage')
  updateKb(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(knowledgeBaseSchema.partial())) body: Partial<z.infer<typeof knowledgeBaseSchema>>) {
    return this.knowledge.update(actor, id, body);
  }

  @Delete('knowledge-bases/:id')
  @RequirePermissions('ai.knowledge.manage')
  deleteKb(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.knowledge.remove(actor, id);
  }

  @Post('knowledge-bases/:id/reindex')
  @RequirePermissions('ai.knowledge.manage')
  reindexKb(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.knowledge.reindexKnowledgeBase(actor, id);
  }

  @Post('knowledge-bases/:id/search')
  @RequirePermissions('ai.knowledge.view')
  searchKb(@TenantId() tenantId: string, @Param('id', uuid) id: string, @Body(zBody(searchSchema)) body: z.infer<typeof searchSchema>) {
    return this.knowledge.testSearch(tenantId, id, body.query);
  }

  @Post('knowledge-bases/:id/documents/text')
  @RequirePermissions('ai.knowledge.manage')
  addText(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(textDocumentSchema)) body: z.infer<typeof textDocumentSchema>) {
    return this.knowledge.addText(actor, id, body);
  }

  @Post('knowledge-bases/:id/documents/url')
  @RequirePermissions('ai.knowledge.manage')
  addUrl(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @Body(zBody(urlDocumentSchema)) body: z.infer<typeof urlDocumentSchema>) {
    return this.knowledge.addUrl(actor, id, body);
  }

  @Post('knowledge-bases/:id/documents/file')
  @RequirePermissions('ai.knowledge.manage')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } }))
  addFile(@CurrentActor() actor: Actor, @Param('id', uuid) id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new AppException('NO_FILE', 'Attach a PDF, DOCX, TXT or Markdown file');
    return this.knowledge.addFile(actor, id, file);
  }

  @Post('documents/:id/reindex')
  @RequirePermissions('ai.knowledge.manage')
  reindexDoc(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.knowledge.reindexDocument(actor, id);
  }

  @Delete('documents/:id')
  @RequirePermissions('ai.knowledge.manage')
  deleteDoc(@CurrentActor() actor: Actor, @Param('id', uuid) id: string) {
    return this.knowledge.removeDocument(actor, id);
  }
}
