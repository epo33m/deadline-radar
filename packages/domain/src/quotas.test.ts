import { describe, expect, test } from "bun:test";

import {
  MAX_ACTIVE_TASKS_PER_USER,
  MAX_EMAILS_PER_USER_PER_RUN,
  MAX_THRESHOLDS_PER_TASK,
} from "./quotas";

describe("quota policy (SEC-003)", () => {
  test("values match the decided product policy", () => {
    expect(MAX_ACTIVE_TASKS_PER_USER).toBe(200);
    expect(MAX_THRESHOLDS_PER_TASK).toBe(10);
    expect(MAX_EMAILS_PER_USER_PER_RUN).toBe(50);
  });
});
