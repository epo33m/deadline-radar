/**
 * Systemic reminder-failure alert decision (Finding F-06).
 *
 * The cron endpoint always answers `200 {ok:true}` (SEC-008 minimal
 * contract), so a separate channel must carry the failure signal: when
 * every attempted send in a run fails, the caller raises a Sentry alert
 * with the run counts as structured context. Anything milder stays quiet:
 * - a lone transient failure amid successes is routine (retry path handles it);
 * - quota-skipped mails stay `pending` for the next run — they were never
 *   attempted, so they must not count toward a blackout;
 * - a run with zero activity (steady state) is normal, not an incident.
 */
export type ReminderOutcome = {
  emailsSent: number;
  emailsFailed: number;
  /**
   * RF-08: subset of `emailsFailed` that is deterministic poison (missing
   * task / recipient email). Excluded from the blackout decision: it is a
   * data-integrity condition, not a provider outage, so a lone orphaned
   * delivery must not page anyone.
   */
  emailsPoisoned?: number;
};

export function isSystemicReminderFailure(outcome: ReminderOutcome): boolean {
  const realFailures = outcome.emailsFailed - (outcome.emailsPoisoned ?? 0);
  const attempted = outcome.emailsSent + realFailures;
  return attempted > 0 && outcome.emailsSent === 0 && realFailures > 0;
}
