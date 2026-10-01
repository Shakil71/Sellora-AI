import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentActor, RequirePermissions } from '../../common/decorators';
import type { Actor } from '../../common/auth-context';
import { zBody } from '../../common/zod.pipe';
import { AppException } from '../../common/errors';
import { importSourceSchema, ProductImportService, runImportSchema } from './product-import.service';

/** Bring a catalog in from a store link, API, feed or CSV file. */
@Controller('products/import')
export class ProductImportController {
  constructor(private readonly importer: ProductImportService) {}

  /** Reads the source and returns what would be imported. Nothing is saved. */
  @Post('preview')
  @HttpCode(200)
  @RequirePermissions('products.create')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  preview(@CurrentActor() actor: Actor, @Body(zBody(importSourceSchema)) body: z.infer<typeof importSourceSchema>) {
    return this.importer.preview(actor, body);
  }

  /** Same as preview, for an uploaded Excel, CSV, Word, PDF, JSON, XML or text file (up to 10 MB). */
  @Post('preview-file')
  @HttpCode(200)
  @RequirePermissions('products.create')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  previewFile(@CurrentActor() actor: Actor, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new AppException('NO_FILE', 'Choose a file to upload.');
    return this.importer.previewFile(actor, { originalname: file.originalname, buffer: file.buffer });
  }

  /** Imports one batch (up to 25 products) from a preview. */
  @Post('run')
  @HttpCode(200)
  @RequirePermissions('products.create')
  run(@CurrentActor() actor: Actor, @Body(zBody(runImportSchema)) body: z.infer<typeof runImportSchema>) {
    return this.importer.run(actor, body);
  }

  @Delete(':importId')
  @RequirePermissions('products.create')
  discard(@CurrentActor() actor: Actor, @Param('importId', new ParseUUIDPipe()) importId: string) {
    return this.importer.discard(actor, importId);
  }
}
