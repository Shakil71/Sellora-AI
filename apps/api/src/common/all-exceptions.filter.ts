import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';
import type { AppRequest } from './auth-context';
import { isProduction } from '../config/env';

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  402: 'PAYMENT_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
};

/**
 * Centralised error handling. Returns a consistent envelope, never leaks stack
 * traces in production and tags every error with the request id so support
 * can correlate it with logs.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AppRequest>();
    if (!res || typeof res.status !== 'function') return; // non-HTTP context (websocket)
    const requestId = req?.id ? String(req.id) : undefined;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong. Please try again.';
    let details: unknown;

    if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      code = 'RATE_LIMITED';
      message = 'Too many requests. Please slow down and try again shortly.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      code = STATUS_CODES[status] ?? 'ERROR';
      if (typeof response === 'string') {
        message = response;
      } else if (response && typeof response === 'object') {
        const r = response as { code?: string; message?: string | string[]; details?: unknown };
        if (r.code) code = r.code;
        if (Array.isArray(r.message)) message = r.message.join(', ');
        else if (r.message) message = r.message;
        details = r.details;
      }
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) message = 'The uploaded file or request is too large.';
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = 'CONFLICT';
        const target = (exception.meta?.target as string[] | undefined)?.filter((t) => t !== 'tenantId');
        message = target?.length ? `A record with this ${target.join(', ')} already exists.` : 'This record already exists.';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        code = 'NOT_FOUND';
        message = 'The requested record was not found.';
      } else if (exception.code === 'P2003') {
        status = HttpStatus.CONFLICT;
        code = 'IN_USE';
        message = 'This record is referenced by other records and cannot be changed.';
      }
    } else if (exception && typeof exception === 'object' && (exception as { type?: string }).type === 'entity.too.large') {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'The request body is too large.';
    }

    if (status >= 500) {
      const err = exception as Error;
      this.logger.error(
        { err: { message: err?.message, name: err?.name, stack: err?.stack }, requestId, path: req?.url },
        'Unhandled error',
      );
      if (!isProduction() && err?.message) details = { debug: err.message };
    }

    const body: ErrorBody = { success: false, error: { code, message, requestId } };
    if (details !== undefined) body.error.details = details;
    if (requestId) res.setHeader('x-request-id', requestId);
    res.status(status).json(body);
  }
}
