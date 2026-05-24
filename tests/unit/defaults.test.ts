import { describe, it, expect } from 'vitest';
import { mergePreferences, type PreferenceRecord } from '../../src/domain/defaults.js';

const rec = (
  type: PreferenceRecord['type'],
  channel: PreferenceRecord['channel'],
  enabled: boolean,
): PreferenceRecord => ({ type, channel, enabled });

describe('mergePreferences', () => {
  it('returns defaults when there are no overrides', () => {
    const defaults: PreferenceRecord[] = [
      rec('transactional_email', 'email', true),
      rec('marketing_email', 'email', false),
    ];
    const merged = mergePreferences(defaults, []);
    expect(merged).toHaveLength(2);
    expect(merged).toEqual(expect.arrayContaining(defaults));
  });

  it('overrides win by composite key (type, channel)', () => {
    const defaults: PreferenceRecord[] = [
      rec('marketing_email', 'email', false),
      rec('transactional_email', 'email', true),
    ];
    const overrides: PreferenceRecord[] = [rec('marketing_email', 'email', true)];
    const merged = mergePreferences(defaults, overrides);
    const me = merged.find((r) => r.type === 'marketing_email' && r.channel === 'email');
    const te = merged.find((r) => r.type === 'transactional_email' && r.channel === 'email');
    expect(me?.enabled).toBe(true);
    expect(te?.enabled).toBe(true);
  });

  it('keeps override-only records (defaults set may be incomplete)', () => {
    const overrides: PreferenceRecord[] = [rec('marketing_sms', 'sms', true)];
    const merged = mergePreferences([], overrides);
    expect(merged).toEqual(overrides);
  });
});
