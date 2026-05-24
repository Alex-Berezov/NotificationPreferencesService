import type { FastifyInstance } from 'fastify';
import { getPreferences } from '../../application/getPreferences.js';
import type {
  EffectivePreferencesView,
  UpdatePreferencesCommand,
} from '../../application/ports.js';
import { updatePreferences } from '../../application/updatePreferences.js';
import { QuietHours } from '../../domain/quietHours.js';
import { parseUserId } from '../../domain/types.js';
import type { Repositories } from '../deps.js';
import {
  GetPreferencesParamsSchema,
  UpdatePreferencesBodySchema,
  type GetPreferencesResponse,
} from '../schemas.js';

function toResponse(view: EffectivePreferencesView): GetPreferencesResponse {
  return {
    userId: view.userId,
    entries: view.entries.map((e) => ({
      type: e.type,
      channel: e.channel,
      enabled: e.enabled,
      source: e.source,
    })),
    quietHours: view.quietHours === null ? null : view.quietHours.toHHMM(),
  };
}

export function registerPreferencesRoutes(app: FastifyInstance, repos: Repositories): void {
  app.get('/users/:id/preferences', async (req, reply) => {
    const { id } = GetPreferencesParamsSchema.parse(req.params);
    const userId = parseUserId(id);
    const view = await getPreferences(userId, repos);
    return reply.code(200).send(toResponse(view));
  });

  app.post('/users/:id/preferences', async (req, reply) => {
    const { id } = GetPreferencesParamsSchema.parse(req.params);
    const userId = parseUserId(id);
    const body = UpdatePreferencesBodySchema.parse(req.body);

    const command: UpdatePreferencesCommand = {
      ...(body.toggles !== undefined ? { toggles: body.toggles } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'quietHours')
        ? {
            quietHours:
              body.quietHours === null || body.quietHours === undefined
                ? null
                : QuietHours.fromHHMM(
                    body.quietHours.start,
                    body.quietHours.end,
                    body.quietHours.timezone,
                  ),
          }
        : {}),
    };

    const view = await updatePreferences(userId, command, { ...repos, logger: req.log });
    return reply.code(200).send(toResponse(view));
  });
}
