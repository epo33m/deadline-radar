/**
 * #66 — deadline wall-clock must survive save/reload independent of server TZ.
 *
 * Type: HTTP integration (real Elysia API over HTTP, real Supabase Postgres).
 * This is NOT a browser E2E: no Chromium, no Server Action, no DOM.
 * The browser-side wall -> instant conversion (`zonedWallToIso`) is covered
 * by unit tests in `apps/web/lib/datetime.test.ts`; this spec locks in the
 * server-side contract that conversion relies on:
 *   - offset-aware instants round-trip byte-identical (POST -> GET -> PATCH -> GET)
 *   - offset-naive wall strings are rejected fail-closed, never silently shifted
 *
 * Serial by design (playwright.config.ts: workers: 1).
 */
import { expect, test } from "@playwright/test";
import {
  api,
  cleanupUser,
  createCourse,
  registerUser,
  runTag,
  type TestUser,
} from "../fixtures";

const RUN = runTag();

let user: TestUser;
let courseId = "";
const taskIds: string[] = [];

test.beforeAll(async () => {
  user = await registerUser("deadlinetz");
  courseId = await createCourse(user.token, `E2E Deadline TZ Course ${RUN}`);
});

test.afterAll(async () => {
  await cleanupUser(user, { taskIds, courseIds: [courseId] }).catch(
    (error) => {
      console.error("deadline-tz cleanup failed:", String(error));
    },
  );
});

type TaskBody = { task?: { id?: string; deadline?: string } };

async function postTask(deadline: string) {
  const res = await api<TaskBody>("/api/v1/tasks", {
    method: "POST",
    body: {
      title: `E2E deadline TZ ${RUN}`,
      course_id: courseId,
      deadline,
      status: "todo",
    },
    token: user.token,
  });
  if (res.body.task?.id) taskIds.push(res.body.task.id);
  return res;
}

async function getDeadline(taskId: string): Promise<string | undefined> {
  const res = await api<TaskBody>(`/api/v1/tasks/${taskId}`, {
    token: user.token,
  });
  expect(res.status).toBe(200);
  return res.body.task?.deadline;
}

test("TZ-01 — offset-aware +08:00 persists as the correct UTC instant", async () => {
  // 07:30 in Asia/Makassar (UTC+8) == 23:30Z on the previous day.
  const res = await postTask("2026-09-30T07:30:00+08:00");
  expect(res.status).toBe(200);
  expect(res.body.task?.deadline).toBe("2026-09-29T23:30:00.000Z");

  const reloaded = await getDeadline(res.body.task!.id!);
  expect(reloaded).toBe("2026-09-29T23:30:00.000Z");
});

test("TZ-02 — Zulu instant round-trips byte-identical", async () => {
  const res = await postTask("2026-09-30T07:30:00.000Z");
  expect(res.status).toBe(200);
  expect(res.body.task?.deadline).toBe("2026-09-30T07:30:00.000Z");
  expect(await getDeadline(res.body.task!.id!)).toBe(
    "2026-09-30T07:30:00.000Z",
  );
});

test("TZ-03 — PATCH (edit-save-reload) preserves the wall-clock", async () => {
  const created = await postTask("2026-09-30T07:30:00+08:00");
  expect(created.status).toBe(200);
  const id = created.body.task!.id!;

  const patched = await api<TaskBody>(`/api/v1/tasks/${id}`, {
    method: "PATCH",
    body: { deadline: "2026-09-30T22:30:00+08:00" },
    token: user.token,
  });
  expect(patched.status).toBe(200);
  expect(patched.body.task?.deadline).toBe("2026-09-30T14:30:00.000Z");
  expect(await getDeadline(id)).toBe("2026-09-30T14:30:00.000Z");
});

test("TZ-04 — offset-naive wall strings are rejected, never shifted", async () => {
  const before = taskIds.length;
  const res = await postTask("2026-09-30T07:30");
  expect(res.status).toBe(400);
  // Rejected before insert: no task row was created for it (postTask only
  // tracks ids from successful responses).
  expect(taskIds.length).toBe(before);

  const created = await postTask("2026-09-30T07:30:00.000Z");
  expect(created.status).toBe(200);
  const patched = await api(`/api/v1/tasks/${created.body.task!.id}`, {
    method: "PATCH",
    body: { deadline: "2026-09-30T07:30" },
    token: user.token,
  });
  expect(patched.status).toBe(400);
  // The stored instant is untouched by the rejected patch.
  expect(await getDeadline(created.body.task!.id!)).toBe(
    "2026-09-30T07:30:00.000Z",
  );
});

test("TZ-05 — midnight boundaries keep their date in the profile TZ", async () => {
  const midnight = await postTask("2026-09-30T00:00:00+08:00");
  expect(midnight.status).toBe(200);
  expect(midnight.body.task?.deadline).toBe("2026-09-29T16:00:00.000Z");

  const lastMinute = await postTask("2026-09-30T23:59:00+08:00");
  expect(lastMinute.status).toBe(200);
  expect(lastMinute.body.task?.deadline).toBe("2026-09-30T15:59:00.000Z");
});
