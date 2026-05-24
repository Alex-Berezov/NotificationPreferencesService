import type { PreferenceRecord } from '../domain/defaults.js';
import type { QuietHours } from '../domain/quietHours.js';
import type { Channel, GlobalPolicy, NotificationType, Region, UserId } from '../domain/types.js';

// ---------------------------------------------------------------------------
// Outbound ports — implemented by infrastructure adapters.
// ---------------------------------------------------------------------------

export interface PreferencesRepository {
  getOverrides(userId: UserId): Promise<PreferenceRecord[]>;
  getQuietHours(userId: UserId): Promise<QuietHours | null>;
  /** Idempotent batch upsert by `(userId, type, channel)`. */
  upsertOverrides(userId: UserId, records: readonly PreferenceRecord[]): Promise<void>;
  /** `null` clears the row. */
  setQuietHours(userId: UserId, qh: QuietHours | null): Promise<void>;
}

export interface DefaultsRepository {
  getAll(): Promise<PreferenceRecord[]>;
}

export interface PolicyRepository {
  findApplicable(type: NotificationType, region: Region): Promise<GlobalPolicy[]>;
}

export interface Clock {
  now(): Date;
}

export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
}

// ---------------------------------------------------------------------------
// Application-level DTOs
// ---------------------------------------------------------------------------

export type PreferenceSource = 'default' | 'override';

export interface EffectivePreferenceEntry extends PreferenceRecord {
  readonly source: PreferenceSource;
}

export interface EffectivePreferencesView {
  readonly userId: UserId;
  readonly entries: readonly EffectivePreferenceEntry[];
  readonly quietHours: QuietHours | null;
}

export interface PreferenceToggle {
  readonly type: NotificationType;
  readonly channel: Channel;
  readonly enabled: boolean;
}

/**
 * Partial update command. Missing keys mean "no change".
 * For `quietHours`, explicit `null` clears the configuration.
 */
export interface UpdatePreferencesCommand {
  readonly toggles?: readonly PreferenceToggle[];
  readonly quietHours?: QuietHours | null;
}
