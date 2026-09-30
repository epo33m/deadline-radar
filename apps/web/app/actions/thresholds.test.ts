import { beforeEach, describe, expect, mock, test } from "bun:test";

type ApiJsonCall = {
  path: string;
  init?: RequestInit;
};

const apiJsonCalls: ApiJsonCall[] = [];
let getTaskDetailResponse: Record<string, unknown> = {};
let putThresholdsResponse: Record<string, unknown> = {};
let revalidatedPaths: string[] = [];

mock.module("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidatedPaths.push(path);
  },
}));

mock.module("next/navigation", () => ({
  redirect: (url: string) => url,
}));

mock.module("@/lib/api/server", () => ({
  // See idempotency.test.ts: keep the full export shape so mocked imports
  // elsewhere (`lib/calendar/load`, `lib/summary/load`) keep resolving.
  apiFetch: async () => {
    throw new Error("apiFetch is stubbed in thresholds.test.ts");
  },
  apiJson: async (path: string, init: RequestInit = {}) => {
    apiJsonCalls.push({ path, init });
    if (init.method === "PUT") {
      return putThresholdsResponse;
    }
    return getTaskDetailResponse;
  },
}));

const { setDefaultThresholds } = await import("./tasks");

describe("M-10 Server Action: setDefaultThresholds atomic bulk replace", () => {
  beforeEach(() => {
    apiJsonCalls.length = 0;
    revalidatedPaths = [];
    getTaskDetailResponse = {
      task: { id: "task-123" },
      thresholds: [
        { id: "th-7", daysBefore: 7 },
        { id: "th-3", daysBefore: 3 },
        { id: "th-10", daysBefore: 10 }, // custom threshold
      ],
    };
    putThresholdsResponse = {
      thresholds: [
        { id: "th-0", daysBefore: 0 },
        { id: "th-1", daysBefore: 1 },
        { id: "th-3", daysBefore: 3 },
        { id: "th-7", daysBefore: 7 },
        { id: "th-10", daysBefore: 10 },
      ],
    };
  });

  test("enabling defaults sends exactly ONE atomic PUT request preserving custom thresholds", async () => {
    const formData = new FormData();
    formData.set("task_id", "task-123");
    formData.set("enabled", "true");

    const state = await setDefaultThresholds({}, formData);
    expect(state.error).toBeUndefined();

    // 1 GET for existing state, 1 PUT for atomic replacement
    expect(apiJsonCalls.length).toBe(2);
    expect(apiJsonCalls[0].path).toBe("/api/v1/tasks/task-123");
    expect(apiJsonCalls[1].path).toBe("/api/v1/tasks/task-123/thresholds");
    expect(apiJsonCalls[1].init?.method).toBe("PUT");

    const body = JSON.parse(apiJsonCalls[1].init?.body as string) as {
      thresholds: Array<{ days_before: number }>;
    };
    // Contains custom (10) and all defaults (7, 3, 1, 0)
    expect(body.thresholds).toEqual([
      { days_before: 10 },
      { days_before: 7 },
      { days_before: 3 },
      { days_before: 1 },
      { days_before: 0 },
    ]);

    // Revalidation executed after success
    expect(revalidatedPaths).toContain("/tasks");
  });

  test("disabling defaults sends exactly ONE atomic PUT request removing default offsets only", async () => {
    const formData = new FormData();
    formData.set("task_id", "task-123");
    formData.set("enabled", "false");

    const state = await setDefaultThresholds({}, formData);
    expect(state.error).toBeUndefined();

    expect(apiJsonCalls.length).toBe(2);
    expect(apiJsonCalls[1].path).toBe("/api/v1/tasks/task-123/thresholds");
    expect(apiJsonCalls[1].init?.method).toBe("PUT");

    const body = JSON.parse(apiJsonCalls[1].init?.body as string) as {
      thresholds: Array<{ days_before: number }>;
    };
    // Retains custom (10), removes 7 and 3
    expect(body.thresholds).toEqual([{ days_before: 10 }]);
    expect(revalidatedPaths).toContain("/tasks");
  });

  test("returns error and DOES NOT revalidate when PUT fails", async () => {
    putThresholdsResponse = { error: "Database error during bulk update" };

    const formData = new FormData();
    formData.set("task_id", "task-123");
    formData.set("enabled", "true");

    const state = await setDefaultThresholds({}, formData);
    expect(state.error).toBe("Database error during bulk update");
    expect(revalidatedPaths.length).toBe(0);
  });
});
