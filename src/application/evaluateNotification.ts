import { evaluate } from '../domain/evaluator.js';
import type { EvaluationInput, EvaluationResult } from '../domain/types.js';
import type {
  DefaultsRepository,
  Logger,
  PolicyRepository,
  PreferencesRepository,
} from './ports.js';

export interface EvaluateNotificationDeps {
  readonly prefs: PreferencesRepository;
  readonly defaults: DefaultsRepository;
  readonly policies: PolicyRepository;
  readonly logger: Logger;
}

/**
 * Loads evaluation context (defaults, user overrides, quiet hours, region
 * policies) and delegates to the pure `evaluate` domain function. Logs
 * the decision with full input context for auditing.
 */
export async function evaluateNotification(
  input: EvaluationInput,
  deps: EvaluateNotificationDeps,
): Promise<EvaluationResult> {
  const [defaultsList, overrides, quietHours, policies] = await Promise.all([
    deps.defaults.getAll(),
    deps.prefs.getOverrides(input.userId),
    deps.prefs.getQuietHours(input.userId),
    deps.policies.findApplicable(input.notificationType, input.region),
  ]);

  const result = evaluate(input, {
    defaults: defaultsList,
    overrides,
    quietHours,
    policies,
  });

  // METRIC: counter notifications_evaluated_total{decision,reason}
  deps.logger.info(
    {
      userId: input.userId,
      notificationType: input.notificationType,
      channel: input.channel,
      region: input.region,
      datetime: input.datetime.toISOString(),
      decision: result.decision,
      reason: result.reason,
    },
    'notification.evaluated',
  );

  return result;
}
