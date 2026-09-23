process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const savedCronSecret = process.env.CRON_SECRET;
const savedNodeEnv = process.env.NODE_ENV;

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

function cronRequest(urlPath: string, authHeader = "Bearer test-cron-secret"): Request {
  return new Request(`http://localhost${urlPath}`, {
    headers: {
      authorization: authHeader,
    },
  });
}

beforeEach(() => {
  resetRateLimitBuckets();
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.NODE_ENV = "test";
});

afterEach(() => {
  resetRateLimitBuckets();
  if (savedCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedCronSecret;
  process.env.NODE_ENV = savedNodeEnv;
});

describe("BUG-02 — deterministic clock override for HTTP cron endpoint", () => {
  test("1. default request without simulated_now executes with 200 { ok: true }", async () => {
    const response = await app.handle(
      cronRequest("/api/v1/cron/evaluate-reminders"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("2. valid simulated_now in non-prod executes with 200 { ok: true }", async () => {
    const timestamp = "2026-11-20T14:30:00.000Z";
    const response = await app.handle(
      cronRequest(`/api/v1/cron/evaluate-reminders?simulated_now=${encodeURIComponent(timestamp)}`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("2b. valid simulatedNow (camelCase) alias also executes with 200 { ok: true }", async () => {
    const timestamp = "2026-12-01T08:00:00.000Z";
    const response = await app.handle(
      cronRequest(`/api/v1/cron/evaluate-reminders?simulatedNow=${encodeURIComponent(timestamp)}`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("2c. timezone offset in ISO-8601 string is accepted and executes with 200 { ok: true }", async () => {
    const timestampWithOffset = "2026-11-20T17:30:00+03:00";
    const response = await app.handle(
      cronRequest(`/api/v1/cron/evaluate-reminders?simulated_now=${encodeURIComponent(timestampWithOffset)}`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("3. invalid simulated_now returns 400 VALIDATION_ERROR", async () => {
    const response = await app.handle(
      cronRequest("/api/v1/cron/evaluate-reminders?simulated_now=not-a-date"),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string; message: string; details: Array<{ field?: string; message: string }> };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.some((d) => d.field === "simulated_now")).toBe(true);
  });

  test("3b. invalid date components (e.g. invalid month) return 400", async () => {
    const response = await app.handle(
      cronRequest("/api/v1/cron/evaluate-reminders?simulated_now=2026-99-99T00:00:00Z"),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("4. production environment strictly ignores simulated_now (always executes with real server time)", async () => {
    process.env.NODE_ENV = "production";
    const timestamp = "2099-01-01T00:00:00.000Z";
    const response = await app.handle(
      cronRequest(`/api/v1/cron/evaluate-reminders?simulated_now=${encodeURIComponent(timestamp)}`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("5. cron authorization is still strictly required when simulated_now is provided", async () => {
    const unauthResponse = await app.handle(
      new Request("http://localhost/api/v1/cron/evaluate-reminders?simulated_now=2026-11-20T14:30:00.000Z"),
    );
    expect(unauthResponse.status).toBe(401);

    const wrongAuthResponse = await app.handle(
      cronRequest("/api/v1/cron/evaluate-reminders?simulated_now=2026-11-20T14:30:00.000Z", "Bearer wrong-secret"),
    );
    expect(wrongAuthResponse.status).toBe(401);
  });
});
