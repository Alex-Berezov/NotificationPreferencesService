import { ZodError } from 'zod';
import { ConflictError, DomainError, NotFoundError, ValidationError } from '../domain/errors.js';
import type { ErrorResponse } from './schemas.js';

export interface MappedError {
  readonly statusCode: number;
  readonly body: ErrorResponse;
}

/**
 * Translate domain / Zod / unknown errors into a stable HTTP envelope.
 * Stack traces and raw `Error.message` for unknown errors are deliberately
 * **not** leaked to clients — they go to the structured log instead.
 */
export function mapError(err: unknown, isProduction: boolean): MappedError {
  if (err instanceof ZodError) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: err.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
            code: i.code,
          })),
        },
      },
    };
  }

  if (err instanceof ValidationError) {
    return { statusCode: 400, body: { error: { code: err.code, message: err.message } } };
  }
  if (err instanceof NotFoundError) {
    return { statusCode: 404, body: { error: { code: err.code, message: err.message } } };
  }
  if (err instanceof ConflictError) {
    return { statusCode: 409, body: { error: { code: err.code, message: err.message } } };
  }
  if (err instanceof DomainError) {
    return { statusCode: 400, body: { error: { code: err.code, message: err.message } } };
  }

  // Unknown / unexpected — generic 500. Never echo raw message in production.
  const message = !isProduction && err instanceof Error ? err.message : 'Internal server error';
  return {
    statusCode: 500,
    body: { error: { code: 'internal_error', message } },
  };
}
