// RF-15: deploy-order guard. Pure predicate drives every message; the thin
// DB wrapper is driven with a fake (no live database needed).
import { afterEach, describe, expect, test } from "bun:test";

import {
  assertReminderSchemaPrerequisites,
  deriveMissingReminderPrereq,
} from "./schema-prereqs";

const savedNodeEnv = process.env.NODE_ENV;

function fakeDb(rows: Array<Record<string, unknown>>) {
  return {
    execute: async () => rows,
  };
}

afterEach(() => {
  process.env.NODE_ENV = savedNodeEnv;
});

describe("RF-15 — deriveMissingReminderPrereq", () => {
  test("no problem when both prerequisites exist", () => {
    expect(
      deriveMissingReminderPrereq({
        hasSendingEnum: true,
        hasClaimedAtColumn: true,
      }),
    ).toBeNull();
  });

  test("names the missing enum value and the migration", () => {
    const problem = deriveMissingReminderPrereq({
      hasSendingEnum: false,
      hasClaimedAtColumn: true,
    })!;
    expect(problem).toMatch(/notification_status/);
    expect(problem).toMatch(/"sending"/);
    expect(problem).toMatch(/20260920040000_sweep_claim_state/);
    expect(problem).toMatch(/db:migrate/);
  });

  test("names the missing column when only it is absent", () => {
    const problem = deriveMissingReminderPrereq({
      hasSendingEnum: true,
      hasClaimedAtColumn: false,
    })!;
    expect(problem).toMatch(/claimed_at/);
    expect(problem).not.toMatch(/"sending"/);
  });

  test("lists both when both are missing", () => {
    const problem = deriveMissingReminderPrereq({
      hasSendingEnum: false,
      hasClaimedAtColumn: false,
    });
    expect(problem).toMatch(/sending/);
    expect(problem).toMatch(/claimed_at/);
  });
});

describe("RF-15 — assertReminderSchemaPrerequisites", () => {
  test("non-production never queries or throws", async () => {
    process.env.NODE_ENV = "test";
    let called = false;
    await assertReminderSchemaPrerequisites({
      execute: async () => {
        called = true;
        return [];
      },
    });
    expect(called).toBe(false);
  });

  test("production with both prerequisites present → resolves", async () => {
    process.env.NODE_ENV = "production";
    await expect(
      assertReminderSchemaPrerequisites(
        fakeDb([{ has_sending: true, has_claimed_at: true }]),
      ),
    ).resolves.toBeUndefined();
  });

  test("production missing the enum → throws with the operator hint", async () => {
    process.env.NODE_ENV = "production";
    await expect(
      assertReminderSchemaPrerequisites(
        fakeDb([{ has_sending: false, has_claimed_at: true }]),
      ),
    ).rejects.toThrow(/db:migrate/);
    await expect(
      assertReminderSchemaPrerequisites(
        fakeDb([{ has_sending: false, has_claimed_at: true }]),
      ),
    ).rejects.toThrow(/notification_status/);
  });

  test("production missing the column → throws naming claimed_at", async () => {
    process.env.NODE_ENV = "production";
    await expect(
      assertReminderSchemaPrerequisites(
        fakeDb([{ has_sending: true, has_claimed_at: false }]),
      ),
    ).rejects.toThrow(/claimed_at/);
  });

  test("production with no rows (pre-prereq DB) → throws", async () => {
    process.env.NODE_ENV = "production";
    await expect(
      assertReminderSchemaPrerequisites(fakeDb([])),
    ).rejects.toThrow(/RF-15/);
  });
});