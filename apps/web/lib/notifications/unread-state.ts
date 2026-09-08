/**
 * Pure helpers for unread notification state transitions.
 *
 * These run only on the client after a confirmed server-side mutation,
 * so they never trigger database queries by themselves.
 */

/** Mark exactly one notification as read — floor at 0. */
export function applyOneRead(current: number): number {
  return Math.max(0, current - 1);
}

/** Mark all notifications as read. */
export function applyAllRead(): number {
  return 0;
}

/**
 * True when the tab just became visible and the last fetch is older
 * than `intervalMs`, meaning we should catch up on missed polls.
 */
export function shouldCatchUpOnVisible(
  lastFetchAt: number,
  now: number,
  intervalMs: number,
): boolean {
  return now - lastFetchAt > intervalMs;
}
