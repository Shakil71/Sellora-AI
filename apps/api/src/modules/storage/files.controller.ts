import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { Auth, CurrentActor, Public, RawResponse } from '../../common/decorators';
import type { Actor, AppRequest, AuthContext } from '../../common/auth-context';
import { AppException, NotFoundError } from '../../common/errors';
import { env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadsService, UPLOAD_PURPOSES, PUBLIC_FOLDERS } from './uploads.service';
import { StorageService } from './storage.service';

const uploadQuery = z.object({ purpose: z.enum(UPLOAD_PURPOSES) });

@Controller('files')
export class FilesController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } }),
  )
  async upload(
    @CurrentActor() actor: Actor,
    @Auth() auth: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query() query: Record<string, string>,
  ) {
    const parsed = uploadQuery.safeParse(query);
    if (!parsed.success) throw new AppException('INVALID_PURPOSE', 'Unknown upload purpose');
    if (!file) throw new AppException('NO_FILE', 'Attach a file to upload');
    const needs: Record<string, string> = {
      product: 'products.update',
      category: 'products.update',
      avatar: '',
      branding: 'settings.update',
      attachment: 'conversations.reply',
      document: 'ai.knowledge.manage',
    };
    const required = needs[parsed.data.purpose];
    if (required && !auth.permissions.has(required) && !(parsed.data.purpose === 'product' && auth.permissions.has('products.create'))) {
      throw new ForbiddenException('You do not have permission to upload this file');
    }
    return this.uploads.store(actor, file, parsed.data.purpose);
  }

  /**
   * Serves stored files. Public folders (product images, logos, message media)
   * use unguessable keys; private folders require a session in the same workspace.
   */
  @Get('*path')
  @Public()
  @RawResponse()
  async serve(@Param('path') pathParam: string | string[], @Req() req: AppRequest, @Res() res: Response) {
    const key = Array.isArray(pathParam) ? pathParam.join('/') : pathParam;
    const [tenantId, folder] = key.split('/');
    if (!tenantId || !folder) throw new NotFoundError('File');
    const isPublic = (PUBLIC_FOLDERS as readonly string[]).includes(folder);
    if (!isPublic && req.auth?.tenantId !== tenantId) throw new NotFoundError('File');

    const record = await this.prisma.storedFile.findUnique({ where: { key } });
    if (!record || record.tenantId !== tenantId) throw new NotFoundError('File');
    let body: Buffer;
    try {
      body = await this.storage.get(key);
    } catch {
      throw new NotFoundError('File');
    }
    res.setHeader('Content-Type', record.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Cache-Control', isPublic ? 'public, max-age=604800, immutable' : 'private, max-age=300');
    const inline = record.mimeType.startsWith('image/') || record.mimeType === 'application/pdf';
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(record.originalName)}"`,
    );
    res.send(body);
  }
}
