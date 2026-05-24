import { ValidationError } from './errors.js';

/**
 * Nominal (branded) typing helper. The brand exists only at type level —
 * at runtime branded values are plain strings.
 */
declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

export const CHANNELS = ['email', 'sms', 'push', 'messenger'] as const;
export type Channel = (typeof CHANNELS)[number];

export const isChannel = (v: unknown): v is Channel =>
  typeof v === 'string' && (CHANNELS as readonly string[]).includes(v);

export const parseChannel = (v: unknown): Channel => {
  if (!isChannel(v)) {
    throw new ValidationError(`Invalid channel: ${String(v)}`);
  }
  return v;
};

// ---------------------------------------------------------------------------
// NotificationType
// ---------------------------------------------------------------------------

export const NOTIFICATION_TYPES = [
  'transactional_email',
  'marketing_email',
  'transactional_sms',
  'marketing_sms',
  'transactional_push',
  'marketing_push',
  'transactional_messenger',
  'marketing_messenger',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const isNotificationType = (v: unknown): v is NotificationType =>
  typeof v === 'string' && (NOTIFICATION_TYPES as readonly string[]).includes(v);

export const parseNotificationType = (v: unknown): NotificationType => {
  if (!isNotificationType(v)) {
    throw new ValidationError(`Invalid notificationType: ${String(v)}`);
  }
  return v;
};

// ---------------------------------------------------------------------------
// UserId — branded string, 1..256 chars, trimmed
// ---------------------------------------------------------------------------

export type UserId = Brand<string, 'UserId'>;

export const parseUserId = (v: unknown): UserId => {
  if (typeof v !== 'string') {
    throw new ValidationError('userId must be a string');
  }
  const trimmed = v.trim();
  if (trimmed.length === 0 || trimmed.length > 256) {
    throw new ValidationError('userId must be 1..256 characters');
  }
  return trimmed as UserId;
};

// ---------------------------------------------------------------------------
// Region — branded string, [A-Za-z0-9_-]{1,32}
// ---------------------------------------------------------------------------

export type Region = Brand<string, 'Region'>;

const REGION_RE = /^[A-Za-z0-9_-]{1,32}$/;

export const parseRegion = (v: unknown): Region => {
  if (typeof v !== 'string' || !REGION_RE.test(v)) {
    throw new ValidationError(`Invalid region: ${String(v)}`);
  }
  return v as Region;
};

// ---------------------------------------------------------------------------
// Decision / Reason
// ---------------------------------------------------------------------------

export type Decision = 'allow' | 'deny';

export type Reason =
  | 'allowed'
  | 'blocked_by_global_policy'
  | 'disabled_by_user'
  | 'disabled_by_default'
  | 'quiet_hours';

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface EvaluationInput {
  readonly userId: UserId;
  readonly notificationType: NotificationType;
  readonly channel: Channel;
  readonly region: Region;
  /** Always interpreted as UTC instant. */
  readonly datetime: Date;
}

export interface EvaluationResult {
  readonly decision: Decision;
  readonly reason: Reason;
}

// ---------------------------------------------------------------------------
// Global policy
// ---------------------------------------------------------------------------

export interface GlobalPolicy {
  readonly notificationType: NotificationType;
  readonly region: Region;
  /** `null` = wildcard (matches any channel). */
  readonly channel: Channel | null;
  readonly action: 'deny';
  readonly reasonCode: Extract<Reason, 'blocked_by_global_policy'>;
}
