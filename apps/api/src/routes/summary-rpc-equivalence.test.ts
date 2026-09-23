process.env.NODE_ENV = "test";

import { afterAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import {
  createDb,
  courses,
  profiles,
  tasks,
} from "@deadline-radar/db";
import {
  summarizeDeadlineBuckets,
  summarizeProgress,
} from "@deadline-radar/domain";

/**
 * P1-summary durability guard (performance-audit-2026-09-20 §P1, checklist
 * §10): `public.get_user_summary` must aggregate exactly like the shared
 * domain summarizers. The mocked route suite (`summary.routes.test.ts`)
 * proves pass-through shape and tz resolution only — its mock re-implements
 * the RPC in JS, so SQL-vs-domain drift would pass silently. This file runs
 * the REAL function on a real PostgreSQL and fails on any drift.
 *
 * Hermetic: the migration file is applied as CREATE OR REPLACE inside a
 * rolled-back transaction? No — DDL + seed + call + assert run as plain
 * statements with random UUIDs, and seeded rows are deleted in `finally`
 * (tasks → courses → profiles). A mid-test assertion failure still cleans
 * up; the CREATE OR REPLACE is additive and identical to what `db:migrate`
 * installs, so leaving the function in place matches migration state.
 *
 * DB resolution mirrors rls-context.test.ts: TEST_DATABASE_URL, else local
 * test_verify_all. Never imports app.ts (mock.module isolation).
 */
function resolveTestDbUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const url = process.env.DATABASE_URL;
  if (
    url &&
    !url.includes("supabase.co") &&
    !url.includes("pooler.supabase.com")
  ) {
    if (
      (url.includes("localhost") || url.includes("127.0.0.1")) &&
      !url.includes("sslmode=")
    ) {
      const sep = url.includes("?") ? "&" : "?";
      return `${url}${sep}sslmode=disable`;
    }
    return url;
  }
  return "postgresql://localhost:5432/test_verify_all?sslmode=disable";
}

const db = createDb(resolveTestDbUrl());

const MIGRATION_PATH = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/20260921010000_summary_rpc.sql",
    import.meta.url,
  ),
);

const NOW = new Date("2026-09-21T12:00:00.000Z");

type RpcResult = {
  summary: {
    today: number;
    tomorrow: number;
    thisWeek: number;
    nextWeek: number;
    thisMonth: number;
    missed: number;
    allTasks: number;
  };
  progress: {
    completed: number;
    total: number;
    onTime: number;
    onTimeTotal: number;
    courses: { name: string; color: string | null; tasks: number }[];
  };
};

async function callRpc(
  userId: string,
  timeZone: string,
): Promise<RpcResult> {
  const rows = (await db.execute(
    sql`select public.get_user_summary(${userId}, ${timeZone}, ${NOW.toISOString()}) as summary`,
  )) as unknown as { summary: RpcResult }[];
  const result = rows[0]?.summary;
  if (!result) throw new Error("get_user_summary returned no row");
  return result;
}

function uid(): string {
  return crypto.randomUUID();
}

describe("get_user_summary RPC ≡ domain summarizers (real DB)", () => {
  afterAll(async () => {
    // createDb holds a pool; release it so bun exits cleanly.
    const inner = db as unknown as { $client?: { end?: () => Promise<void> } };
    await inner.$client?.end?.();
  });

  test("exact equivalence: buckets + progress, tz-aware, tenant-scoped", async () => {
    const userA = uid();
    const userB = uid();
    const tzA = "America/New_York"; // UTC-4 → local 2026-09-21 08:00
    const tzB = "Pacific/Auckland"; // UTC+12 → local 2026-09-22 00:00

    await db.execute(sql.raw(await Bun.file(MIGRATION_PATH).text()));

    // Seed identity rows. profiles.id FKs auth.users(id), and the
    // on_auth_user_created trigger auto-creates the profile row — so insert
    // the user first, then set the timezone on the trigger-made profile.
    // (The RPC takes p_tz directly; profiles exist for the FK chain only.)
    for (const [id, tz] of [
      [userA, tzA],
      [userB, tzB],
    ] as const) {
      await db.execute(
        sql`insert into auth.users (id, email) values (${id}, ${`rpc-${id}@example.com`})`,
      );
      await db.execute(
        sql`update profiles set timezone = ${tz} where id = ${id}`,
      );
    }
    // Raw SQL seeding with ISO strings: drizzle's timestamp mapper demands
    // Date objects, but this driver's param path rejects them — strings
    // serialize cleanly through postgres.js either way.
    async function addCourse(
      owner: string,
      name: string,
      color: string,
    ): Promise<string> {
      const rows = (await db.execute(
        sql`insert into courses (user_id, name, color) values (${owner}, ${name}, ${color}) returning id`,
      )) as unknown as { id: string }[];
      return rows[0].id;
    }
    const mathId = await addCourse(userA, "Math", "#ff0000");
    const physicsId = await addCourse(userA, "Physics", "#00ff00");
    const retiredId = await addCourse(userA, "Retired", "#0000ff");
    // Soft-delete the course: the task survives (FK intact) but the RPC's
    // join misses it → 'Uncategorized', mirroring summarizeProgress input
    // with courseName: null.
    await db.execute(
      sql`update courses set deleted_at = now() where id = ${retiredId}`,
    );
    const kiwiId = await addCourse(userB, "Kiwi", "#123456");

    type Seed = {
      courseId: string;
      title: string;
      deadline: string;
      status: "todo" | "in_progress" | "done";
      completedAt?: string | null;
      deleted?: boolean;
    };
    const seedsA: Seed[] = [
      { courseId: mathId, title: "A1 today", deadline: "2026-09-21T14:00:00Z", status: "todo" },
      { courseId: mathId, title: "A2 tomorrow", deadline: "2026-09-22T14:00:00Z", status: "todo" },
      { courseId: mathId, title: "A3 week-end", deadline: "2026-09-28T14:00:00Z", status: "todo" },
      { courseId: physicsId, title: "A4 next-week", deadline: "2026-09-29T14:00:00Z", status: "todo" },
      { courseId: physicsId, title: "A5 month-end", deadline: "2026-10-21T14:00:00Z", status: "todo" },
      { courseId: physicsId, title: "A6 beyond", deadline: "2026-11-01T00:00:00Z", status: "todo" },
      { courseId: physicsId, title: "A7 overdue", deadline: "2026-09-10T12:00:00Z", status: "todo" },
      { courseId: mathId, title: "A8 done on-time", deadline: "2026-09-20T12:00:00Z", status: "done", completedAt: "2026-09-19T12:00:00Z" },
      { courseId: mathId, title: "A9 done late", deadline: "2026-09-18T12:00:00Z", status: "done", completedAt: "2026-09-19T12:00:00Z" },
      // NOTE: no "done with completed_at = NULL" fixture: the DB CHECK
      // (tasks_completed_at_status_check) makes it unreachable — done ⟺
      // stamped. The JS null-branch stays unit-tested in progress.test.ts.
      { courseId: physicsId, title: "A11 active", deadline: "2026-10-05T12:00:00Z", status: "in_progress" },
      { courseId: physicsId, title: "A12 deleted", deadline: "2026-09-21T14:00:00Z", status: "todo", deleted: true },
      { courseId: retiredId, title: "A13 uncategorized", deadline: "2026-10-05T12:00:00Z", status: "todo" },
    ];
    for (const s of seedsA) {
      const rows = (await db.execute(
        sql`insert into tasks (user_id, course_id, title, deadline, status, completed_at)
            values (${userA}, ${s.courseId}, ${s.title}, ${s.deadline}, ${s.status}, ${s.completedAt ?? null})
            returning id`,
      )) as unknown as { id: string }[];
      if (s.deleted) {
        await db.execute(
          sql`update tasks set deleted_at = now() where id = ${rows[0].id}`,
        );
      }
    }
    // Same instant, other tenant + other timezone: 2026-09-21T13:00Z is
    // 09-21 in UTC but 09-22 in Auckland → today there, and invisible to A.
    await db.execute(
      sql`insert into tasks (user_id, course_id, title, deadline, status)
          values (${userB}, ${kiwiId}, 'B1', '2026-09-21T13:00:00Z', 'todo')`,
    );

    try {
      const [rpcA, rpcB] = await Promise.all([
        callRpc(userA, tzA),
        callRpc(userB, tzB),
      ]);

      // Expected values computed by the canonical JS summarizers over the
      // same fixture rows (deleted rows excluded — neither consumer sees
      // them; retired-course task maps to courseName/courseColor null).
      const jsBucketInput = seedsA
        .filter((s) => !s.deleted)
        .map((s) => ({ deadline: s.deadline, status: s.status }));
      const jsProgressInput = seedsA
        .filter((s) => !s.deleted)
        .map((s) => ({
          status: s.status,
          deadline: s.deadline,
          completedAt: s.completedAt ?? null,
          courseName:
            s.courseId === mathId
              ? "Math"
              : s.courseId === physicsId
                ? "Physics"
                : null,
          courseColor:
            s.courseId === mathId
              ? "#ff0000"
              : s.courseId === physicsId
                ? "#00ff00"
                : null,
        }));
      expect(rpcA.summary).toEqual(
        summarizeDeadlineBuckets(jsBucketInput, tzA, NOW),
      );
      // A11 + A13 (2026-10-05) sit inside the next-week window too.
      expect(rpcA.summary).toEqual({
        today: 1,
        tomorrow: 1,
        thisWeek: 3,
        nextWeek: 3,
        thisMonth: 7,
        missed: 1,
        allTasks: 9,
      });
      expect(rpcA.progress).toEqual(summarizeProgress(jsProgressInput));
      expect(rpcA.progress).toEqual({
        completed: 2,
        total: 11,
        onTime: 1,
        onTimeTotal: 2,
        courses: [
          // Physics: A4, A5, A6, A7, A11. Math: A1, A2, A3.
          { name: "Physics", color: "#00ff00", tasks: 5 },
          { name: "Math", color: "#ff0000", tasks: 3 },
          { name: "Uncategorized", color: null, tasks: 1 },
        ],
      });

      // Tenant B: tz-shifted bucket + strict isolation (A's 12 rows absent).
      expect(rpcB.summary).toEqual({
        today: 1,
        tomorrow: 0,
        thisWeek: 1,
        nextWeek: 0,
        thisMonth: 1,
        missed: 0,
        allTasks: 1,
      });
      expect(rpcB.progress.total).toBe(1);
    } finally {
      await db.execute(
        sql`delete from tasks where user_id in (${userA}, ${userB})`,
      );
      await db.execute(
        sql`delete from courses where user_id in (${userA}, ${userB})`,
      );
      await db.execute(
        sql`delete from profiles where id in (${userA}, ${userB})`,
      );
      await db.execute(
        sql`delete from auth.users where id in (${userA}, ${userB})`,
      );
    }
  }, 120000);

  test("documents the tie-order drift: equal counts break by name ASC in SQL", async () => {
    const user = uid();
    await db.execute(sql.raw(await Bun.file(MIGRATION_PATH).text()));
    await db.execute(
      sql`insert into auth.users (id, email) values (${user}, ${`rpc-tie-${user}@example.com`})`,
    );
    // Insert Beta first: JS summarizeProgress would order Beta before Alpha
    // (stable first-seen). SQL orders ties by course_name ASC → Alpha first.
    // The route serves RPC output, so this pins the contract consumers see.
    for (const name of ["Beta", "Alpha"]) {
      const crows = (await db.execute(
        sql`insert into courses (user_id, name, color) values (${user}, ${name}, '#aaaaaa') returning id`,
      )) as unknown as { id: string }[];
      await db.execute(
        sql`insert into tasks (user_id, course_id, title, deadline, status)
            values (${user}, ${crows[0].id}, ${`${name} task`}, '2026-10-05T12:00:00Z', 'todo')`,
      );
    }
    try {
      const rpc = await callRpc(user, "UTC");
      expect(rpc.progress.courses.map((c) => c.name)).toEqual([
        "Alpha",
        "Beta",
      ]);
    } finally {
      await db.execute(sql`delete from tasks where user_id = ${user}`);
      await db.execute(sql`delete from courses where user_id = ${user}`);
      await db.execute(sql`delete from profiles where id = ${user}`);
      await db.execute(sql`delete from auth.users where id = ${user}`);
    }
  }, 120000);
});
