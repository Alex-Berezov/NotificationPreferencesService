import type { Channel, NotificationType } from './types.js';

export interface PreferenceKey {
  readonly type: NotificationType;
  readonly channel: Channel;
}

export interface PreferenceRecord extends PreferenceKey {
  readonly enabled: boolean;
}

/**
 * Per-NotificationType flag: whether quiet hours should be respected.
 * Convention from the spec: `marketing_*` respect quiet hours,
 * `transactional_*` do not. Closed table — drift-resistant.
 */
export const RESPECTS_QUIET_HOURS: Readonly<Record<NotificationType, boolean>> = {
  transactional_email: false,
  marketing_email: true,
  transactional_sms: false,
  marketing_sms: true,
  transactional_push: false,
  marketing_push: true,
  transactional_messenger: false,
  marketing_messenger: true,
};

const keyOf = (k: PreferenceKey): string => `${k.type}|${k.channel}`;

/**
 * Merge user overrides on top of system defaults by `(type, channel)` key.
 * Overrides win. Result order is unspecified — call-sites that need a stable
 * order should sort explicitly.
 */
export function mergePreferences(
  defaults: readonly PreferenceRecord[],
  overrides: readonly PreferenceRecord[],
): PreferenceRecord[] {
  const map = new Map<string, PreferenceRecord>();
  for (const r of defaults) map.set(keyOf(r), r);
  for (const r of overrides) map.set(keyOf(r), r);
  return [...map.values()];
}
