import type { PreferenceRecord } from '../domain/defaults.js';
import type { QuietHours } from '../domain/quietHours.js';
import type { UserId } from '../domain/types.js';
import { getPreferences, type GetPreferencesDeps } from './getPreferences.js';
import type {
  EffectivePreferenceEntry,
  EffectivePreferencesView,
  Logger,
  UpdatePreferencesCommand,
} from './ports.js';

export interface UpdatePreferencesDeps extends GetPreferencesDeps {
  readonly logger: Logger;
}

interface ToggleDiff {
  readonly type: string;
  readonly channel: string;
  readonly before: boolean;
  readonly after: boolean;
}

interface QuietHoursSnapshot {
  readonly start: string;
  readonly end: string;
  readonly timezone: string;
}

interface QuietHoursDiff {
  readonly before: QuietHoursSnapshot | null;
  readonly after: QuietHoursSnapshot | null;
}

const keyOf = (e: { type: string; channel: string }): string => `${e.type}|${e.channel}`;

const snapshot = (qh: QuietHours | null): QuietHoursSnapshot | null =>
  qh === null ? null : qh.toHHMM();

const qhEquals = (a: QuietHoursSnapshot | null, b: QuietHoursSnapshot | null): boolean => {
  if (a === null || b === null) return a === b;
  return a.start === b.start && a.end === b.end && a.timezone === b.timezone;
};

function computeToggleDiff(
  before: readonly EffectivePreferenceEntry[],
  after: readonly EffectivePreferenceEntry[],
): ToggleDiff[] {
  const beforeMap = new Map(before.map((e) => [keyOf(e), e.enabled]));
  const diff: ToggleDiff[] = [];
  for (const a of after) {
    const b = beforeMap.get(keyOf(a));
    if (b !== undefined && b !== a.enabled) {
      diff.push({ type: a.type, channel: a.channel, before: b, after: a.enabled });
    }
  }
  return diff;
}

/**
 * Partial merge update: applies only the fields that are present on `command`.
 * Returns the post-update effective view.
 *
 * Idempotency: toggles upsert by `(userId, type, channel)`; quiet hours upsert
 * by `userId`. Repeated requests with the same payload converge to the same
 * state (no duplicate rows).
 */
export async function updatePreferences(
  userId: UserId,
  command: UpdatePreferencesCommand,
  deps: UpdatePreferencesDeps,
): Promise<EffectivePreferencesView> {
  const before = await getPreferences(userId, deps);

  if (command.toggles && command.toggles.length > 0) {
    const records: PreferenceRecord[] = command.toggles.map((t) => ({
      type: t.type,
      channel: t.channel,
      enabled: t.enabled,
    }));
    await deps.prefs.upsertOverrides(userId, records);
  }

  if (Object.prototype.hasOwnProperty.call(command, 'quietHours')) {
    await deps.prefs.setQuietHours(userId, command.quietHours ?? null);
  }

  const after = await getPreferences(userId, deps);

  const toggleDiff = computeToggleDiff(before.entries, after.entries);
  const quietHoursDiff: QuietHoursDiff | null = (() => {
    const b = snapshot(before.quietHours);
    const a = snapshot(after.quietHours);
    return qhEquals(a, b) ? null : { before: b, after: a };
  })();

  // METRIC: counter preferences_updated_total{user}
  deps.logger.info(
    {
      userId,
      toggleDiff,
      quietHoursDiff,
      toggleChangeCount: toggleDiff.length,
      quietHoursChanged: quietHoursDiff !== null,
    },
    'preferences.changed',
  );

  return after;
}
