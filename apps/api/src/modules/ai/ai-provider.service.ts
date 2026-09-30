import { Injectable, Logger } from '@nestjs/common';
import { AIUsagePurpose, Prisma } from '@prisma/client';
import OpenAI from 'openai';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { decryptJson, encryptJson, maskSecret } from '../../common/utils/crypto.util';
import { NotConfiguredError } from '../../common/errors';
import { env } from '../../config/env';
import type { Actor } from '../../common/auth-context';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatResult {
  content: string | null;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
}

export class AIProviderError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
  }
}

/** Provider abstraction: implement for other LLM vendors without touching the runtime. */
export interface LLMProvider {
  chat(input: { model: string; messages: ChatMessage[]; tools?: ToolDefinition[]; temperature?: number; maxTokens?: number }): Promise<ChatResult>;
  embed(input: { model: string; texts: string[] }): Promise<{ vectors: number[][]; tokens: number }>;
}

class OpenAICompatibleProvider implements LLMProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string, baseURL: string) {
    this.client = new OpenAI({ apiKey, baseURL, timeout: 60_000, maxRetries: 1 });
  }

  private wrap(err: unknown): AIProviderError {
    const e = err as { status?: number; message?: string };
    const retryable = !e.status || e.status === 429 || e.status >= 500;
    return new AIProviderError(e.message ?? 'AI provider error', retryable);
  }

  async chat(input: { model: string; messages: ChatMessage[]; tools?: ToolDefinition[]; temperature?: number; maxTokens?: number }): Promise<ChatResult> {
    try {
      const res = await this.client.chat.completions.create({
        model: input.model,
        messages: input.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        temperature: input.temperature,
        max_tokens: input.maxTokens ?? 800,
        ...(input.tools?.length
          ? {
              tools: input.tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } })),
              tool_choice: 'auto' as const,
            }
          : {}),
      });
      const msg = res.choices[0]?.message;
      return {
        content: msg?.content ?? null,
        toolCalls: (msg?.tool_calls ?? [])
          .filter((c) => c.type === 'function')
          .map((c) => {
            const fn = (c as { function: { name: string; arguments: string } }).function;
            return { id: c.id, name: fn.name, arguments: fn.arguments };
          }),
        usage: {
          promptTokens: res.usage?.prompt_tokens ?? 0,
          completionTokens: res.usage?.completion_tokens ?? 0,
          totalTokens: res.usage?.total_tokens ?? 0,
        },
        model: res.model ?? input.model,
      };
    } catch (err) {
      throw this.wrap(err);
    }
  }

  async embed(input: { model: string; texts: string[] }) {
    try {
      const res = await this.client.embeddings.create({ model: input.model, input: input.texts });
      return { vectors: res.data.map((d) => d.embedding as number[]), tokens: res.usage?.prompt_tokens ?? 0 };
    } catch (err) {
      throw this.wrap(err);
    }
  }
}

export const aiSettingsSchema = z.object({
  provider: z.enum(['openai']).default('openai'),
  apiKey: z.string().trim().min(10).max(300).optional(),
  clearApiKey: z.boolean().optional(),
  baseUrl: z.string().url().max(300).optional().or(z.literal('').transform(() => undefined)),
  chatModel: z.string().trim().max(100).optional().or(z.literal('').transform(() => undefined)),
  embeddingModel: z.string().trim().max(100).optional().or(z.literal('').transform(() => undefined)),
  instructions: z.string().trim().max(8000).nullable().optional(),
});

interface StoredAIConfig {
  provider: 'openai';
  apiKey?: string;
  baseUrl?: string;
  chatModel?: string;
  embeddingModel?: string;
}

export interface ResolvedAIConfig {
  source: 'workspace' | 'platform';
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
}

@Injectable()
export class AIProviderService {
  private readonly logger = new Logger(AIProviderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async stored(tenantId: string): Promise<StoredAIConfig | undefined> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { aiConfigEnc: true } });
    return decryptJson<StoredAIConfig>(tenant?.aiConfigEnc);
  }

  /** Workspace key first, then the platform key from the environment. */
  async resolve(tenantId: string): Promise<ResolvedAIConfig | null> {
    const cfg = await this.stored(tenantId);
    const apiKey = cfg?.apiKey ?? env.OPENAI_API_KEY;
    if (!apiKey) return null;
    return {
      source: cfg?.apiKey ? 'workspace' : 'platform',
      apiKey,
      baseUrl: cfg?.baseUrl ?? env.OPENAI_BASE_URL,
      chatModel: cfg?.chatModel ?? env.AI_DEFAULT_MODEL,
      embeddingModel: cfg?.embeddingModel ?? env.AI_EMBEDDING_MODEL,
    };
  }

  async isConfigured(tenantId: string) {
    return (await this.resolve(tenantId)) !== null;
  }

  private async provider(tenantId: string): Promise<{ provider: LLMProvider; config: ResolvedAIConfig }> {
    const config = await this.resolve(tenantId);
    if (!config) throw new NotConfiguredError('The AI provider', 'Add an OpenAI API key in Settings → AI.');
    return { provider: new OpenAICompatibleProvider(config.apiKey, config.baseUrl), config };
  }

  estimateCost(promptTokens: number, completionTokens: number) {
    return (promptTokens / 1_000_000) * env.AI_PRICE_INPUT_PER_1M + (completionTokens / 1_000_000) * env.AI_PRICE_OUTPUT_PER_1M;
  }

  async chat(
    tenantId: string,
    input: { messages: ChatMessage[]; tools?: ToolDefinition[]; model?: string | null; temperature?: number; maxTokens?: number },
    meta: { purpose: AIUsagePurpose; agentId?: string | null; conversationId?: string | null },
  ): Promise<ChatResult> {
    const { provider, config } = await this.provider(tenantId);
    const result = await provider.chat({ ...input, model: input.model || config.chatModel });
    await this.logUsage(tenantId, meta, result.model, result.usage.promptTokens, result.usage.completionTokens);
    return result;
  }

  async embed(tenantId: string, texts: string[]): Promise<{ vectors: number[][]; model: string }> {
    const { provider, config } = await this.provider(tenantId);
    const result = await provider.embed({ model: config.embeddingModel, texts });
    await this.logUsage(tenantId, { purpose: AIUsagePurpose.EMBEDDING }, config.embeddingModel, result.tokens, 0);
    return { vectors: result.vectors, model: config.embeddingModel };
  }

  private async logUsage(tenantId: string, meta: { purpose: AIUsagePurpose; agentId?: string | null; conversationId?: string | null }, model: string, promptTokens: number, completionTokens: number) {
    try {
      await this.prisma.aIUsageLog.create({
        data: {
          tenantId,
          agentId: meta.agentId ?? null,
          conversationId: meta.conversationId ?? null,
          purpose: meta.purpose,
          model,
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          estimatedCost: new Prisma.Decimal(this.estimateCost(promptTokens, completionTokens).toFixed(6)),
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to log AI usage: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------- settings

  async getSettings(tenantId: string) {
    const [cfg, tenant] = await Promise.all([
      this.stored(tenantId),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { aiInstructions: true } }),
    ]);
    const resolved = await this.resolve(tenantId);
    return {
      provider: 'openai',
      configured: Boolean(resolved),
      source: resolved?.source ?? null,
      workspaceKeyHint: maskSecret(cfg?.apiKey),
      platformKeyAvailable: Boolean(env.OPENAI_API_KEY),
      baseUrl: cfg?.baseUrl ?? '',
      chatModel: cfg?.chatModel ?? '',
      embeddingModel: cfg?.embeddingModel ?? '',
      defaults: { baseUrl: env.OPENAI_BASE_URL, chatModel: env.AI_DEFAULT_MODEL, embeddingModel: env.AI_EMBEDDING_MODEL },
      instructions: tenant?.aiInstructions ?? '',
      pricing: { inputPer1M: env.AI_PRICE_INPUT_PER_1M, outputPer1M: env.AI_PRICE_OUTPUT_PER_1M },
    };
  }

  async updateSettings(actor: Actor, input: z.infer<typeof aiSettingsSchema>) {
    const current = (await this.stored(actor.tenantId)) ?? { provider: 'openai' as const };
    const next: StoredAIConfig = {
      provider: 'openai',
      apiKey: input.clearApiKey ? undefined : (input.apiKey ?? current.apiKey),
      // The settings form always submits the full state; empty values fall back to platform defaults.
      baseUrl: input.baseUrl,
      chatModel: input.chatModel,
      embeddingModel: input.embeddingModel,
    };
    await this.prisma.tenant.update({
      where: { id: actor.tenantId },
      data: {
        aiConfigEnc: encryptJson(next),
        ...(input.instructions !== undefined ? { aiInstructions: input.instructions } : {}),
      },
    });
    await this.audit.log(actor, {
      action: 'ai.settings_updated',
      entityType: 'Tenant',
      entityId: actor.tenantId,
      metadata: { apiKeyChanged: Boolean(input.apiKey) || Boolean(input.clearApiKey), chatModel: next.chatModel, baseUrl: next.baseUrl },
    });
    return this.getSettings(actor.tenantId);
  }

  /** Sends a tiny request to confirm the key and model work. */
  async testConnection(tenantId: string) {
    const started = Date.now();
    try {
      const res = await this.chat(
        tenantId,
        { messages: [{ role: 'user', content: 'Reply with the single word: ok' }], maxTokens: 5, temperature: 0 },
        { purpose: AIUsagePurpose.TEST },
      );
      return { ok: true, model: res.model, latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, error: (err as Error).message, latencyMs: Date.now() - started };
    }
  }
}
