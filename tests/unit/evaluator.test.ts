import { describe, it, expect } from 'vitest';
import { RESPECTS_QUIET_HOURS, type PreferenceRecord } from '../../src/domain/defaults.js';
import { evaluate, type EvaluationContext } from '../../src/domain/evaluator.js';
import { QuietHours } from '../../src/domain/quietHours.js';
import {
  parseRegion,
  parseUserId,
  type Channel,
  type EvaluationInput,
  type GlobalPolicy,
  type NotificationType,
  type Region,
} from '../../src/domain/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALL_CHANNELS: readonly Channel[] = ['email', 'sms', 'push', 'messenger'];

const allDefaults: readonly PreferenceRecord[] = (
  [
    'transactional_email',
    'marketing_email',
    'transactional_sms',
    'marketing_sms',
    'transactional_push',
    'marketing_push',
    'transactional_messenger',
    'marketing_messenger',
  ] as const
).map((t) => {
  const channel = t.split('_')[1] as Channel;
  return { type: t, channel, enabled: t.startsWith('transactional_') };
});

const baseInput = (
  notificationType: NotificationType,
  channel: Channel,
  overrides: Partial<EvaluationInput> = {},
): EvaluationInput => ({
  userId: parseUserId('u-1'),
  notificationType,
  channel,
  region: parseRegion('EU'),
  datetime: new Date('2026-05-21T12:00:00Z'),
  ...overrides,
});

const ctx = (over: Partial<EvaluationContext> = {}): EvaluationContext => ({
  defaults: allDefaults,
  overrides: [],
  quietHours: null,
  policies: [],
  ...over,
});

// ---------------------------------------------------------------------------
// Sanity: RESPECTS_QUIET_HOURS invariant
// ---------------------------------------------------------------------------

describe('RESPECTS_QUIET_HOURS', () => {
  it('marketing_* respect quiet hours; transactional_* do not', () => {
    for (const channel of ALL_CHANNELS) {
      expect(RESPECTS_QUIET_HOURS[`marketing_${channel}` as NotificationType]).toBe(true);
      expect(RESPECTS_QUIET_HOURS[`transactional_${channel}` as NotificationType]).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 5 scenarios from the spec
// ---------------------------------------------------------------------------

describe('evaluate — spec scenarios', () => {
  it('1) new user with no overrides → defaults apply', () => {
    expect(evaluate(baseInput('transactional_email', 'email'), ctx())).toEqual({
      decision: 'allow',
      reason: 'allowed',
    });
    expect(evaluate(baseInput('marketing_email', 'email'), ctx())).toEqual({
      decision: 'deny',
      reason: 'disabled_by_default',
    });
  });

  it('2) user disables marketing_email → disabled_by_user; transactional_email stays allowed', () => {
    const overrides: PreferenceRecord[] = [
      { type: 'marketing_email', channel: 'email', enabled: false },
    ];
    expect(evaluate(baseInput('marketing_email', 'email'), ctx({ overrides }))).toEqual({
      decision: 'deny',
      reason: 'disabled_by_user',
    });
    expect(evaluate(baseInput('transactional_email', 'email'), ctx({ overrides }))).toEqual({
      decision: 'allow',
      reason: 'allowed',
    });
  });

  it('3) quiet hours Europe/Berlin 22:00–08:00; marketing_push at 23:30 local → quiet_hours; transactional_push → allow', () => {
    // 21:30Z = 23:30 Berlin (CEST, UTC+2) on 2026-05-21
    const datetime = new Date('2026-05-21T21:30:00Z');
    const quietHours = QuietHours.fromHHMM('22:00', '08:00', 'Europe/Berlin');
    // marketing_push enabled by override (so the only deny gate left is QH)
    const overrides: PreferenceRecord[] = [
      { type: 'marketing_push', channel: 'push', enabled: true },
    ];

    expect(
      evaluate(baseInput('marketing_push', 'push', { datetime }), ctx({ overrides, quietHours })),
    ).toEqual({ decision: 'deny', reason: 'quiet_hours' });

    expect(
      evaluate(baseInput('transactional_push', 'push', { datetime }), ctx({ quietHours })),
    ).toEqual({ decision: 'allow', reason: 'allowed' });
  });

  it('4) global policy marketing_sms + EU → blocked_by_global_policy (even if user enabled it)', () => {
    const policies: GlobalPolicy[] = [
      {
        notificationType: 'marketing_sms',
        region: parseRegion('EU'),
        channel: 'sms',
        action: 'deny',
        reasonCode: 'blocked_by_global_policy',
      },
    ];
    const overrides: PreferenceRecord[] = [
      { type: 'marketing_sms', channel: 'sms', enabled: true },
    ];
    expect(evaluate(baseInput('marketing_sms', 'sms'), ctx({ overrides, policies }))).toEqual({
      decision: 'deny',
      reason: 'blocked_by_global_policy',
    });
  });

  it('5) evaluate is pure / deterministic', () => {
    const input = baseInput('marketing_email', 'email');
    const c = ctx();
    const a = evaluate(input, c);
    const b = evaluate(input, c);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Priority ordering
// ---------------------------------------------------------------------------

describe('evaluate — deny-wins priority', () => {
  it('global policy beats quiet hours and user override', () => {
    const policies: GlobalPolicy[] = [
      {
        notificationType: 'marketing_push',
        region: parseRegion('EU'),
        channel: null, // wildcard
        action: 'deny',
        reasonCode: 'blocked_by_global_policy',
      },
    ];
    const quietHours = QuietHours.fromHHMM('22:00', '08:00', 'Europe/Berlin');
    const overrides: PreferenceRecord[] = [
      { type: 'marketing_push', channel: 'push', enabled: true },
    ];
    const datetime = new Date('2026-05-21T21:30:00Z'); // inside QH
    expect(
      evaluate(
        baseInput('marketing_push', 'push', { datetime }),
        ctx({ policies, overrides, quietHours }),
      ),
    ).toEqual({ decision: 'deny', reason: 'blocked_by_global_policy' });
  });

  it('disabled_by_user beats quiet_hours', () => {
    const quietHours = QuietHours.fromHHMM('22:00', '08:00', 'Europe/Berlin');
    const overrides: PreferenceRecord[] = [
      { type: 'marketing_email', channel: 'email', enabled: false },
    ];
    const datetime = new Date('2026-05-21T21:30:00Z');
    expect(
      evaluate(baseInput('marketing_email', 'email', { datetime }), ctx({ overrides, quietHours })),
    ).toEqual({ decision: 'deny', reason: 'disabled_by_user' });
  });

  it('quiet_hours is bypassed for transactional types even within the window', () => {
    const quietHours = QuietHours.fromHHMM('22:00', '08:00', 'Europe/Berlin');
    const datetime = new Date('2026-05-21T21:30:00Z');
    expect(
      evaluate(baseInput('transactional_email', 'email', { datetime }), ctx({ quietHours })),
    ).toEqual({ decision: 'allow', reason: 'allowed' });
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('evaluate — edge cases', () => {
  it('missing default for (type, channel) → disabled_by_default', () => {
    expect(evaluate(baseInput('marketing_email', 'email'), ctx({ defaults: [] }))).toEqual({
      decision: 'deny',
      reason: 'disabled_by_default',
    });
  });

  it('policy with wildcard channel (null) matches any channel of the type', () => {
    const policies: GlobalPolicy[] = [
      {
        notificationType: 'marketing_sms',
        region: parseRegion('EU'),
        channel: null,
        action: 'deny',
        reasonCode: 'blocked_by_global_policy',
      },
    ];
    expect(evaluate(baseInput('marketing_sms', 'sms'), ctx({ policies }))).toEqual({
      decision: 'deny',
      reason: 'blocked_by_global_policy',
    });
  });

  it('policy for different region does not apply', () => {
    const policies: GlobalPolicy[] = [
      {
        notificationType: 'marketing_sms',
        region: 'US' as Region,
        channel: 'sms',
        action: 'deny',
        reasonCode: 'blocked_by_global_policy',
      },
    ];
    const overrides: PreferenceRecord[] = [
      { type: 'marketing_sms', channel: 'sms', enabled: true },
    ];
    expect(evaluate(baseInput('marketing_sms', 'sms'), ctx({ overrides, policies }))).toEqual({
      decision: 'allow',
      reason: 'allowed',
    });
  });
});
