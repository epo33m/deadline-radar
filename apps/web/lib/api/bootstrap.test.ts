import { describe, expect, mock, test } from "bun:test";

// server.ts pulls next/headers (no Next runtime under bun test), and every
// test below injects its own fetchJson — so stub the module boundary.
// Same specifier the actions tests mock; factories must all stay complete
// because bun shares one module registry across test files.
mock.module("@/lib/api/server", () => ({
  apiJson: async () => {
    throw new Error("apiJson must be injected in tests");
  },
  clearLocalAuthCookies: async () => undefined,
}));

import { getBootstrap } from "./bootstrap";

const VALID = {
  user: {
    id: "u1",
    email: "student@example.com",
    timezone: "Asia/Jakarta",
    timeFormat: "24h" as const,
    name: "Student",
    sessionId: "s1",
    pendingEmail: null,
  },
  courses: [
    {
      id: "c1",
      userId: "u1",
      name: "Matematika",
      code: "MTK101",
      color: "#ff0000",
      icon: null,
      description: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
    },
  ],
  summary: {
    today: 1,
    tomorrow: 0,
    thisWeek: 2,
    nextWeek: 0,
    thisMonth: 3,
    missed: 0,
    allTasks: 3,
  },
  progress: {
    completed: 0,
    total: 3,
    onTime: 0,
    onTimeTotal: 3,
    courses: [],
  },
};

describe("getBootstrap", () => {
  test("returns user + courses + summary + progress on valid payload", async () => {
    const result = await getBootstrap(async () => VALID as never);
    expect(result.user?.id).toBe("u1");
    expect(result.user?.timezone).toBe("Asia/Jakarta");
    expect(result.courses).toHaveLength(1);
    expect(result.summary?.today).toBe(1);
    expect(result.progress?.total).toBe(3);
    expect(result.error).toBeUndefined();
  });

  test("rejects malformed summary counts", async () => {
    const result = await getBootstrap(
      async () => ({ ...VALID, summary: { today: "x" } }) as never,
    );
    expect(result.user).toBeUndefined();
    expect(typeof result.error).toBe("string");
  });

  test("rejects malformed user and non-array courses", async () => {
    const badUser = await getBootstrap(
      async () => ({ ...VALID, user: { id: 1 } }) as never,
    );
    expect(badUser.user).toBeUndefined();

    const badCourses = await getBootstrap(
      async () => ({ ...VALID, courses: {} }) as never,
    );
    expect(badCourses.user).toBeUndefined();
  });

  test("rejects bad timeFormat", async () => {
    const result = await getBootstrap(
      async () =>
        ({ ...VALID, user: { ...VALID.user, timeFormat: "13h" } }) as never,
    );
    expect(result.user).toBeUndefined();
  });
});
