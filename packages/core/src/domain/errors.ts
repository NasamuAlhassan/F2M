/** Domain-level failure with a stable code; surfaces map it to HTTP status or a USSD error line. */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function notFound(what: string): DomainError {
  return new DomainError(`${what} not found`, 'NOT_FOUND', 404);
}
