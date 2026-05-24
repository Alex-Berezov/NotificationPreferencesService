import { RESPECTS_QUIET_HOURS, type PreferenceRecord } from './defaults.js';
import type { QuietHours } from './quietHours.js';
import type {
  Channel,
  EvaluationInput,
  EvaluationResult,
  GlobalPolicy,
  NotificationType,
} from './types.js';

export interface EvaluationContext {
  /** System defaults for all `(type, channel)` pairs. */
  readonly defaults: readonly PreferenceRecord[];
  /** User-specific overrides; subset of `(type, channel)` pairs. */
  readonly overrides: readonly PreferenceRecord[];
  /** User-specific quiet hours, or `null` if not configured. */
  readonly quietHours: QuietHours | null;
  /** Global policies applicable to the user's region. */
  readonly policies: readonly GlobalPolicy[];
}

const prefKey = (t: NotificationType, c: Channel): string => `${t}|${c}`;

/**
 * Pure decision function. Deterministic for given `(input, context)`.
 *
 * Priority (deny-wins):
 *   1. Global policy matches → `deny / blocked_by_global_policy`.
 *   2. No effective record → `deny / disabled_by_default` (opt-in safe).
 *   3. Effective record disabled → `deny / disabled_by_user`
 *      (or `disabled_by_default` if the source was the system default).
 *   4. Quiet hours apply (type respects them + interval contains instant)
 *      → `deny / quiet_hours`.
 *   5. Otherwise → `allow / allowed`.
 */
export function evaluate(input: EvaluationInput, ctx: EvaluationContext): EvaluationResult {
  // 1) Global policy — deny wins, channel `null` is wildcard.
  const policyHit = ctx.policies.some(
    (p) =>
      p.notificationType === input.notificationType &&
      p.region === input.region &&
      (p.channel === null || p.channel === input.channel),
  );
  if (policyHit) {
    return { decision: 'deny', reason: 'blocked_by_global_policy' };
  }

  // 2) Effective preference (override beats default).
  const k = prefKey(input.notificationType, input.channel);
  const override = ctx.overrides.find((r) => prefKey(r.type, r.channel) === k);
  const def = ctx.defaults.find((r) => prefKey(r.type, r.channel) === k);
  const effective = override ?? def;

  if (!effective) {
    return { decision: 'deny', reason: 'disabled_by_default' };
  }
  if (!effective.enabled) {
    return {
      decision: 'deny',
      reason: override !== undefined ? 'disabled_by_user' : 'disabled_by_default',
    };
  }

  // 3) Quiet hours — only types that respect them.
  if (
    RESPECTS_QUIET_HOURS[input.notificationType] &&
    ctx.quietHours?.containsInstant(input.datetime) === true
  ) {
    return { decision: 'deny', reason: 'quiet_hours' };
  }

  return { decision: 'allow', reason: 'allowed' };
}
