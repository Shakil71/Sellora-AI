import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ZodType, ZodTypeDef } from 'zod';
import { ValidationError } from './errors';

/**
 * Validates and parses input with a Zod schema. Unknown keys are stripped by
 * the schemas (z.object default), which prevents mass-assignment of fields
 * such as tenantId.
 */
@Injectable()
export class ZodPipe<T> implements PipeTransform {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly schema: ZodType<T, ZodTypeDef, any>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      const fieldErrors = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      const first = fieldErrors[0];
      throw new ValidationError(
        first ? `${first.path ? `${first.path}: ` : ''}${first.message}` : 'Invalid input',
        fieldErrors,
      );
    }
    return result.data;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const zBody = <T>(schema: ZodType<T, ZodTypeDef, any>) => new ZodPipe<T>(schema);
