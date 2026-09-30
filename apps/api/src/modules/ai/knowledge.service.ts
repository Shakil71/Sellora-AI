import { Injectable, Logger } from '@nestjs/common';
import { DocumentStatus, KnowledgeSourceType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { UploadsService } from '../storage/uploads.service';
import { UsageService } from '../billing/usage.service';
import { RealtimeService, REALTIME_EVENTS } from '../realtime/realtime.service';
import { QueueService } from '../../queue/queue.module';
import { AIProviderService } from './ai-provider.service';
import { chunkText, cosineSimilarity, extractDocx, extractPdf, fetchPublicPage, assertPublicUrl } from './text-extraction';
import { ensureFound, ValidationError } from '../../common/errors';
import { estimateTokens } from '../../common/utils/text.util';
import type { Actor } from '../../common/auth-context';

export const knowledgeBaseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
});

export const textDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(20, 'Add at least a few sentences').max(200_000),
});

export const urlDocumentSchema = z.object({
  url: z.string().url().max(1000),
  title: z.string().trim().max(200).optional(),
});

const EMBED_BATCH = 64;
const MAX_CANDIDATES = 3000;

export interface RetrievedChunk {
  id: string;
  content: string;
  documentTitle: string;
  score: number;
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly uploads: UploadsService,
    private readonly usage: UsageService,
    private readonly realtime: RealtimeService,
    private readonly queues: QueueService,
    private readonly ai: AIProviderService,
  ) {}

  // ---------------------------------------------------------- knowledge bases

  async list(tenantId: string) {
    const kbs = await this.prisma.aIKnowledgeBase.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { documents: true, chunks: true } },
        agents: { include: { agent: { select: { id: true, name: true } } } },
      },
    });
    return kbs.map(({ _count, agents, ...kb }) => ({ ...kb, documentCount: _count.documents, chunkCount: _count.chunks, agents: agents.map((a) => a.agent) }));
  }

  async get(tenantId: string, id: string) {
    const kb = ensureFound(await this.prisma.aIKnowledgeBase.findFirst({ where: { id, tenantId } }), 'Knowledge base');
    const documents = await this.prisma.aIDocument.findMany({
      where: { tenantId, knowledgeBaseId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, title: true, sourceType: true, sourceUrl: true, mimeType: true, sizeBytes: true, status: true, error: true,
        chunkCount: true, embeddedCount: true, tokenCount: true, processedAt: true, createdAt: true,
      },
    });
    return { ...kb, documents, aiConfigured: await this.ai.isConfigured(tenantId) };
  }

  async create(actor: Actor, input: z.infer<typeof knowledgeBaseSchema>) {
    const kb = await this.prisma.aIKnowledgeBase.create({ data: { ...input, tenantId: actor.tenantId } });
    await this.audit.log(actor, { action: 'ai.knowledge_base_created', entityType: 'AIKnowledgeBase', entityId: kb.id, metadata: { name: kb.name } });
    return kb;
  }

  async update(actor: Actor, id: string, input: Partial<z.infer<typeof knowledgeBaseSchema>>) {
    ensureFound(await this.prisma.aIKnowledgeBase.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Knowledge base');
    return this.prisma.aIKnowledgeBase.update({ where: { id }, data: input });
  }

  async remove(actor: Actor, id: string) {
    const kb = ensureFound(await this.prisma.aIKnowledgeBase.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Knowledge base');
    const docs = await this.prisma.aIDocument.findMany({ where: { knowledgeBaseId: id }, select: { storageKey: true } });
    await this.prisma.aIKnowledgeBase.delete({ where: { id } });
    for (const d of docs) if (d.storageKey) await this.storage.delete(d.storageKey);
    await this.audit.log(actor, { action: 'ai.knowledge_base_deleted', entityType: 'AIKnowledgeBase', entityId: id, metadata: { name: kb.name } });
    return { deleted: true };
  }

  // ---------------------------------------------------------------- documents

  private async prepare(actor: Actor, kbId: string) {
    ensureFound(await this.prisma.aIKnowledgeBase.findFirst({ where: { id: kbId, tenantId: actor.tenantId } }), 'Knowledge base');
    await this.usage.assertWithin(actor.tenantId, 'knowledgeDocuments');
  }

  async addText(actor: Actor, kbId: string, input: z.infer<typeof textDocumentSchema>) {
    await this.prepare(actor, kbId);
    const doc = await this.prisma.aIDocument.create({
      data: { tenantId: actor.tenantId, knowledgeBaseId: kbId, title: input.title, sourceType: KnowledgeSourceType.TEXT, rawText: input.content, sizeBytes: Buffer.byteLength(input.content), createdById: actor.userId },
    });
    await this.queues.processDocument(actor.tenantId, doc.id);
    await this.audit.log(actor, { action: 'ai.document_added', entityType: 'AIDocument', entityId: doc.id, metadata: { title: doc.title, type: 'TEXT' } });
    return doc;
  }

  async addUrl(actor: Actor, kbId: string, input: z.infer<typeof urlDocumentSchema>) {
    await this.prepare(actor, kbId);
    try {
      await assertPublicUrl(input.url);
    } catch (err) {
      throw new ValidationError((err as Error).message);
    }
    const doc = await this.prisma.aIDocument.create({
      data: { tenantId: actor.tenantId, knowledgeBaseId: kbId, title: input.title || input.url, sourceType: KnowledgeSourceType.WEBSITE, sourceUrl: input.url, createdById: actor.userId },
    });
    await this.queues.processDocument(actor.tenantId, doc.id);
    await this.audit.log(actor, { action: 'ai.document_added', entityType: 'AIDocument', entityId: doc.id, metadata: { url: input.url, type: 'WEBSITE' } });
    return doc;
  }

  async addFile(actor: Actor, kbId: string, file: { buffer: Buffer; originalname: string; size: number }) {
    await this.prepare(actor, kbId);
    const stored = await this.uploads.store(actor, file, 'document');
    const sourceType =
      stored.mimeType === 'application/pdf'
        ? KnowledgeSourceType.PDF
        : stored.mimeType.includes('wordprocessingml')
          ? KnowledgeSourceType.DOCX
          : stored.mimeType === 'text/markdown'
            ? KnowledgeSourceType.MARKDOWN
            : KnowledgeSourceType.TXT;
    const doc = await this.prisma.aIDocument.create({
      data: {
        tenantId: actor.tenantId,
        knowledgeBaseId: kbId,
        title: stored.name,
        sourceType,
        storageKey: stored.key,
        mimeType: stored.mimeType,
        sizeBytes: stored.size,
        createdById: actor.userId,
      },
    });
    await this.queues.processDocument(actor.tenantId, doc.id);
    await this.audit.log(actor, { action: 'ai.document_added', entityType: 'AIDocument', entityId: doc.id, metadata: { title: doc.title, type: sourceType } });
    return doc;
  }

  async removeDocument(actor: Actor, id: string) {
    const doc = ensureFound(await this.prisma.aIDocument.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Document');
    await this.prisma.aIDocument.delete({ where: { id } });
    if (doc.storageKey) {
      await this.storage.delete(doc.storageKey);
      await this.prisma.storedFile.deleteMany({ where: { key: doc.storageKey, tenantId: actor.tenantId } });
    }
    await this.audit.log(actor, { action: 'ai.document_deleted', entityType: 'AIDocument', entityId: id, metadata: { title: doc.title } });
    return { deleted: true };
  }

  async reindexDocument(actor: Actor, id: string) {
    const doc = ensureFound(await this.prisma.aIDocument.findFirst({ where: { id, tenantId: actor.tenantId } }), 'Document');
    await this.prisma.aIDocument.update({ where: { id }, data: { status: DocumentStatus.PENDING, error: null } });
    await this.queues.processDocument(actor.tenantId, doc.id);
    return { queued: true };
  }

  async reindexKnowledgeBase(actor: Actor, kbId: string) {
    ensureFound(await this.prisma.aIKnowledgeBase.findFirst({ where: { id: kbId, tenantId: actor.tenantId } }), 'Knowledge base');
    const docs = await this.prisma.aIDocument.findMany({ where: { tenantId: actor.tenantId, knowledgeBaseId: kbId }, select: { id: true } });
    await this.prisma.aIDocument.updateMany({ where: { knowledgeBaseId: kbId }, data: { status: DocumentStatus.PENDING, error: null } });
    for (const d of docs) await this.queues.processDocument(actor.tenantId, d.id);
    await this.audit.log(actor, { action: 'ai.knowledge_base_reindexed', entityType: 'AIKnowledgeBase', entityId: kbId, metadata: { documents: docs.length } });
    return { queued: docs.length };
  }

  private emit(tenantId: string, doc: { id: string; knowledgeBaseId: string; status: DocumentStatus }) {
    this.realtime.toPermission(tenantId, 'ai.knowledge.view', REALTIME_EVENTS.DOCUMENT_UPDATED, doc);
  }

  /** Worker: extract → chunk → embed. Keyword retrieval works even without embeddings. */
  async process(tenantId: string, documentId: string) {
    const doc = await this.prisma.aIDocument.findFirst({ where: { id: documentId, tenantId } });
    if (!doc) return;
    await this.prisma.aIDocument.update({ where: { id: doc.id }, data: { status: DocumentStatus.PROCESSING, error: null } });
    this.emit(tenantId, { ...doc, status: DocumentStatus.PROCESSING });
    try {
      let text = '';
      let title = doc.title;
      switch (doc.sourceType) {
        case KnowledgeSourceType.TEXT:
          text = doc.rawText ?? '';
          break;
        case KnowledgeSourceType.WEBSITE: {
          const page = await fetchPublicPage(doc.sourceUrl!);
          text = page.text;
          if (page.title && doc.title === doc.sourceUrl) title = page.title.slice(0, 200);
          break;
        }
        case KnowledgeSourceType.PDF:
          text = await extractPdf(await this.storage.get(doc.storageKey!));
          break;
        case KnowledgeSourceType.DOCX:
          text = await extractDocx(await this.storage.get(doc.storageKey!));
          break;
        default:
          text = (await this.storage.get(doc.storageKey!)).toString('utf8');
      }
      text = text.split(String.fromCharCode(0)).join('').trim();
      if (text.length < 20) throw new Error('No readable text was found in this source.');
      const hash = createHash('sha256').update(text).digest('hex');
      const pieces = chunkText(text);

      await this.prisma.$transaction(async (tx) => {
        await tx.aIDocumentChunk.deleteMany({ where: { documentId: doc.id } });
        await tx.aIDocumentChunk.createMany({
          data: pieces.map((content, index) => ({ tenantId, documentId: doc.id, knowledgeBaseId: doc.knowledgeBaseId, index, content, tokenCount: estimateTokens(content) })),
        });
        await tx.aIDocument.update({
          where: { id: doc.id },
          data: { title, chunkCount: pieces.length, tokenCount: estimateTokens(text), contentHash: hash, rawText: doc.sourceType === KnowledgeSourceType.TEXT ? doc.rawText : text.slice(0, 200_000) },
        });
      });

      let embedded = 0;
      let embedError: string | null = null;
      if (await this.ai.isConfigured(tenantId)) {
        const chunks = await this.prisma.aIDocumentChunk.findMany({ where: { documentId: doc.id }, orderBy: { index: 'asc' }, select: { id: true, content: true } });
        try {
          for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
            const batch = chunks.slice(i, i + EMBED_BATCH);
            const { vectors, model } = await this.ai.embed(tenantId, batch.map((c) => c.content));
            await this.prisma.aIEmbedding.createMany({
              data: batch.map((c, j) => ({ tenantId, chunkId: c.id, model, dimensions: vectors[j]!.length, vector: vectors[j]! })),
              skipDuplicates: true,
            });
            embedded += batch.length;
          }
        } catch (err) {
          embedError = `Indexed for keyword search only — embeddings failed: ${(err as Error).message}`;
          this.logger.warn(`Embedding failed for document ${doc.id}: ${(err as Error).message}`);
        }
      }
      const updated = await this.prisma.aIDocument.update({
        where: { id: doc.id },
        data: { status: DocumentStatus.READY, embeddedCount: embedded, processedAt: new Date(), error: embedError },
      });
      this.emit(tenantId, updated);
    } catch (err) {
      const updated = await this.prisma.aIDocument.update({
        where: { id: doc.id },
        data: { status: DocumentStatus.FAILED, error: (err as Error).message.slice(0, 500) },
      });
      this.emit(tenantId, updated);
    }
  }

  /**
   * Retrieval: semantic search when embeddings exist, otherwise PostgreSQL
   * full-text ranking with an ILIKE fallback.
   */
  async search(tenantId: string, knowledgeBaseIds: string[], query: string, topK = 4): Promise<RetrievedChunk[]> {
    if (!knowledgeBaseIds.length || !query.trim()) return [];
    const q = query.slice(0, 1000);
    const hasEmbeddings = await this.prisma.aIEmbedding.count({ where: { tenantId, chunk: { knowledgeBaseId: { in: knowledgeBaseIds } } }, take: 1 });
    if (hasEmbeddings && (await this.ai.isConfigured(tenantId))) {
      try {
        const { vectors } = await this.ai.embed(tenantId, [q]);
        const queryVector = vectors[0]!;
        const candidates = await this.prisma.aIEmbedding.findMany({
          where: { tenantId, chunk: { knowledgeBaseId: { in: knowledgeBaseIds } } },
          select: { vector: true, chunk: { select: { id: true, content: true, document: { select: { title: true } } } } },
          take: MAX_CANDIDATES,
          orderBy: { createdAt: 'desc' },
        });
        return candidates
          .map((c) => ({ id: c.chunk.id, content: c.chunk.content, documentTitle: c.chunk.document.title, score: cosineSimilarity(queryVector, c.vector) }))
          .filter((c) => c.score > 0.2)
          .sort((a, b) => b.score - a.score)
          .slice(0, topK);
      } catch (err) {
        this.logger.warn(`Semantic search failed, falling back to keywords: ${(err as Error).message}`);
      }
    }
    const rows = await this.prisma.$queryRaw<Array<{ id: string; content: string; title: string; score: number }>>`
      SELECT c.id, c.content, d.title, ts_rank(to_tsvector('simple', c.content), plainto_tsquery('simple', ${q})) AS score
      FROM "AIDocumentChunk" c JOIN "AIDocument" d ON d.id = c."documentId"
      WHERE c."tenantId" = ${tenantId}::uuid
        AND c."knowledgeBaseId" IN (${Prisma.join(knowledgeBaseIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND to_tsvector('simple', c.content) @@ plainto_tsquery('simple', ${q})
      ORDER BY score DESC LIMIT ${topK}`;
    if (rows.length) return rows.map((r) => ({ id: r.id, content: r.content, documentTitle: r.title, score: Number(r.score) }));
    // Fallback: any chunk containing one of the longer query words.
    const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 3).slice(0, 5);
    if (!words.length) return [];
    const loose = await this.prisma.aIDocumentChunk.findMany({
      where: { tenantId, knowledgeBaseId: { in: knowledgeBaseIds }, OR: words.map((w) => ({ content: { contains: w, mode: 'insensitive' as const } })) },
      include: { document: { select: { title: true } } },
      take: topK,
    });
    return loose.map((c) => ({ id: c.id, content: c.content, documentTitle: c.document.title, score: 0.1 }));
  }

  async testSearch(tenantId: string, kbId: string, query: string) {
    ensureFound(await this.prisma.aIKnowledgeBase.findFirst({ where: { id: kbId, tenantId } }), 'Knowledge base');
    return this.search(tenantId, [kbId], query, 5);
  }
}
