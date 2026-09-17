process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  summarizeDeadlineBuckets,
  type ProgressSummary,
  type WeekSummary,
} from "@deadline-radar/domain";

import { resetRateLimitBuckets } from "../plugins/rate-limit";
import { setVerifyAccessTokenOverride } from "../lib/auth-tokens";
import {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
  type Capability,
} from "../lib/authorization";
import { DOMAIN_CAPABILITIES } from "../lib/authorization/capabilities";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

mock.module("../lib/db", () => ({
  getDb: () => {
    let tasksMode = false;
    const chain = {
      select: () => chain,
      from: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      limit: async () => (tasksMode ? [] : profileQueryReturn),
      then: (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => {
        tasksMode = true;
        return taskQueryReturn.then(resolve, reject);
      },
    };
    return { select: () => chain };
  },
}));

mock.module("../lib/supabase", () => ({
  createAnonClient: () => ({ auth: {} }),
  createUserClient: () => ({ auth: {} }),
  createServiceClient: () => ({ auth: {} }),
}));

mock.module("../lib/auth-audit", () => ({
  recordAuthEvent: async () => undefined,
}));

const { app } = await import("../app");

type FixtureTask = {
  deadline: string;
  status: string;
  completedAt?: string | null;
  courseName?: string | null;
  courseColor?: string | null;
};

let profileQueryReturn: { timezone: string }[];
let taskQueryReturn: Promise<
  {
    deadline: Date;
    status: string;
    completedAt: Date | null;
    courseName: string | null;
    courseColor: string | null;
  }[]
>;

function setFixture(tasks: FixtureTask[], timezone: string | null) {
  profileQueryReturn =
    timezone === null ? [] : [{ timezone }];
  taskQueryReturn = Promise.resolve(
    tasks
      .filter((t) => t.deadline !== "invalid")
      .map((t) => ({
        deadline: new Date(t.deadline),
        status: t.status,
        completedAt: t.completedAt ? new Date(t.completedAt) : null,
        courseName: t.courseName ?? null,
        courseColor: t.courseColor ?? null,
      })),
  );
}

function baseTasks(): FixtureTask[] {
  const now = new Date();
  const at = (days: number) =>
    new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  return [
    { deadline: at(0), status: "todo" }, // today
    { deadline: at(1), status: "todo" }, // tomorrow
    { deadline: at(2), status: "todo" }, // this week
    { deadline: at(6), status: "todo" }, // this week end
    { deadline: at(7), status: "todo" }, // next week (after thisWeek window)
    { deadline: at(8), status: "todo" }, // next week
    { deadline: at(13), status: "todo" }, // next week end
    { deadline: at(-1), status: "todo" }, // missed (yesterday), no day bucket
    { deadline: at(20), status: "done" }, // done → excluded everywhere
    { deadline: at(0), status: "done" }, // done today → excluded
  ];
}

async function fetchSummary(
  token: string | null,
  tasks: FixtureTask[],
  timezone: string | null = "UTC",
): Promise<{ status: number; json: Record<string, unknown> }> {
  setFixture(tasks, timezone);
  const before = new Date();
  const response = await app.handle(
    new Request("http://localhost/api/v1/summary", {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    }),
  );
  const after = new Date();
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
  };
}

/** The bucket function used internally — must exactly match what the API serves. */
function expectedSummary(
  tasks: FixtureTask[],
  timezone: string,
  now: Date,
): WeekSummary {
  return summarizeDeadlineBuckets(
    tasks
      .filter((t) => t.deadline !== "invalid")
      .map((t) => ({ deadline: t.deadline, status: t.status })),
    timezone,
    now,
  );
}

let currentCapabilities: Capability[] = [...DOMAIN_CAPABILITIES];

describe("GET /api/v1/summary — HTTP end-to-end", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    setFixture([], "UTC");
    currentCapabilities = [...DOMAIN_CAPABILITIES];
    setLoadAuthorizationContextOverride(async (subject) =>
      createAuthorizationContext({
        subject,
        roles: ["user"],
        capabilities: currentCapabilities,
      }),
    );
    setVerifyAccessTokenOverride(async (token) => {
      if (token === "user-token") {
        return { id: USER, email: "student@example.com", sessionId: "s1" };
      }
      return null;
    });
  });

  afterEach(() => {
    setVerifyAccessTokenOverride(null);
    setLoadAuthorizationContextOverride(null);
  });

  test("returns 401 without a valid token", async () => {
    const { status } = await fetchSummary(null, baseTasks(), "UTC");
    expect(status).toBe(401);
  });

  test("denies when the subject lacks task.view", async () => {
    currentCapabilities = ["course.view"];
    const { status } = await fetchSummary("user-token", baseTasks(), "UTC");
    expect(status).toBe(403);
  });

  test("serves bucket counts equal to the shared summarizer (no 50-item cap)", async () => {
    const tasks: FixtureTask[] = [];
    for (let i = 0; i < 120; i += 1) {
      const days = -60 + i * 1.5;
      tasks.push({
        deadline: new Date(
          new Date().getTime() + days * 24 * 60 * 60 * 1000,
        ).toISOString(),
        status: i % 7 === 0 ? "done" : "todo",
      });
    }
    const before = new Date();
    const thrown = await fetchSummary("user-token", tasks, "Europe/Berlin");
    const after = new Date();

    expect(thrown.status).toBe(200);
    const summary = (thrown.json as { summary: WeekSummary }).summary;
    const expected = [before, after].map((n) =>
      expectedSummary(tasks, "Europe/Berlin", n),
    );
    const serialized = expected.map((e) => JSON.stringify(e));
    expect(serialized).toContain(JSON.stringify(summary));
    expect(summary.allTasks).toBeGreaterThan(50);
  });

  test("honors the profile timezone and is insensitive to the env TZ", async () => {
    // A deadline at 18:00Z sits on a different calendar day in Asia/Jakarta
    // (UTC+7) than in UTC, so the two timezones must produce different buckets
    // for the same instant whenever the difference is observable.
    const today18z = new Date();
    today18z.setUTCHours(18, 0, 0, 0);
    const tasks: FixtureTask[] = [
      { deadline: today18z.toISOString(), status: "todo" },
    ];

    const utcResult = await fetchSummary("user-token", tasks, "UTC");
    const jakartaResult = await fetchSummary("user-token", tasks, "Asia/Jakarta");

    expect(utcResult.status).toBe(200);
    expect(jakartaResult.status).toBe(200);

    const utcSummary = (utcResult.json as { summary: WeekSummary }).summary;
    const jakartaSummary = (jakartaResult.json as { summary: WeekSummary })
      .summary;

    const utcExpected = expectedSummary(tasks, "UTC", new Date());
    const jakartaExpected = expectedSummary(
      tasks,
      "Asia/Jakarta",
      new Date(),
    );
    expect(utcSummary).toEqual(utcExpected);
    expect(jakartaSummary).toEqual(jakartaExpected);

    // Around 17:00–24:00Z the difference is masked (both buckets land on the
    // same Jakarta/UTC calendar day); assert the divergence whenever it is
    // observable to prove the profile timezone actually reaches the buckets.
    if (JSON.stringify(utcExpected) !== JSON.stringify(jakartaExpected)) {
      expect(JSON.stringify(utcSummary)).not.toBe(
        JSON.stringify(jakartaSummary),
      );
    } else {
      expect(utcSummary).toEqual(jakartaSummary);
    }
  });

  test("falls back to UTC when the profile has no timezone", async () => {
    const before = new Date();
    const tasks = baseTasks();
    const { status, json } = await fetchSummary("user-token", tasks, null);
    const after = new Date();

    expect(status).toBe(200);
    const summary = (json as { summary: WeekSummary }).summary;
    const utcExpected = [before, after].map((n) =>
      expectedSummary(tasks, "UTC", n),
    );
    expect(utcExpected.map((e) => JSON.stringify(e))).toContain(
      JSON.stringify(summary),
    );
  });

  test("returns exactly the seven bucket keys", async () => {
    const { status, json } = await fetchSummary(
      "user-token",
      baseTasks(),
      "UTC",
    );
    expect(status).toBe(200);
    expect(Object.keys((json as { summary: WeekSummary }).summary).sort())
      .toEqual(
        [
          "allTasks",
          "missed",
          "nextWeek",
          "thisMonth",
          "thisWeek",
          "today",
          "tomorrow",
        ].sort(),
      );
  });

  test("returns progress stats alongside the buckets", async () => {
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const day = 24 * 60 * 60 * 1000;
    const tasks: FixtureTask[] = [
      {
        deadline: iso(now + day),
        status: "done",
        completedAt: iso(now - day),
        courseName: "Math",
        courseColor: "#0088ff",
      },
      {
        deadline: iso(now - day),
        status: "done",
        completedAt: iso(now),
        courseName: "Math",
        courseColor: "#0088ff",
      },
      {
        deadline: iso(now + day),
        status: "todo",
        courseName: "Math",
        courseColor: "#0088ff",
      },
      {
        deadline: iso(now + 2 * day),
        status: "todo",
        courseName: "Physics",
        courseColor: "#34c759",
      },
    ];
    const { status, json } = await fetchSummary("user-token", tasks, "UTC");

    expect(status).toBe(200);
    expect((json as { progress: ProgressSummary }).progress).toEqual({
      completed: 2,
      total: 4,
      onTime: 1,
      onTimeTotal: 2,
      courses: [
        { name: "Math", color: "#0088ff", tasks: 1 },
        { name: "Physics", color: "#34c759", tasks: 1 },
      ],
    });
  });
});