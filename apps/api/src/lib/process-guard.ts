/**
 * Process-level containment (issue #89).
 *
 * Posture: contain-and-continue. A single failed database query — or any
 * other rejected promise that escapes request scope — must never terminate
 * the API process. The per-request path already answers 500 via the
 * error-handler plugin; these guards are the last-resort net for whatever
 * escapes it (e.g. a postgres.js socket `ETIMEDOUT` that rejects both the
 * in-flight query AND a sibling queued promise with no attached handler).
 *
 * postgres.js (v3) surfaces every failure as a rejected query promise; it
 * has no EventEmitter error channel, only the `onclose` lifecycle hook (see
 * `packages/db/src/client.ts`). So there is nothing to "listen" to at the
 * pool level for query failures — containment here plus `await` everywhere
 * in request scope is the whole strategy.
 *
 * Pure wiring: `process` never appears in the handlers themselves, only in
 * `installProcessGuards`, so the contract is unit testable. Mirrors the
 * `lib/shutdown.ts` factory style.
 */
import * as Sentry from "@sentry/bun";

export type ProcessGuardSink = {
  /** Logging sink (defaults to console.error). */
  log: (message: string, ...args: unknown[]) => void;
  /** Error reporting sink (defaults to Sentry.captureException). */
  captureException: (error: unknown) => void;
};

/**
 * Minimal emitter surface needed for wiring (real `process` satisfies it).
 * Overloaded per event so both the runtime and test fakes typecheck under
 * `strictFunctionTypes` without resorting to `any`.
 */
export type ProcessGuardTarget = {
  on(
    event: "unhandledRejection",
    listener: (reason: unknown, promise: unknown) => void,
  ): unknown;
  on(event: "uncaughtException", listener: (error: unknown) => void): unknown;
};

/**
 * Connection-level failure codes that must degrade to a per-request 500,
 * never a process exit. Covers postgres.js connection codes, POSIX socket
 * errnos surfaced through the driver, and the Postgres `connection_exception`
 * class (`08xxx`) plus admin/crash shutdown (`57P01`/`57P02`).
 */
const TRANSIENT_CONNECTION_CODES = new Set<string>([
  // postgres.js connection lifecycle
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
  // socket errnos via the driver
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EPIPE",
  "EHOSTUNREACH",
  "EHOSTDOWN",
  "ENETUNREACH",
  "ENETDOWN",
  "ENETRESET",
  // Postgres connection_exception (08xxx) + shutdown (57P01/57P02/57P03)
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "57P01",
  "57P02",
  "57P03",
]);

function errorCodeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code.length > 0) return code;
  if (typeof code === "number") return String(code);
  return null;
}

/** True when the failure is a transient connection/infra error, not a bug. */
export function isTransientConnectionError(error: unknown): boolean {
  const code = errorCodeOf(error);
  if (code && TRANSIENT_CONNECTION_CODES.has(code)) return true;
  if (error instanceof Error) {
    // Socket timeouts sometimes arrive bare (message only, no code).
    if (/timed out|ETIMEDOUT|ECONNREFUSED|ECONNRESET/i.test(error.message)) {
      return true;
    }
    // postgres.js wraps some socket failures in PostgresError with the
    // errno embedded in the message.
    const cause = (error as { cause?: unknown }).cause;
    if (cause && isTransientConnectionError(cause)) return true;
  }
  return false;
}

/**
 * Last-resort handler for rejected promises with no `.catch`.
 * Logs with context and reports to Sentry. Never throws, never exits —
 * returning normally tells the runtime the rejection is handled.
 */
export function handleUnhandledRejection(
  reason: unknown,
  sink: ProcessGuardSink,
): void {
  const transient = isTransientConnectionError(reason);
  sink.log(
    `[api] unhandled rejection — contained (${transient ? "transient connection error" : "unexpected"})`,
    reason instanceof Error ? reason.message : reason,
  );
  sink.captureException(reason);
}

/**
 * Last-resort handler for synchronous throws outside request scope
 * (including EventEmitter 'error' throws, e.g. a Redis client dropping
 * mid-run). Same posture: log, report, keep serving. The process only ever
 * exits via an explicit signal (SIGTERM/SIGINT shutdown) or a crash the
 * runtime itself cannot survive.
 */
export function handleUncaughtException(
  error: unknown,
  sink: ProcessGuardSink,
): void {
  const transient = isTransientConnectionError(error);
  sink.log(
    `[api] uncaught exception — contained (${transient ? "transient connection error" : "unexpected"})`,
    error instanceof Error ? error.message : error,
  );
  sink.captureException(error);
}

const defaultSink: ProcessGuardSink = {
  log: (message, ...args) => console.error(message, ...args),
  captureException: (error) => Sentry.captureException(error),
};

let installed = false;

/**
 * Wire the containment handlers onto the runtime. Idempotent — safe to call
 * once at boot (`index.ts`) and harmless if invoked again. A custom target
 * exists only so tests can inject a fake emitter without touching the real
 * process (which would swallow genuine test-runner failures).
 */
export function installProcessGuards(
  sink: ProcessGuardSink = defaultSink,
  target: ProcessGuardTarget = process,
): void {
  if (installed) return;
  installed = true;
  target.on("unhandledRejection", (reason: unknown) =>
    handleUnhandledRejection(reason, sink),
  );
  target.on("uncaughtException", (error: unknown) =>
    handleUncaughtException(error, sink),
  );
}

/** Test helper — resets the installed flag between hermetic test cases. */
export function resetProcessGuardsForTests(): void {
  installed = false;
}
