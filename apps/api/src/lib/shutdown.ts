/**
 * Graceful shutdown: SIGTERM/SIGINT drains instead of abandoning.
 *
 * Without this, even a polite SIGTERM kills in-flight queries and strands
 * pooled Postgres connections for the server to reap — exactly the
 * connection-leak shape that stresses staging. `kill -9` stays
 * unfixable by design (SIGKILL is uncatchable); this makes every catchable
 * shutdown clean.
 *
 * Pure factory: `process` never appears here, so the whole contract is unit
 * testable. Wired in `index.ts`.
 */
export type ShutdownDeps = {
  /** Stop accepting connections (Elysia `app.stop()` resolves the app). */
  stopServer: () => unknown;
  /** Drain the database pool (`getDb().close()`). Best-effort. */
  closePool: () => Promise<void>;
  /** `process.exit` (injected so tests never exit the runner). */
  exit: (code: number) => void;
  /** Logging sink. */
  log: (message: string) => void;
};

export function createShutdownHandler(
  deps: ShutdownDeps,
): (signal: string) => Promise<void> {
  let shuttingDown = false;

  return async function onSignal(signal: string): Promise<void> {
    if (shuttingDown) {
      deps.log(`[shutdown] ${signal} during shutdown — forcing exit`);
      deps.exit(1);
      return;
    }
    shuttingDown = true;
    deps.log(`[shutdown] ${signal} received — draining`);

    try {
      await deps.stopServer();
      deps.log("[shutdown] server stopped accepting connections");
    } catch (error) {
      deps.log(`[shutdown] server stop failed: ${String(error)}`);
    }

    try {
      await deps.closePool();
      deps.log("[shutdown] database pool drained");
    } catch (error) {
      deps.log(`[shutdown] pool drain failed: ${String(error)}`);
    }

    deps.exit(0);
  };
}
