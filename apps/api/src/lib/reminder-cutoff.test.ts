// F-03: REMINDER_CUTOFF_ISO parsing — unset/blank/garbage means no cutoff
// (pre-existing behavior); a valid ISO instant is returned as a Date.
import { afterEach, describe, expect, test } from "bun:test";

import {
  assertReminderCutoffConfigured,
  getReminderCutoff,
  REMINDER_CUTOFF_ENV,
} from "./reminder-cutoff";

const saved = process.env[REMINDER_CUTOFF_ENV];
const savedNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (saved === undefined) {
    delete process.env[REMINDER_CUTOFF_ENV];
  } else {
    process.env[REMINDER_CUTOFF_ENV] = saved;
  }
  process.env.NODE_ENV = savedNodeEnv;
});

describe("getReminderCutoff", () => {
  test("unset means no cutoff", () => {
    delete process.env[REMINDER_CUTOFF_ENV];
    expect(getReminderCutoff()).toBeNull();
  });

  test("blank means no cutoff", () => {
    process.env[REMINDER_CUTOFF_ENV] = "   ";
    expect(getReminderCutoff()).toBeNull();
  });

  test("garbage means no cutoff (warned, never thrown)", () => {
    process.env[REMINDER_CUTOFF_ENV] = "not-a-date";
    expect(getReminderCutoff()).toBeNull();
  });

  test("valid ISO instant is parsed exactly", () => {
    process.env[REMINDER_CUTOFF_ENV] = "2026-09-19T00:00:00Z";
    expect(getReminderCutoff()).toEqual(new Date("2026-09-19T00:00:00.000Z"));
  });
});

describe("assertReminderCutoffConfigured (RF-11 fail-closed)", () => {
  test("non-production tolerates a missing/invalid cutoff", () => {
    process.env.NODE_ENV = "development";
    delete process.env[REMINDER_CUTOFF_ENV];
    expect(() => assertReminderCutoffConfigured()).not.toThrow();
    process.env[REMINDER_CUTOFF_ENV] = "not-a-date";
    expect(() => assertReminderCutoffConfigured()).not.toThrow();
  });

  test("production with a valid cutoff passes", () => {
    process.env.NODE_ENV = "production";
    process.env[REMINDER_CUTOFF_ENV] = "2026-09-19T00:00:00Z";
    expect(() => assertReminderCutoffConfigured()).not.toThrow();
  });

  test("production without a cutoff throws", () => {
    process.env.NODE_ENV = "production";
    delete process.env[REMINDER_CUTOFF_ENV];
    let error: unknown;
    try {
      assertReminderCutoffConfigured();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/REMINDER_CUTOFF_ISO/);
  });

  test("production with an invalid cutoff throws (no fallback to lenient)", () => {
    process.env.NODE_ENV = "production";
    process.env[REMINDER_CUTOFF_ENV] = "not-a-date";
    let error: unknown;
    try {
      assertReminderCutoffConfigured();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/valid ISO date/);
  });
});
