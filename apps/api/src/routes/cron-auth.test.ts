/**
 * Finding #11 tests: cron secret uses constant-time comparison.
 * - A: valid secret authenticates (successful execution contract intact).
 * - B: wrong secret → existing generic 401, no secret material in body.
 * - C: missing/empty request secret → 401; missing configured secret keeps
 *   the existing test-env bypass contract (prod path fails closed).
 * - D: different-length secrets reject cleanly (no throw → no 500).
 * - E: the route actually invokes the shared constant-time primitive with
 *   the exact expected arguments (recorded via a delegating stub).
 * - F: existing cron execution tests (run-evaluate.test.ts) cover success.
 */
process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const savedCronSecret = process.env.CRON_SECRET;

const timingCalls: Array<[string, string]> = [];

function timingSafeEqualMirror(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

mock.module("../lib/auth-bridge", () => ({
  AUTH_BRIDGE_HEADER: "x-dr-auth-bridge",
  // Faithful copy of the real primitive (same file would otherwise leak a
  // partial stub into other test files): records calls, same semantics.
  timingSafeEqualString: (a: string, b: string) => {
    timingCalls.push([a, b]);
    return timingSafeEqualMirror(a, b);
  },
  isAuthBridgeRequest: (request: Request) => {
    const secret = process.env.AUTH_BRIDGE_SECRET;
    if (!secret) return false;
    const header = request.headers.get("x-dr-auth-bridge");
    if (!header) return false;
    return timingSafeEqualMirror(header, secret);
  },
  withBridgeTokens: (
    body: Record<string, unknown>,
    tokens: {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    } | null,
    bridge: boolean,
  ) => {
    if (!bridge || !tokens) return body;
    return {
      ...body,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    };
  },
}));

mock.module("../lib/db", () => {
  const self = {
    from: () => self,
    innerJoin: () => self,
    set: () => self,
    values: () => self,
    where: () => self,
    orderBy: () => self,
    limit: async () => [],
    returning: async () => [],
    then: (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve([]).then(resolve, reject),
  };
  return {
    getDb: () => ({
      select: () => self,
      insert: () => self,
      update: () => self,
      delete: () => self,
    }),
  };
});

const { resetRateLimitBuckets } = await import("../plugins/rate-limit");
const { app } = await import("../app");

function cronRequest(authHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) headers["authorization"] = authHeader;
  return new Request("http://localhost/api/v1/cron/evaluate-reminders", {
    headers,
  });
}

beforeEach(() => {
  resetRateLimitBuckets();
  timingCalls.length = 0;
  process.env.CRON_SECRET = "test-cron-secret";
});

afterEach(() => {
  resetRateLimitBuckets();
  if (savedCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedCronSecret;
});

describe("finding #11 — cron secret comparison", () => {
  test("A. correct secret executes successfully", async () => {
    const response = await app.handle(cronRequest("Bearer test-cron-secret"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  });

  test("A2. success body carries no internal volume metrics (SEC-008)", async () => {
    const response = await app.handle(cronRequest("Bearer test-cron-secret"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true });
  });

  test("B. wrong secret is rejected with the generic 401", async () => {
    const response = await app.handle(cronRequest("Bearer wrong-secret"));
    expect(response.status).toBe(401);
    const body = (await response.json()) as {
      error?: { code?: string; message?: string } | string;
    };
    const err = body.error;
    expect(typeof err === "string" ? err : err?.code).toBe("UNAUTHORIZED");
    expect(JSON.stringify(body)).not.toContain("test-cron-secret");
    expect(JSON.stringify(body)).not.toContain("wrong-secret");
  });

  test("C. missing and empty request secrets are rejected", async () => {
    expect((await app.handle(cronRequest())).status).toBe(401);
    expect((await app.handle(cronRequest(""))).status).toBe(401);
    expect((await app.handle(cronRequest("Bearer "))).status).toBe(401);
  });

  test("C2. missing configured secret keeps the test-env bypass contract", async () => {
    delete process.env.CRON_SECRET;
    const response = await app.handle(cronRequest());
    expect(response.status).toBe(200);
  });

  test("D. different-length secrets reject cleanly without throwing", async () => {
    const short = await app.handle(cronRequest("Bearer x"));
    expect(short.status).toBe(401);
    const long = await app.handle(
      cronRequest(`Bearer ${"y".repeat(200)}`),
    );
    expect(long.status).toBe(401);
    const noScheme = await app.handle(cronRequest("test-cron-secret"));
    expect(noScheme.status).toBe(401);
  });

  test("E. the route uses the constant-time primitive with exact args", async () => {
    const response = await app.handle(cronRequest("Bearer wrong-secret"));
    expect(response.status).toBe(401);
    expect(timingCalls.length).toBe(1);
    expect(timingCalls[0]).toEqual([
      "Bearer wrong-secret",
      "Bearer test-cron-secret",
    ]);
  });
});
