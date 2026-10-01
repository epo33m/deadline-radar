/**
 * Issue #89 regression: a single timed-out / failed DB query must 500 that
 * request and never terminate the process.
 *
 * - A poisoned query (forced ETIMEDOUT, the exact staging symptom) yields a
 *   500 INTERNAL envelope, and the very next request still gets served.
 * - The process-level guards contain `unhandledRejection` / `uncaughtException`
 *   with a log + report instead of an exit.
 */
import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";

import { errorHandlerPlugin } from "../plugins/error-handler";
import {
  handleUncaughtException,
  handleUnhandledRejection,
  installProcessGuards,
  isTransientConnectionError,
  resetProcessGuardsForTests,
  type ProcessGuardSink,
  type ProcessGuardTarget,
} from "./process-guard";

function recordingSink() {
  const logs: Array<{ message: string; args: unknown[] }> = [];
  const captured: unknown[] = [];
  const sink: ProcessGuardSink = {
    log: (message, ...args) => {
      logs.push({ message, args });
    },
    captureException: (error) => {
      captured.push(error);
    },
  };
  return { sink, logs, captured };
}

function fakeTarget() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const target: ProcessGuardTarget = {
    on: (
      event: "unhandledRejection" | "uncaughtException",
      listener: (...args: unknown[]) => void,
    ) => {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    },
  };
  return { target, listeners };
}

function timedOutQueryError(): Error & { code: string } {
  // Mirrors the staging symptom: `update "profiles" set "timezone" = $1`
  // failing with a socket read timeout through postgres.js/drizzle.
  const err = new Error(
    'Failed query: update "profiles" set "timezone" = $1 … ETIMEDOUT: connection timed out, read',
  ) as Error & { code: string };
  err.code = "ETIMEDOUT";
  return err;
}

describe("isTransientConnectionError", () => {
  test("classifies socket and postgres.js connection failures as transient", () => {
    for (const code of [
      "ETIMEDOUT",
      "ECONNREFUSED",
      "ECONNRESET",
      "CONNECT_TIMEOUT",
      "CONNECTION_CLOSED",
      "CONNECTION_DESTROYED",
      "57P01",
      "08006",
    ]) {
      const err = new Error("boom") as Error & { code: string };
      err.code = code;
      expect(isTransientConnectionError(err)).toBe(true);
    }
  });

  test("classifies a bare timeout message without a code as transient", () => {
    expect(isTransientConnectionError(new Error("connection timed out, read"))).toBe(
      true,
    );
  });

  test("does not classify constraint violations, ApiError, or junk as transient", () => {
    const fk = new Error("foreign key") as Error & { code: string };
    fk.code = "23503";
    expect(isTransientConnectionError(fk)).toBe(false);
    expect(isTransientConnectionError(new Error("plain bug"))).toBe(false);
    expect(isTransientConnectionError(null)).toBe(false);
    expect(isTransientConnectionError("ETIMEDOUT")).toBe(false);
  });
});

describe("process-level handlers", () => {
  test("unhandled rejection is logged, reported, and never thrown", () => {
    const { sink, logs, captured } = recordingSink();
    const reason = timedOutQueryError();
    expect(() => handleUnhandledRejection(reason, sink)).not.toThrow();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toContain("unhandled rejection");
    expect(logs[0]?.message).toContain("contained");
    expect(captured).toEqual([reason]);
  });

  test("uncaught exception is logged, reported, and never thrown", () => {
    const { sink, logs, captured } = recordingSink();
    const error = new Error("cycle detected");
    expect(() => handleUncaughtException(error, sink)).not.toThrow();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toContain("uncaught exception");
    expect(captured).toEqual([error]);
  });

  test("install wires both events exactly once (idempotent)", () => {
    resetProcessGuardsForTests();
    const { sink } = recordingSink();
    const { target, listeners } = fakeTarget();
    installProcessGuards(sink, target);
    installProcessGuards(sink, target);
    expect(listeners.get("unhandledRejection")).toHaveLength(1);
    expect(listeners.get("uncaughtException")).toHaveLength(1);
    resetProcessGuardsForTests();
  });

  test("wired listeners contain instead of exiting", () => {
    resetProcessGuardsForTests();
    const { sink, logs, captured } = recordingSink();
    const { target, listeners } = fakeTarget();
    installProcessGuards(sink, target);
    const reason = timedOutQueryError();
    for (const listener of listeners.get("unhandledRejection") ?? []) {
      expect(() => listener(reason)).not.toThrow();
    }
    expect(logs).toHaveLength(1);
    expect(captured).toEqual([reason]);
    resetProcessGuardsForTests();
  });
});

describe("issue #89 — poisoned query regression", () => {
  test("forced ETIMEDOUT yields 500 INTERNAL and the server keeps serving", async () => {
    const app = new Elysia()
      .use(errorHandlerPlugin)
      .get("/test-poison", () => {
        throw timedOutQueryError();
      })
      .get("/test-healthy", () => ({ ok: true }));

    const poisoned = await app.handle(
      new Request("http://localhost/test-poison"),
    );
    expect(poisoned.status).toBe(500);
    const body = (await poisoned.json()) as {
      error: { code: string };
      requestId: string;
    };
    expect(body.error.code).toBe("INTERNAL");
    expect(typeof body.requestId).toBe("string");
    expect(poisoned.headers.get("X-Request-Id")).toBe(body.requestId);

    // The process (here: the app) is still alive for the next request.
    const healthy = await app.handle(
      new Request("http://localhost/test-healthy"),
    );
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toEqual({ ok: true });
  });
});
