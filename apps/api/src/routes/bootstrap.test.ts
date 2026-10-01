process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { courses, profiles } from "@deadline-radar/db";
import {
  summarizeDeadlineBuckets,
  summarizeProgress,
  type ProgressSummary,
  type WeekSummary,
} from "@deadline-radar/domain";

import { resetRateLimitBuckets } from "../plugins/rate-limit";
import { resetBootstrapCache } from "../lib/bootstrap-cache";
import { setVerifyAccessTokenOverride } from "../lib/auth-tokens";
import {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
  type Capability,
} from "../lib/authorization";
import { DOMAIN_CAPABILITIES } from "../lib/authorization/capabilities";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type FixtureProfile = {
  id: string;
  email: string;
  name: string | null;
  timezone: string;
  timeFormat: "12h" | "24h";
};

type FixtureCourse = {
  id: string;
  userId: string;
  name: string;
  code: string | null;
  color: string | null;
  icon: string | null;
  description: string | null;
  createdAt: Date;
};

type FixtureTask = {
  deadline: string;
  status: string;
  courseName?: string | null;
  courseColor?: string | null;
};

let profileRows: FixtureProfile[];
let courseRows: FixtureCourse[];
let fixtureTasks: FixtureTask[];
let dbCalls = 0;

async function buildRpcSummary(): Promise<{
  summary: WeekSummary;
  progress: ProgressSummary;
}> {
  const rawTz = profileRows[0]?.timezone;
  let timeZone = "UTC";
  if (rawTz) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: rawTz }).format(new Date());
      timeZone = rawTz;
    } catch {
      timeZone = "UTC";
    }
  }
  return {
    summary: summarizeDeadlineBuckets(
      fixtureTasks.map((t) => ({ deadline: t.deadline, status: t.status })),
      timeZone,
    ),
    progress: summarizeProgress(
      fixtureTasks.map((t) => ({
        status: t.status,
        deadline: t.deadline,
        completedAt: null,
        courseName: t.courseName ?? null,
        courseColor: t.courseColor ?? null,
      })),
    ),
  };
}

mock.module("../lib/db", () => ({
  getDb: () => {
    let lastFrom: unknown = null;
    const chain = {
      select: () => chain,
      from: (table: unknown) => {
        lastFrom = table;
        return chain;
      },
      where: () => chain,
      orderBy: () => chain,
      limit: async () => {
        dbCalls += 1;
        if (lastFrom === courses) return courseRows;
        if (lastFrom === profiles) return profileRows;
        return [];
      },
      execute: async () => {
        dbCalls += 1;
        return [{ summary: await buildRpcSummary() }];
      },
    };
    return chain;
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

function setFixture() {
  profileRows = [
    {
      id: USER,
      email: "student@example.com",
      name: "Student",
      timezone: "Asia/Jakarta",
      timeFormat: "24h",
    },
  ];
  courseRows = [
    {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      userId: USER,
      name: "Matematika",
      code: "MTK101",
      color: "#ff0000",
      icon: "sigma",
      description: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
  ];
  fixtureTasks = [
    // Anchored 1s in the past, never exactly `now`: `missed` means
    // deadline-instant-before-now, so a deadline of `now` races the
    // endpoint's and the RPC helper's clocks within the same millisecond
    // and flakes (endpoint missed:0 vs RPC missed:1).
    { deadline: new Date(Date.now() - 1000).toISOString(), status: "todo" },
  ];
}

async function fetchBootstrap(
  token: string | null,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await app.handle(
    new Request("http://localhost/api/v1/bootstrap", {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    }),
  );
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
  };
}

let currentCapabilities: Capability[] = [...DOMAIN_CAPABILITIES];

describe("GET /api/v1/bootstrap — HTTP end-to-end", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    resetBootstrapCache();
    setFixture();
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
    const { status } = await fetchBootstrap(null);
    expect(status).toBe(401);
  });

  test("denies when any of the three capabilities is missing", async () => {
    for (const drop of [
      "profile.view",
      "course.view",
      "task.view",
    ] as Capability[]) {
      currentCapabilities = (
        [...DOMAIN_CAPABILITIES] as Capability[]
      ).filter((c) => c !== drop);
      const { status } = await fetchBootstrap("user-token");
      expect(status).toBe(403);
    }
  });

  test("returns user + courses + summary in one envelope", async () => {
    const { status, json } = await fetchBootstrap("user-token");
    expect(status).toBe(200);

    const user = json.user as Record<string, unknown>;
    expect(user.id).toBe(USER);
    expect(user.email).toBe("student@example.com");
    expect(user.timezone).toBe("Asia/Jakarta");
    expect(user.timeFormat).toBe("24h");
    expect(user.name).toBe("Student");
    expect(user.sessionId).toBe("s1");
    expect(user.pendingEmail).toBeNull();

    const list = json.courses as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Matematika");
    expect(list[0].code).toBe("MTK101");
    expect(typeof list[0].createdAt).toBe("string");

    const expected = await buildRpcSummary();
    expect(json.summary).toEqual(expected.summary);
    expect(json.progress).toEqual(expected.progress);
  });

  test("falls back to UTC profile fields when the profile row is missing", async () => {
    profileRows = [];
    const { status, json } = await fetchBootstrap("user-token");
    expect(status).toBe(200);
    const user = json.user as Record<string, unknown>;
    expect(user.timezone).toBe("UTC");
    expect(user.timeFormat).toBe("24h");
    expect(user.name).toBeNull();
  });

  test("serves repeat requests from cache without touching the DB", async () => {
    dbCalls = 0;
    const first = await fetchBootstrap("user-token");
    expect(first.status).toBe(200);
    expect(dbCalls).toBeGreaterThan(0);
    const callsAfterFirst = dbCalls;
    const second = await fetchBootstrap("user-token");
    expect(second.status).toBe(200);
    expect(second.json).toEqual(first.json);
    expect(dbCalls).toBe(callsAfterFirst);
  });
});
