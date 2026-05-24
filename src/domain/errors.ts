/**
 * Domain-level error hierarchy. Mapped to HTTP status codes at the boundary
 * by `errorMapper` in the HTTP layer. Carries a stable machine-readable `code`.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  readonly code = 'validation_error';
}

export class NotFoundError extends DomainError {
  readonly code = 'not_found';
}

export class ConflictError extends DomainError {
  readonly code = 'conflict';
}
