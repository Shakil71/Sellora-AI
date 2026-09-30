import { HttpException, HttpStatus } from '@nestjs/common';

/** Application error with a stable machine-readable code. */
export class AppException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export class NotFoundError extends AppException {
  constructor(entity = 'Resource') {
    super('NOT_FOUND', `${entity} not found`, HttpStatus.NOT_FOUND);
  }
}

export class ConflictError extends AppException {
  constructor(message: string) {
    super('CONFLICT', message, HttpStatus.CONFLICT);
  }
}

export class ValidationError extends AppException {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
}

/** Thrown when a workspace exceeds a plan limit. Maps to HTTP 402. */
export class LimitExceededError extends AppException {
  constructor(metric: string, limit: number) {
    super(
      'PLAN_LIMIT_REACHED',
      `Your plan allows ${limit} ${metric}. Upgrade your plan to continue.`,
      HttpStatus.PAYMENT_REQUIRED,
      { metric, limit },
    );
  }
}

/** A required integration (AI provider, WhatsApp, SMTP...) is not configured. */
export class NotConfiguredError extends AppException {
  constructor(what: string, hint?: string) {
    super('NOT_CONFIGURED', `${what} is not configured.${hint ? ` ${hint}` : ''}`, HttpStatus.PRECONDITION_FAILED);
  }
}

export function ensureFound<T>(value: T | null | undefined, entity = 'Resource'): T {
  if (value === null || value === undefined) throw new NotFoundError(entity);
  return value;
}
