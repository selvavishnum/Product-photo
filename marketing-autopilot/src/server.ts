import express from 'express';
import helmet from 'helmet';

import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import adRouter from './routes/ad.js';

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', provider: env.LLM_PROVIDER });
});

app.use('/api/v1/ad', adRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  logger.info(`listening on :${env.PORT}`);
});

// Without this, a container restart cuts in-flight ad generations mid-call --
// which for a paid LLM request means the user is billed for work they never
// received.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info(`${signal} received, draining connections`);
    server.close(() => process.exit(0));
  });
}
