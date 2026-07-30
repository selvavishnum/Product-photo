import pino from 'pino';

import { env, isProd } from '../config/env.js';

export const logger = pino({
  level: isProd ? 'info' : 'debug',
  // Redaction is not optional here: request bodies carry OAuth tokens and API
  // keys, and logs are the most common way secrets escape a system.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.accessToken',
      '*.refreshToken',
      '*.accessTokenEnc',
      '*.apiKey',
    ],
    censor: '[redacted]',
  },
  ...(isProd ? {} : { transport: { target: 'pino-pretty' } }),
});

logger.debug({ provider: env.LLM_PROVIDER }, 'logger ready');
