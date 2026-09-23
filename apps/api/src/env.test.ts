// I-6: production boot guard (CRON_SECRET, AUTH_BRIDGE_SECRET, REDIS_URL).
//  - production + secrets present    → valid
//  - production + empty secret       → configuration failure
//  - test/dev environment + no secrets → still valid (dev/CI unconstrained)
// The error messages must never contain secret values.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { assertStartupConfig, env } from "./env";

const savedNodeEnv = process.env.NODE_ENV;
const savedCronSecret = process.env.CRON_SECRET;
const savedAuthBridgeSecret = process.env.AUTH_BRIDGE_SECRET;
const savedRedisUrl = process.env.REDIS_URL;
const savedReminderCutoff = process.env.REMINDER_CUTOFF_ISO;
const savedMaxTasks = process.env.MAX_TASKS_PER_RUN;
const savedMaxRunDuration = process.env.MAX_RUN_DURATION_MS;
const savedResendApiKey = process.env.RESEND_API_KEY;
const savedResendFromEmail = process.env.RESEND_FROM_EMAIL;

beforeEach(() => {
  process.env.CRON_SECRET = "a-real-long-cron-secret";
  process.env.AUTH_BRIDGE_SECRET = "a-real-long-bridge-secret";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.REMINDER_CUTOFF_ISO = "2026-09-19T00:00:00.000Z";
  process.env.RESEND_API_KEY = "re_test-aaaaaaaaaaaaaaaa";
  process.env.RESEND_FROM_EMAIL = "Deadline Radar <reminders@example.com>";
});

afterEach(() => {
  process.env.NODE_ENV = savedNodeEnv;
  if (savedCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedCronSecret;
  if (savedAuthBridgeSecret === undefined)
    delete process.env.AUTH_BRIDGE_SECRET;
  else process.env.AUTH_BRIDGE_SECRET = savedAuthBridgeSecret;
  if (savedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = savedRedisUrl;
  if (savedReminderCutoff === undefined)
    delete process.env.REMINDER_CUTOFF_ISO;
  else process.env.REMINDER_CUTOFF_ISO = savedReminderCutoff;
  if (savedMaxTasks === undefined) delete process.env.MAX_TASKS_PER_RUN;
  else process.env.MAX_TASKS_PER_RUN = savedMaxTasks;
  if (savedMaxRunDuration === undefined)
    delete process.env.MAX_RUN_DURATION_MS;
  else process.env.MAX_RUN_DURATION_MS = savedMaxRunDuration;
  if (savedResendApiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = savedResendApiKey;
  if (savedResendFromEmail === undefined)
    delete process.env.RESEND_FROM_EMAIL;
  else process.env.RESEND_FROM_EMAIL = savedResendFromEmail;
});

describe("I-6 — assertStartupConfig", () => {
  test("production with all secrets set → valid", () => {
    process.env.NODE_ENV = "production";
    expect(() => assertStartupConfig()).not.toThrow();
  });

  test("production with empty CRON_SECRET → configuration failure", () => {
    process.env.NODE_ENV = "production";
    delete process.env.CRON_SECRET;
    let error: unknown;
    try {
      assertStartupConfig();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/CRON_SECRET/);
    // No secret material may leak into the failure message.
    expect((error as Error).message).not.toContain("a-real-long");
  });

  test("production with empty AUTH_BRIDGE_SECRET → configuration failure", () => {
    process.env.NODE_ENV = "production";
    delete process.env.AUTH_BRIDGE_SECRET;
    let error: unknown;
    try {
      assertStartupConfig();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/AUTH_BRIDGE_SECRET/);
    expect((error as Error).message).not.toContain("a-real-long");
  });

  test("production with empty REDIS_URL → configuration failure (SEC-007)", () => {
    process.env.NODE_ENV = "production";
    delete process.env.REDIS_URL;
    let error: unknown;
    try {
      assertStartupConfig();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/REDIS_URL/);
    expect((error as Error).message).not.toContain("a-real-long");
  });

  test("test environment with empty secrets → still valid", () => {
    process.env.NODE_ENV = "test";
    delete process.env.CRON_SECRET;
    delete process.env.AUTH_BRIDGE_SECRET;
    delete process.env.REDIS_URL;
    delete process.env.REMINDER_CUTOFF_ISO;
    expect(() => assertStartupConfig()).not.toThrow();
  });

  test("development (non-production) with empty secrets → still valid", () => {
    process.env.NODE_ENV = "development";
    delete process.env.CRON_SECRET;
    delete process.env.AUTH_BRIDGE_SECRET;
    delete process.env.REDIS_URL;
    delete process.env.REMINDER_CUTOFF_ISO;
    expect(() => assertStartupConfig()).not.toThrow();
  });

  test("production without REMINDER_CUTOFF_ISO → configuration failure (RF-11)", () => {
    process.env.NODE_ENV = "production";
    delete process.env.REMINDER_CUTOFF_ISO;
    let error: unknown;
    try {
      assertStartupConfig();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/REMINDER_CUTOFF_ISO/);
  });

  test("production with an invalid REMINDER_CUTOFF_ISO → configuration failure (RF-11)", () => {
    process.env.NODE_ENV = "production";
    process.env.REMINDER_CUTOFF_ISO = "not-a-date";
    let error: unknown;
    try {
      assertStartupConfig();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/REMINDER_CUTOFF_ISO/);
    expect((error as Error).message).toContain("valid ISO date");
  });
});

describe("RF-13 — assertResendConfigured via assertStartupConfig", () => {
  test("production with valid resend vars → valid", () => {
    process.env.NODE_ENV = "production";
    expect(() => assertStartupConfig()).not.toThrow();
  });

  test("production without RESEND_API_KEY → configuration failure (fail-closed)", () => {
    process.env.NODE_ENV = "production";
    delete process.env.RESEND_API_KEY;
    let error: unknown;
    try {
      assertStartupConfig();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/RESEND_API_KEY/);
  });

  test("production with a malformed RESEND_API_KEY (not re_*) → failure", () => {
    process.env.NODE_ENV = "production";
    process.env.RESEND_API_KEY = "sk_live_x";
    let error: unknown;
    try {
      assertStartupConfig();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/RESEND_API_KEY/);
    expect((error as Error).message).toMatch(/starts with "re_"/);
  });

  test("production without RESEND_FROM_EMAIL → configuration failure (no silent sandbox sender)", () => {
    process.env.NODE_ENV = "production";
    delete process.env.RESEND_FROM_EMAIL;
    let error: unknown;
    try {
      assertStartupConfig();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/RESEND_FROM_EMAIL/);
  });

  test("production with an invalid RESEND_FROM_EMAIL → configuration failure", () => {
    process.env.NODE_ENV = "production";
    process.env.RESEND_FROM_EMAIL = "not-an-email";
    let error: unknown;
    try {
      assertStartupConfig();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/RESEND_FROM_EMAIL/);
    expect((error as Error).message).toMatch(/valid address/);
  });
});

describe("RF-12 — lenient scheduler-bound env getters", () => {
  test("unset knobs return undefined (caller defaults apply), never throw", () => {
    delete process.env.MAX_TASKS_PER_RUN;
    delete process.env.MAX_RUN_DURATION_MS;
    expect(env.maxTasksPerRun()).toBeUndefined();
    expect(env.maxRunDurationMs()).toBeUndefined();
  });

  test("valid positive integers are parsed", () => {
    process.env.MAX_TASKS_PER_RUN = "500";
    process.env.MAX_RUN_DURATION_MS = "45000";
    expect(env.maxTasksPerRun()).toBe(500);
    expect(env.maxRunDurationMs()).toBe(45_000);
  });

  test("invalid values fall back to undefined (warn + default), not a boot failure", () => {
    process.env.MAX_TASKS_PER_RUN = "many";
    process.env.MAX_RUN_DURATION_MS = "-5";
    expect(env.maxTasksPerRun()).toBeUndefined();
    expect(env.maxRunDurationMs()).toBeUndefined();
  });
});