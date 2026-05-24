import { z } from 'zod';
import { CHANNELS, NOTIFICATION_TYPES } from '../domain/types.js';

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------

export const ChannelSchema = z.enum(CHANNELS);
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export const RegionSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,32}$/, 'region must match [A-Za-z0-9_-]{1,32}');
export const UserIdParamSchema = z.string().trim().min(1).max(256);

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const HHMMSchema = z.string().regex(HHMM_RE, 'expected HH:mm in 00:00..23:59');

export const QuietHoursSchema = z.object({
  start: HHMMSchema,
  end: HHMMSchema,
  timezone: z.string().min(1).max(64),
});

// ---------------------------------------------------------------------------
// GET /users/:id/preferences
// ---------------------------------------------------------------------------

export const GetPreferencesParamsSchema = z.object({ id: UserIdParamSchema });

export const PreferenceEntrySchema = z.object({
  type: NotificationTypeSchema,
  channel: ChannelSchema,
  enabled: z.boolean(),
  source: z.enum(['default', 'override']),
});

export const GetPreferencesResponseSchema = z.object({
  userId: z.string(),
  entries: z.array(PreferenceEntrySchema),
  quietHours: QuietHoursSchema.nullable(),
});

// ---------------------------------------------------------------------------
// POST /users/:id/preferences
// ---------------------------------------------------------------------------

export const PreferenceToggleSchema = z.object({
  type: NotificationTypeSchema,
  channel: ChannelSchema,
  enabled: z.boolean(),
});

/**
 * Partial-merge body. At least one of {`toggles`, `quietHours`} must be
 * present. `quietHours: null` is meaningful — it clears the configuration.
 */
export const UpdatePreferencesBodySchema = z
  .object({
    toggles: z.array(PreferenceToggleSchema).max(64).optional(),
    quietHours: QuietHoursSchema.nullable().optional(),
  })
  .strict()
  .refine((b) => b.toggles !== undefined || Object.prototype.hasOwnProperty.call(b, 'quietHours'), {
    message: 'body must contain at least one of: toggles, quietHours',
  });

// ---------------------------------------------------------------------------
// POST /evaluate
// ---------------------------------------------------------------------------

export const EvaluateBodySchema = z
  .object({
    userId: UserIdParamSchema,
    notificationType: NotificationTypeSchema,
    channel: ChannelSchema,
    region: RegionSchema,
    datetime: z.iso.datetime({ offset: true }),
  })
  .strict();

export const EvaluateResponseSchema = z.object({
  decision: z.enum(['allow', 'deny']),
  reason: z.enum([
    'allowed',
    'blocked_by_global_policy',
    'disabled_by_user',
    'disabled_by_default',
    'quiet_hours',
  ]),
});

// ---------------------------------------------------------------------------
// Error response
// ---------------------------------------------------------------------------

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type GetPreferencesParams = z.infer<typeof GetPreferencesParamsSchema>;
export type GetPreferencesResponse = z.infer<typeof GetPreferencesResponseSchema>;
export type UpdatePreferencesBody = z.infer<typeof UpdatePreferencesBodySchema>;
export type EvaluateBody = z.infer<typeof EvaluateBodySchema>;
export type EvaluateResponse = z.infer<typeof EvaluateResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
