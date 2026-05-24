import type {
  DefaultsRepository,
  PolicyRepository,
  PreferencesRepository,
} from '../application/ports.js';

/** Bundle of infrastructure adapters required by the HTTP layer. */
export interface Repositories {
  readonly prefs: PreferencesRepository;
  readonly defaults: DefaultsRepository;
  readonly policies: PolicyRepository;
}
