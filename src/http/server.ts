import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import type { LoggerOptions } from 'pino';
import { mapError } from './errorMapper.js';
import type { Repositories } from './deps.js';
import { registerEvaluateRoutes } from './routes/evaluate.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerPreferencesRoutes } from './routes/preferences.js';

export interface ServerDeps {
  readonly loggerOptions: LoggerOptions;
  readonly isProduction: boolean;
  readonly repos: Repositories;
}

/**
 * Build a fully configured (but not yet listening) Fastify instance.
 * Dependencies are injected — the same factory is reused by integration tests
 * via `fastify.inject(...)`.
 */
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.loggerOptions,
    disableRequestLogging: false,
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      if (typeof header === 'string' && header.length > 0 && header.length <= 128) {
        return header;
      }
      return crypto.randomUUID();
    },
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'reqId',
    trustProxy: true,
    bodyLimit: 1024 * 1024, // 1 MiB — preferences payloads are tiny
  });

  await app.register(sensible);

  // Echo request-id back to the client.
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  app.setErrorHandler((err: Error, req, reply) => {
    const mapped = mapError(err, deps.isProduction);
    if (mapped.statusCode >= 500) {
      req.log.error({ err }, 'request.failed');
    } else {
      req.log.warn({ err: { name: err.name, message: err.message } }, 'request.rejected');
    }
    return reply.code(mapped.statusCode).send(mapped.body);
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } }),
  );

  registerHealthRoutes(app);
  registerPreferencesRoutes(app, deps.repos);
  registerEvaluateRoutes(app, deps.repos);

  return app;
}
