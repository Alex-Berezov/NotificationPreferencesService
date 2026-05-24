import { mergePreferences } from '../domain/defaults.js';
import type { UserId } from '../domain/types.js';
import type {
  DefaultsRepository,
  EffectivePreferenceEntry,
  EffectivePreferencesView,
  PreferencesRepository,
} from './ports.js';

export interface GetPreferencesDeps {
  readonly prefs: PreferencesRepository;
  readonly defaults: DefaultsRepository;
}

const keyOf = (e: { type: string; channel: string }): string => `${e.type}|${e.channel}`;

/**
 * Returns the effective preference view for a user: defaults merged with
 * user overrides, annotated with `source`, plus the user's quiet-hours
 * configuration. Lazy materialization — no row is required to exist.
 */
export async function getPreferences(
  userId: UserId,
  deps: GetPreferencesDeps,
): Promise<EffectivePreferencesView> {
  const [defaultsList, overrides, quietHours] = await Promise.all([
    deps.defaults.getAll(),
    deps.prefs.getOverrides(userId),
    deps.prefs.getQuietHours(userId),
  ]);

  const overrideKeys = new Set(overrides.map(keyOf));
  const entries: EffectivePreferenceEntry[] = mergePreferences(defaultsList, overrides).map(
    (r) => ({
      ...r,
      source: overrideKeys.has(keyOf(r)) ? 'override' : 'default',
    }),
  );

  return { userId, entries, quietHours };
}
