import type { NextFunction, Request, Response } from 'express';

import { isProd } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Single place where an error becomes an HTTP response.
 *
 * Express 5 forwards rejected promises from async handlers here
 * automatically, so route code does not need try/catch just to avoid an
 * unhandled rejection.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // Required: Express identifies error middleware by arity, so removing this
  // unused parameter silently turns it back into ordinary middleware.
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    logger.warn({ code: err.code, status: err.status }, err.message);
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      // Never leak stack traces or driver messages to clients in production;
      // they routinely contain connection strings and table names.
      message: isProd ? 'Something went wrong.' : String(err),
    },
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such route' } });
}
