import type { FastifyInstance } from 'fastify';
import { evaluateNotification } from '../../application/evaluateNotification.js';
import {
  parseChannel,
  parseNotificationType,
  parseRegion,
  parseUserId,
  type EvaluationInput,
} from '../../domain/types.js';
import type { Repositories } from '../deps.js';
import { EvaluateBodySchema, type EvaluateResponse } from '../schemas.js';

export function registerEvaluateRoutes(app: FastifyInstance, repos: Repositories): void {
  app.post('/evaluate', async (req, reply) => {
    const body = EvaluateBodySchema.parse(req.body);
    const input: EvaluationInput = {
      userId: parseUserId(body.userId),
      notificationType: parseNotificationType(body.notificationType),
      channel: parseChannel(body.channel),
      region: parseRegion(body.region),
      datetime: new Date(body.datetime),
    };
    const result = await evaluateNotification(input, { ...repos, logger: req.log });
    const payload: EvaluateResponse = { decision: result.decision, reason: result.reason };
    return reply.code(200).send(payload);
  });
}
