/** An error that is safe to show the caller, with an intended HTTP status. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, msg, 'BAD_REQUEST', details);

export const notFound = (msg = 'Not found') =>
  new AppError(404, msg, 'NOT_FOUND');

export const upstreamFailed = (msg: string, details?: unknown) =>
  new AppError(502, msg, 'UPSTREAM_FAILED', details);

/**
 * The LLM returned something we could not use. Separate from a generic
 * upstream failure because it is retryable in a different way: the model
 * responded, it just did not respect the schema.
 */
export const invalidModelOutput = (msg: string, details?: unknown) =>
  new AppError(502, msg, 'INVALID_MODEL_OUTPUT', details);
