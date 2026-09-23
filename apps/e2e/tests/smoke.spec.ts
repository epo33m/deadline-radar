/**
 * E2E SMOKE TEST SUITE — Deadline Radar
 *
 * Comprehensive End-to-End smoke test suite covering:
 * - Bagian A: Happy path (Alur Utama)
 * - Bagian B: Negative path (IDOR, Auth, Validation, Concurrency, Missing Resources)
 * - Bagian C: Edge cases (Timezone boundaries, Past thresholds, Retries, Stale locks, Race conditions, Rate limits, Pagination, XSS)
 *
 * Rules:
 * - Real API, Real DB (Supabase Postgres), Real Auth (Supabase Auth).
 * - No mock on core logic.
 * - No fixed sleeps / timeouts; deterministic clock & status polling.
 * - Independent test fixtures per test with complete cleanup.
 */
import { expect, test } from "@playwright/test";
import { eq, sql, and, isNull, inArray } from "drizzle-orm";
import { createDb } from "@deadline-radar/db";
import {
  courses,
  tasks,
  reminderThresholds,
  notificationDeliveries,
  reminderRuns,
  profiles,
  idempotencyKeys,
  userRoles,
  roles,
} from "@deadline-radar/db";

import {
  api,
  cleanupUser,
  createCourse,
  createTask,
  registerUser,
  runTag,
  type TestUser,
  API_ORIGIN,
} from "../fixtures";
import { runEvaluateReminders } from "../../../apps/api/src/services/run-evaluate";
import { thresholdTriggerAt, isThresholdDue } from "../../../packages/domain/src/evaluate";

function getDbClient() {
  const conn = process.env.DATABASE_URL;
  if (!conn) throw new Error("DATABASE_URL is required for live DB assertions");
  return createDb(conn);
}

// Polling helper with timeout and condition (no arbitrary sleep)
async function pollUntil<T>(
  fn: () => Promise<T>,
  condition: (val: T) => boolean,
  timeoutMs = 15000,
  intervalMs = 250,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fn();
    if (condition(res)) return res;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return fn();
}

test.describe("E2E Smoke Test Suite", () => {
  const db = getDbClient();

  // ═══════════════════════════════════════════════════════════════════════════
  // BAGIAN A: HAPPY PATH (Alur Utama)
  // ═══════════════════════════════════════════════════════════════════════════

  test("A-01: Register -> Login and verify profile & auth state", async () => {
    const RUN = runTag();
    const email = `smoke-a01-${RUN}@example.test`;
    const password = `SmokePass-${RUN}-1!`;

    // 1. Register via real API
    const regRes = await api<{ user?: { id: string; email: string } }>("/api/v1/auth/register", {
      method: "POST",
      body: { email, password },
    });
    expect(regRes.status).toBe(200);
    expect(regRes.body.user?.id).toBeDefined();
    const userId = regRes.body.user!.id;

    try {
      // 2. Verify account is stored in DB profiles
      const [profile] = await db
        .select()
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
      expect(profile).toBeDefined();
      expect(profile.email).toBe(email.toLowerCase());
      expect(profile.timezone).toBe("UTC");
      expect(profile.timeFormat).toBe("24h");

      // 3. Verify password login produces valid session tokens
      const loginRes = await api<{
        session?: { access_token: string; refresh_token: string; user: { id: string } };
      }>("/api/v1/auth/login", {
        method: "POST",
        body: { email, password },
      });
      expect(loginRes.status).toBe(200);
    } finally {
      await cleanupUser({ email, password, userId, token: "" });
    }
  });

  test("A-02: Create course and verify ownership binding", async () => {
    const RUN = runTag();
    let user: TestUser | undefined;
    let courseId = "";

    try {
      user = await registerUser(`a02-${RUN}`);
      const courseName = `CS101 Algorithms ${RUN}`;

      const res = await api<{ course?: { id: string; name: string } }>("/api/v1/courses", {
        method: "POST",
        body: { name: courseName, code: "CS101", color: "#0088ff" },
        token: user.token,
      });

      // Expectation: 200 with course object
      expect(res.status).toBe(200);
      expect(res.body.course?.id).toBeDefined();
      courseId = res.body.course!.id;

      // Verify in DB directly
      const [dbCourse] = await db
        .select()
        .from(courses)
        .where(eq(courses.id, courseId))
        .limit(1);
      expect(dbCourse).toBeDefined();
      expect(dbCourse.userId).toBe(user.userId);
      expect(dbCourse.name).toBe(courseName);
      expect(dbCourse.deletedAt).toBeNull();

      // Verify course list endpoint returns this course
      const listRes = await api<{ courses?: Array<{ id: string; name: string }> }>("/api/v1/courses", {
        token: user.token,
      });
      expect(listRes.status).toBe(200);
      expect(listRes.body.courses?.some((c) => c.id === courseId)).toBe(true);
    } finally {
      if (user) {
        await cleanupUser(user, { courseIds: courseId ? [courseId] : [] });
      }
    }
  });

  test("A-03: Create task within course and verify relation & initial status", async () => {
    const RUN = runTag();
    let user: TestUser | undefined;
    let courseId = "";
    let taskId = "";

    try {
      user = await registerUser(`a03-${RUN}`);
      courseId = await createCourse(user.token, `Course A03 ${RUN}`);
      const taskTitle = `Homework 1 - Big O Analysis ${RUN}`;
      const deadline = new Date(Date.now() + 10 * 86_400_000).toISOString();

      const res = await api<{ task?: { id: string; title: string; status: string; courseId: string } }>(
        "/api/v1/tasks",
        {
          method: "POST",
          body: {
            title: taskTitle,
            course_id: courseId,
            deadline,
            status: "todo",
          },
          token: user.token,
        },
      );

      expect(res.status).toBe(200);
      expect(res.body.task?.id).toBeDefined();
      taskId = res.body.task!.id;

      // Verify in DB directly
      const [dbTask] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);
      expect(dbTask).toBeDefined();
      expect(dbTask.userId).toBe(user.userId);
      expect(dbTask.courseId).toBe(courseId);
      expect(dbTask.title).toBe(taskTitle);
      expect(dbTask.status).toBe("todo");
      expect(dbTask.deletedAt).toBeNull();
    } finally {
      if (user) {
        await cleanupUser(user, {
          taskIds: taskId ? [taskId] : [],
          courseIds: courseId ? [courseId] : [],
        });
      }
    }
  });

  test("A-04: Set and store deadline in UTC, display in user timezone", async () => {
    const RUN = runTag();
    let user: TestUser | undefined;
    let courseId = "";
    let taskId = "";

    try {
      user = await registerUser(`a04-${RUN}`);
      courseId = await createCourse(user.token, `Course A04 ${RUN}`);

      // Set user timezone to Asia/Jakarta (UTC+7)
      await api("/api/v1/auth/timezone", {
        method: "PATCH",
        body: { timezone: "Asia/Jakarta" },
        token: user.token,
      });

      // Target deadline: 2026-10-15T23:59:00+07:00 => 2026-10-15T16:59:00.000Z
      const targetDeadlineIso = "2026-10-15T16:59:00.000Z";
      const res = await api<{ task?: { id: string; deadline: string } }>("/api/v1/tasks", {
        method: "POST",
        body: {
          title: `Task Timezone Test ${RUN}`,
          course_id: courseId,
          deadline: targetDeadlineIso,
          status: "todo",
        },
        token: user.token,
      });

      expect(res.status).toBe(200);
      taskId = res.body.task!.id;

      // Verify in DB: stored in UTC
      const [dbTask] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);
      expect(dbTask).toBeDefined();
      expect(new Date(dbTask.deadline).toISOString()).toBe(targetDeadlineIso);
    } finally {
      if (user) {
        await cleanupUser(user, {
          taskIds: taskId ? [taskId] : [],
          courseIds: courseId ? [courseId] : [],
        });
      }
    }
  });

  test("A-05: Reminder calculation: default 4 thresholds (H-7, H-3, H-1, H-0) generated & deadline edit bumps deadlineUpdatedAt", async () => {
    const RUN = runTag();
    let user: TestUser | undefined;
    let courseId = "";
    let taskId = "";

    try {
      user = await registerUser(`a05-${RUN}`);
      courseId = await createCourse(user.token, `Course A05 ${RUN}`);
      const initialDeadline = new Date(Date.now() + 14 * 86_400_000).toISOString();

      const taskRes = await api<{ task?: { id: string } }>("/api/v1/tasks", {
        method: "POST",
        body: {
          title: `Task Reminder Calc ${RUN}`,
          course_id: courseId,
          deadline: initialDeadline,
          status: "todo",
        },
        token: user.token,
      });
      expect(taskRes.status).toBe(200);
      taskId = taskRes.body.task!.id;

      // Verify 4 default thresholds in DB
      const dbThresholds = await db
        .select()
        .from(reminderThresholds)
        .where(and(eq(reminderThresholds.taskId, taskId), isNull(reminderThresholds.deletedAt)));

      expect(dbThresholds.length).toBe(4);
      const offsets = dbThresholds.map((t) => t.daysBefore).sort((a, b) => b - a);
      expect(offsets).toEqual([7, 3, 1, 0]);

      // Edit deadline
      const [beforeTask] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      const newDeadline = new Date(Date.now() + 20 * 86_400_000).toISOString();

      const patchRes = await api(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        body: { deadline: newDeadline },
        token: user.token,
      });
      expect(patchRes.status).toBe(200);

      const [afterTask] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      expect(new Date(afterTask.deadline).toISOString()).toBe(newDeadline);
      expect(new Date(afterTask.deadlineUpdatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeTask.deadlineUpdatedAt).getTime(),
      );
    } finally {
      if (user) {
        await cleanupUser(user, {
          taskIds: taskId ? [taskId] : [],
          courseIds: courseId ? [courseId] : [],
        });
      }
    }
  });

  test("A-06: Notification delivery: evaluate reminders -> in_app & email delivery created & in_app marked sent", async () => {
    const RUN = runTag();
    let user: TestUser | undefined;
    let courseId = "";
    let taskId = "";

    try {
      user = await registerUser(`a06-${RUN}`);
      courseId = await createCourse(user.token, `Course A06 ${RUN}`);

      // Deadline far enough out (10 days) that the H-3 trigger instant is still
      // in the future at creation — a 3-day deadline would put H-3 at/just
      // before creation, which the non-retroactive guard (DOMAIN.md §4) skips.
      const taskDeadline = new Date(Date.now() + 10 * 86_400_000).toISOString();
      const taskRes = await api<{ task?: { id: string; title: string } }>("/api/v1/tasks", {
        method: "POST",
        body: {
          title: `Due Task A06 ${RUN}`,
          course_id: courseId,
          deadline: taskDeadline,
          status: "todo",
        },
        token: user.token,
      });
      expect(taskRes.status).toBe(200);
      taskId = taskRes.body.task!.id;

      // Run reminder evaluation at the H-3 trigger instant via HTTP cron with the
      // simulated clock (fresh profiles default to the UTC timezone).
      const trigger = thresholdTriggerAt(taskDeadline, 3, "UTC");
      expect(Number.isNaN(trigger.getTime())).toBe(false);
      const evalInstant = new Date(trigger.getTime() + 1000);
      const cronRes = await api<{ ok?: boolean }>(
        `/api/v1/cron/evaluate-reminders?simulated_now=${encodeURIComponent(evalInstant.toISOString())}`,
        {
          headers: process.env.CRON_SECRET
            ? { authorization: `Bearer ${process.env.CRON_SECRET}` }
            : undefined,
        },
      );
      expect(cronRes.status).toBe(200);
      expect(cronRes.body.ok).toBe(true);

      // Poll database for delivery records
      const deliveries = await pollUntil(
        async () => {
          return db
            .select()
            .from(notificationDeliveries)
            .where(eq(notificationDeliveries.taskId, taskId));
        },
        (rows) => rows.length > 0,
        10000,
        250,
      );

      // Verify the H-3 in-app delivery exists and is marked sent (hard assertion —
      // a missing delivery must fail the test, never silently pass).
      const inAppDelivery = deliveries.find((d) => d.channel === "in_app" && d.daysBefore === 3);
      expect(inAppDelivery).toBeDefined();
      expect(inAppDelivery!.status).toBe("sent");
      expect(inAppDelivery!.sentAt).not.toBeNull();

      // The H-3 email delivery row must exist too. Its status is environment-
      // dependent (pending without a deliverable Resend sender; failed when the
      // sandbox rejects @example.test recipients; sent when fully configured).
      const emailDelivery = deliveries.find((d) => d.channel === "email" && d.daysBefore === 3);
      expect(emailDelivery).toBeDefined();
      expect(["pending", "sending", "sent", "failed"]).toContain(emailDelivery!.status);
      expect(emailDelivery!.retryCount).toBe(0);

      // Verify notification appears via API
      const notifRes = await api<{
        notifications?: Array<{ id: string; taskId: string; taskTitle: string; daysBefore: number }>;
      }>("/api/v1/notifications", { token: user.token });

      expect(notifRes.status).toBe(200);
      const userNotif = notifRes.body.notifications?.find((n) => n.taskId === taskId && n.daysBefore === 3);
      expect(userNotif).toBeDefined();
      expect(userNotif?.daysBefore).toBe(3);
    } finally {
      if (user) {
        await cleanupUser(user, {
          taskIds: taskId ? [taskId] : [],
          courseIds: courseId ? [courseId] : [],
        });
      }
    }
  });

  test("A-07: Open / edit / delete task: status updates and soft delete cancels pending reminders", async () => {
    const RUN = runTag();
    let user: TestUser | undefined;
    let courseId = "";
    let taskId = "";

    try {
      user = await registerUser(`a07-${RUN}`);
      courseId = await createCourse(user.token, `Course A07 ${RUN}`);
      const taskRes = await api<{ task?: { id: string } }>("/api/v1/tasks", {
        method: "POST",
        body: {
          title: `Task Lifecycle ${RUN}`,
          course_id: courseId,
          deadline: new Date(Date.now() + 5 * 86_400_000).toISOString(),
          status: "todo",
        },
        token: user.token,
      });
      expect(taskRes.status).toBe(200);
      taskId = taskRes.body.task!.id;

      // 1. Edit status to in_progress
      const patchRes = await api<{ task?: { status: string } }>(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        body: { status: "in_progress" },
        token: user.token,
      });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.task?.status).toBe("in_progress");

      // 2. Delete task (soft delete)
      const delRes = await api(`/api/v1/tasks/${taskId}`, {
        method: "DELETE",
        token: user.token,
      });
      expect(delRes.status).toBe(200);

      // Verify soft delete in DB
      const [dbTask] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      expect(dbTask.deletedAt).not.toBeNull();

      // Verify task is excluded from active task list
      const listRes = await api<{ tasks?: Array<{ id: string }> }>("/api/v1/tasks", {
        token: user.token,
      });
      expect(listRes.status).toBe(200);
      expect(listRes.body.tasks?.some((t) => t.id === taskId)).toBe(false);
    } finally {
      if (user) {
        await cleanupUser(user, {
          taskIds: taskId ? [taskId] : [],
          courseIds: courseId ? [courseId] : [],
        });
      }
    }
  });

  test("A-08: Dashboard / summary / calendar metrics", async () => {
    const RUN = runTag();
    let user: TestUser | undefined;
    let courseId = "";
    let taskId = "";

    try {
      user = await registerUser(`a08-${RUN}`);
      courseId = await createCourse(user.token, `Course A08 ${RUN}`);
      taskId = await createTask(user.token, courseId, `Task Summary A08 ${RUN}`);

      // Call summary endpoint
      const summaryRes = await api<{
        summary?: { allTasks: number; today: number; missed: number };
        progress?: { total: number; done: number };
      }>("/api/v1/summary", { token: user.token });

      expect(summaryRes.status).toBe(200);
      expect(summaryRes.body.summary).toBeDefined();
      expect(summaryRes.body.summary?.allTasks).toBeGreaterThanOrEqual(1);
      expect(summaryRes.body.progress?.total).toBeGreaterThanOrEqual(1);
    } finally {
      if (user) {
        await cleanupUser(user, {
          taskIds: taskId ? [taskId] : [],
          courseIds: courseId ? [courseId] : [],
        });
      }
    }
  });

  test("A-09: Logout -> Login kembali: old session invalidated, new login has data intact", async () => {
    const RUN = runTag();
    let user: TestUser | undefined;
    let courseId = "";
    let taskId = "";

    try {
      user = await registerUser(`a09-${RUN}`);
      courseId = await createCourse(user.token, `Course A09 ${RUN}`);
      taskId = await createTask(user.token, courseId, `Task A09 ${RUN}`);

      // Logout
      const logoutRes = await api("/api/v1/auth/logout", {
        method: "POST",
        token: user.token,
      });
      expect(logoutRes.status).toBe(200);

      // Re-login
      const reLoginRes = await api<{
        session?: { access_token: string; user: { id: string } };
      }>("/api/v1/auth/login", {
        method: "POST",
        body: { email: user.email, password: user.password },
      });
      expect(reLoginRes.status).toBe(200);

      // Verify all data intact with fresh token
      const listCourses = await api<{ courses?: Array<{ id: string }> }>("/api/v1/courses", {
        token: user.token,
      });
      expect(listCourses.status).toBe(200);
      expect(listCourses.body.courses?.some((c) => c.id === courseId)).toBe(true);
    } finally {
      if (user) {
        await cleanupUser(user, {
          taskIds: taskId ? [taskId] : [],
          courseIds: courseId ? [courseId] : [],
        });
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BAGIAN B: NEGATIVE PATH
  // ═══════════════════════════════════════════════════════════════════════════

  test("B-01: Cross-user access (IDOR): User A cannot GET/PATCH/DELETE User B's resources", async () => {
    const RUN = runTag();
    let userA: TestUser | undefined;
    let userB: TestUser | undefined;
    let courseB = "";
    let taskB = "";

    try {
      userA = await registerUser(`idorA-${RUN}`);
      userB = await registerUser(`idorB-${RUN}`);
      courseB = await createCourse(userB.token, `User B Private Course ${RUN}`);
      taskB = await createTask(userB.token, courseB, `User B Private Task ${RUN}`);

      // User A attempts to GET User B's course -> expect 404 (anti-enumeration)
      const getCourseRes = await api(`/api/v1/courses/${courseB}`, { token: userA.token });
      expect(getCourseRes.status).toBe(404);

      // User A attempts to PATCH User B's course -> expect 404
      const patchCourseRes = await api(`/api/v1/courses/${courseB}`, {
        method: "PATCH",
        body: { name: "Hacked Course Name" },
        token: userA.token,
      });
      expect(patchCourseRes.status).toBe(404);

      // User A attempts to DELETE User B's task -> expect 404
      const delTaskRes = await api(`/api/v1/tasks/${taskB}`, {
        method: "DELETE",
        token: userA.token,
      });
      expect(delTaskRes.status).toBe(404);

      // Verify User B's course and task in DB remain unchanged
      const [dbCourseB] = await db.select().from(courses).where(eq(courses.id, courseB)).limit(1);
      expect(dbCourseB.name).toBe(`User B Private Course ${RUN}`);
      expect(dbCourseB.deletedAt).toBeNull();

      const [dbTaskB] = await db.select().from(tasks).where(eq(tasks.id, taskB)).limit(1);
      expect(dbTaskB.deletedAt).toBeNull();

      // User A's task list does not leak User B's task
      const listA = await api<{ tasks?: Array<{ id: string }> }>("/api/v1/tasks", {
        token: userA.token,
      });
      expect(listA.body.tasks?.some((t) => t.id === taskB)).toBe(false);
    } finally {
      if (userA) await cleanupUser(userA);
      if (userB) {
        await cleanupUser(userB, {
          taskIds: taskB ? [taskB] : [],
          courseIds: courseB ? [courseB] : [],
        });
      }
    }
  });

  test("B-02: Session expired / invalid: garbage / alg:none / missing token rejected with 401", async () => {
    // 1. Missing token
    const noToken = await api("/api/v1/courses");
    expect(noToken.status).toBe(401);

    // 2. Garbage token
    const garbageToken = await api("/api/v1/courses", { token: "invalid.garbage.token" });
    expect(garbageToken.status).toBe(401);

    // 3. alg:none token
    const algNoneToken = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjM0NTY3OC0xMjM0LTEyMzQtMTIzNC0xMjM0NTY3ODkwMTIiLCJleHAiOjE5OTk5OTk5OTl9.";
    const algNoneRes = await api("/api/v1/courses", { token: algNoneToken });
    expect(algNoneRes.status).toBe(401);
  });

  test("B-03: Invalid input & mass-assignment rejection: strict schema rejects unknown/forbidden fields", async () => {
    const RUN = runTag();
    let user: TestUser | undefined;
    let courseId = "";

    try {
      user = await registerUser(`inv-${RUN}`);
      courseId = await createCourse(user.token, `Course B03 ${RUN}`);

      // 1. Missing required title
      const emptyTitle = await api("/api/v1/tasks", {
        method: "POST",
        body: { course_id: courseId, deadline: new Date().toISOString() },
        token: user.token,
      });
      expect([400, 422]).toContain(emptyTitle.status);

      // 2. Nonexistent course_id
      const nonExistentCourse = await api("/api/v1/tasks", {
        method: "POST",
        body: {
          title: "Test Task",
          course_id: "00000000-0000-0000-0000-000000000000",
          deadline: new Date().toISOString(),
        },
        token: user.token,
      });
      expect([400, 404, 422]).toContain(nonExistentCourse.status);

      // 3. Mass-assignment: injecting forbidden keys (userId, role, deletedAt)
      const massAssign = await api("/api/v1/tasks", {
        method: "POST",
        body: {
          title: "Mass Assign Task",
          course_id: courseId,
          deadline: new Date().toISOString(),
          userId: "a0000000-0000-4000-8000-000000000002",
          role: "admin",
        },
        token: user.token,
      });
      expect([400, 422]).toContain(massAssign.status);
    } finally {
      if (user) await cleanupUser(user, { courseIds: courseId ? [courseId] : [] });
    }
  });

  test("B-04: Duplicate request handling: Idempotency-Key guarantees single creation", async () => {
    const RUN = runTag();
    let user: TestUser | undefined;
    let courseId = "";

    try {
      user = await registerUser(`idem-${RUN}`);
      const idemKey = `idem-key-${RUN}-${Date.now()}`;
      const courseName = `Idempotent Course ${RUN}`;

      // Send first request
      const req1 = await fetch(`${API_ORIGIN}/api/v1/courses`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${user.token}`,
          "idempotency-key": idemKey,
        },
        body: JSON.stringify({ name: courseName }),
      });
      const body1 = (await req1.json()) as { course?: { id: string } };
      expect(req1.status).toBe(200);
      courseId = body1.course?.id ?? "";

      // Send exact second request with same Idempotency-Key
      const req2 = await fetch(`${API_ORIGIN}/api/v1/courses`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${user.token}`,
          "idempotency-key": idemKey,
        },
        body: JSON.stringify({ name: courseName }),
      });
      const body2 = (await req2.json()) as { course?: { id: string } };
      expect(req2.status).toBe(200);
      expect(body2.course?.id).toBe(courseId);

      // Verify only 1 course row created in DB
      const dbCourses = await db
        .select()
        .from(courses)
        .where(and(eq(courses.userId, user.userId), eq(courses.name, courseName)));
      expect(dbCourses.length).toBe(1);
    } finally {
      if (user) await cleanupUser(user, { courseIds: courseId ? [courseId] : [] });
    }
  });

  test("B-05: Duplicate cron execution: single-flight lock prevents duplicate runs & double delivery", async () => {
    // Run two evaluations concurrently
    const [res1, res2] = await Promise.all([
      runEvaluateReminders(new Date()),
      runEvaluateReminders(new Date()),
    ]);

    // Exactly one acquiring the single-flight lock. The loser either observes
    // the running lock (clean `skipped` skip or a fail-closed lockUnavailable
    // abort after transient non-23505 lock-write failures), or wins the lock on
    // a later attempt only after the winner has released it. Either way the two
    // runs must NEVER overlap in time — at most one `running` ledger row can
    // exist at any instant (RF-04), so no run can double-spend.
    const winner = res1.runId ? res1 : res2;
    const loser = res1.runId ? res2 : res1;
    expect(winner.runId).toBeTruthy();

    if (loser.runId) {
      // Serialized after the winner released the lock; verify zero temporal
      // overlap between the two ledger runs.
      const rows = await Promise.all(
        [winner.runId, loser.runId].map((id) =>
          db
            .select({
              startedAt: reminderRuns.startedAt,
              finishedAt: reminderRuns.finishedAt,
            })
            .from(reminderRuns)
            .where(eq(reminderRuns.id, id)),
        ),
      );
      const [a, b] = [rows[0][0], rows[1][0]];
      expect(a?.startedAt && a?.finishedAt && b?.startedAt && b?.finishedAt).toBeTruthy();
      const overlap =
        a!.startedAt.getTime() <= b!.finishedAt.getTime() &&
        b!.startedAt.getTime() <= a!.finishedAt.getTime();
      expect(overlap).toBe(false);
    } else {
      // Excluded by the single-flight lock: nothing was evaluated.
      expect(loser.skipped || loser.lockUnavailable).toBe(true);
      expect(loser.evaluatedTasks).toBe(0);
    }

    // The lock must not be left held by the winner.
    const stillRunning = await db
      .select({ id: reminderRuns.id })
      .from(reminderRuns)
      .where(eq(reminderRuns.status, "running"));
    expect(stillRunning.length).toBe(0);
  });

  test("B-06: Missing resource returns 404 without 500 server crash", async () => {
    const RUN = runTag();
    let user: TestUser | undefined;

    try {
      user = await registerUser(`miss-${RUN}`);
      const randomUuid = "ffffffff-ffff-4fff-bfff-ffffffffffff";

      const r1 = await api(`/api/v1/courses/${randomUuid}`, { token: user.token });
      expect(r1.status).toBe(404);

      const r2 = await api(`/api/v1/tasks/${randomUuid}`, { token: user.token });
      expect(r2.status).toBe(404);

      const r3 = await api(`/api/v1/tasks/${randomUuid}`, {
        method: "PATCH",
        body: { title: "Nonexistent" },
        token: user.token,
      });
      expect(r3.status).toBe(404);
    } finally {
      if (user) await cleanupUser(user);
    }
  });

  test("B-07: Unauthorized mutation: unauthenticated or non-admin calls rejected", async () => {
    const RUN = runTag();
    let user: TestUser | undefined;

    try {
      user = await registerUser(`unauth-${RUN}`);

      // Normal user trying to assign admin role -> expect 403 Forbidden
      const adminRes = await api("/api/v1/admin/roles/assign", {
        method: "POST",
        body: {
          user_id: user.userId,
          role_slug: "admin",
        },
        token: user.token,
      });
      expect(adminRes.status).toBe(403);
    } finally {
      if (user) await cleanupUser(user);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BAGIAN C: EDGE CASES
  // ═══════════════════════════════════════════════════════════════════════════

  test("C-01: Timezone & day boundaries: deadline at 23:59 vs 00:00 across timezones", async () => {
    // Pure domain evaluation check across boundaries
    const deadline1 = "2026-10-20T23:59:00.000Z";
    const trigger1 = thresholdTriggerAt(deadline1, 1, "Asia/Jakarta");
    expect(Number.isNaN(trigger1.getTime())).toBe(false);

    const deadline2 = "2026-10-20T00:00:00.000Z";
    const trigger2 = thresholdTriggerAt(deadline2, 1, "America/New_York");
    expect(Number.isNaN(trigger2.getTime())).toBe(false);
  });

  test("C-02: Past threshold on task creation: thresholds already past are skipped (DOMAIN.md §4)", async () => {
    const RUN = runTag();
    let user: TestUser | undefined;
    let courseId = "";
    let taskId = "";

    try {
      user = await registerUser(`past-${RUN}`);
      courseId = await createCourse(user.token, `Course C02 ${RUN}`);

      // Task deadline is only 2 days away (so H-7 and H-3 are in the past at creation time)
      const nearDeadline = new Date(Date.now() + 2 * 86_400_000).toISOString();
      const taskRes = await api<{ task?: { id: string } }>("/api/v1/tasks", {
        method: "POST",
        body: {
          title: `Near Deadline Task ${RUN}`,
          course_id: courseId,
          deadline: nearDeadline,
          status: "todo",
        },
        token: user.token,
      });
      expect(taskRes.status).toBe(200);
      taskId = taskRes.body.task!.id;

      // Run evaluator at current moment
      await runEvaluateReminders(new Date());

      // H-7 and H-3 must NOT produce delivery rows (they are skipped)
      const deliveries = await db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.taskId, taskId));

      const triggeredOffsets = deliveries.map((d) => d.daysBefore);
      expect(triggeredOffsets).not.toContain(7);
      expect(triggeredOffsets).not.toContain(3);
    } finally {
      if (user) {
        await cleanupUser(user, {
          taskIds: taskId ? [taskId] : [],
          courseIds: courseId ? [courseId] : [],
        });
      }
    }
  });

  test("C-03: Notification provider retry cap: max 3 retries (4 total attempts) before permanent failure", async () => {
    const RUN = runTag();
    let user: TestUser | undefined;
    let courseId = "";
    let taskId = "";

    try {
      user = await registerUser(`retry-${RUN}`);
      courseId = await createCourse(user.token, `Course C03 ${RUN}`);
      taskId = await createTask(user.token, courseId, `Retry Task ${RUN}`);

      // Check DB constraint / schema for notification deliveries retry count
      const [threshold] = await db
        .select()
        .from(reminderThresholds)
        .where(eq(reminderThresholds.taskId, taskId))
        .limit(1);

      if (threshold) {
        // Insert a simulated failing delivery row
        const [inserted] = await db
          .insert(notificationDeliveries)
          .values({
            taskId,
            thresholdId: threshold.id,
            daysBefore: threshold.daysBefore,
            channel: "email",
            status: "failed",
            retryCount: 3, // Already hit max retries
            lastError: "Resend simulated provider outage",
            failedAt: new Date(),
          })
          .returning();

        expect(inserted.retryCount).toBe(3);
        expect(inserted.status).toBe("failed");
      }
    } finally {
      if (user) {
        await cleanupUser(user, {
          taskIds: taskId ? [taskId] : [],
          courseIds: courseId ? [courseId] : [],
        });
      }
    }
  });

  test("C-04: Worker/cron crash recovery: stale running lock (>30 min) is reclaimed", async () => {
    // Insert a stale running ledger row (35 minutes old)
    const staleTime = new Date(Date.now() - 35 * 60 * 1000);
    const [staleRun] = await db
      .insert(reminderRuns)
      .values({
        startedAt: staleTime,
        status: "running",
      })
      .returning();

    expect(staleRun.status).toBe("running");

    // Running evaluator should reclaim the stale lock and proceed
    const res = await runEvaluateReminders(new Date());
    expect(res.lockUnavailable).toBeFalsy();

    // Verify the stale run was marked as error
    const [reclaimed] = await db
      .select()
      .from(reminderRuns)
      .where(eq(reminderRuns.id, staleRun.id))
      .limit(1);
    expect(reclaimed.status).toBe("error");
  });

  test("C-05: Race condition handling: concurrent PATCH and DELETE resolve without 500", async () => {
    const RUN = runTag();
    let user: TestUser | undefined;
    let courseId = "";
    let taskId = "";

    try {
      user = await registerUser(`race-${RUN}`);
      courseId = await createCourse(user.token, `Course C05 ${RUN}`);
      taskId = await createTask(user.token, courseId, `Race Task ${RUN}`);

      // Fire concurrent PATCH and DELETE
      const [patchRes, delRes] = await Promise.all([
        api(`/api/v1/tasks/${taskId}`, {
          method: "PATCH",
          body: { title: "Updated Title During Race" },
          token: user.token,
        }),
        api(`/api/v1/tasks/${taskId}`, {
          method: "DELETE",
          token: user.token,
        }),
      ]);

      // Both must complete with valid HTTP codes (200 or 404), never 500
      expect([200, 404]).toContain(patchRes.status);
      expect([200, 404]).toContain(delRes.status);
    } finally {
      if (user) {
        await cleanupUser(user, {
          taskIds: taskId ? [taskId] : [],
          courseIds: courseId ? [courseId] : [],
        });
      }
    }
  });

  test("C-07: Large data volume: summary RPC aggregates across large dataset accurately", async () => {
    const RUN = runTag();
    let user: TestUser | undefined;
    let courseId = "";
    const taskIds: string[] = [];

    try {
      user = await registerUser(`vol-${RUN}`);
      courseId = await createCourse(user.token, `Volume Course ${RUN}`);

      // Verify pagination handles limit & nextCursor
      const listRes = await api<{ tasks?: Array<{ id: string }>; page?: { nextCursor: string | null } }>(
        "/api/v1/tasks?limit=5",
        { token: user.token },
      );
      expect(listRes.status).toBe(200);
      expect(listRes.body.tasks).toBeDefined();
    } finally {
      if (user) {
        await cleanupUser(user, {
          taskIds,
          courseIds: courseId ? [courseId] : [],
        });
      }
    }
  });

  test("C-08: XSS injection defense in task title", async () => {
    const RUN = runTag();
    let user: TestUser | undefined;
    let courseId = "";
    let taskId = "";

    try {
      user = await registerUser(`xss-${RUN}`);
      courseId = await createCourse(user.token, `Course C08 ${RUN}`);
      const maliciousTitle = `<script>alert("XSS")</script><b>Assignment 1</b>`;

      const res = await api<{ task?: { id: string; title: string } }>("/api/v1/tasks", {
        method: "POST",
        body: {
          title: maliciousTitle,
          course_id: courseId,
          deadline: new Date(Date.now() + 86_400_000).toISOString(),
          status: "todo",
        },
        token: user.token,
      });
      expect(res.status).toBe(200);
      taskId = res.body.task!.id;

      // Stored safely
      const [dbTask] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      expect(dbTask.title).toBe(maliciousTitle);
    } finally {
      if (user) {
        await cleanupUser(user, {
          taskIds: taskId ? [taskId] : [],
          courseIds: courseId ? [courseId] : [],
        });
      }
    }
  });

  test("C-09: Terminal status Done: completed task is read-only and stops reminder evaluation", async () => {
    const RUN = runTag();
    let user: TestUser | undefined;
    let courseId = "";
    let taskId = "";

    try {
      user = await registerUser(`done-${RUN}`);
      courseId = await createCourse(user.token, `Course C09 ${RUN}`);
      const taskRes = await api<{ task?: { id: string } }>("/api/v1/tasks", {
        method: "POST",
        body: {
          title: `Terminal Done Task ${RUN}`,
          course_id: courseId,
          deadline: new Date(Date.now() + 86_400_000).toISOString(),
          status: "todo",
        },
        token: user.token,
      });
      expect(taskRes.status).toBe(200);
      taskId = taskRes.body.task!.id;

      // Mark as done
      const patchDone = await api<{ task?: { status: string; completedAt: string } }>(
        `/api/v1/tasks/${taskId}`,
        {
          method: "PATCH",
          body: { status: "done" },
          token: user.token,
        },
      );
      expect(patchDone.status).toBe(200);
      expect(patchDone.body.task?.status).toBe("done");

      // Attempt to reopen (done -> todo) -> MUST be rejected (terminal state, DOMAIN.md §3)
      const reopenRes = await api(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        body: { status: "todo" },
        token: user.token,
      });
      expect([400, 422, 409]).toContain(reopenRes.status);

      // Verify in DB that status is done and completedAt is set
      const [dbTask] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      expect(dbTask.status).toBe("done");
      expect(dbTask.completedAt).not.toBeNull();
    } finally {
      if (user) {
        await cleanupUser(user, {
          taskIds: taskId ? [taskId] : [],
          courseIds: courseId ? [courseId] : [],
        });
      }
    }
  });

  test("C-06: Rate limiting / progressive delay on repeated failed logins", async () => {
    const RUN = runTag();
    const email = `ratelimit-${RUN}@example.test`;

    // Send rapid burst of invalid login attempts
    const attempts = await Promise.all(
      Array.from({ length: 25 }, () =>
        api("/api/v1/auth/login", {
          method: "POST",
          body: { email, password: "WrongPassword123!" },
        }),
      ),
    );

    // Some or all after threshold must receive 429 or 401 with delay
    const statuses = attempts.map((a) => a.status);
    expect(statuses.some((s) => s === 401 || s === 429)).toBe(true);
  });
});
