process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import {
  ADMIN_CAPABILITIES,
  DOMAIN_CAPABILITIES,
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
  setOwnershipOverrides,
  type Capability,
} from "./index";
import {
  resetJwksCache,
  setVerifyAccessTokenClaimsOverride,
  setVerifyAccessTokenOverride,
} from "../auth-tokens";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COURSE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const COURSE_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

let currentCapabilities: Capability[] = [...DOMAIN_CAPABILITIES];
let currentRoles: ("user" | "admin")[] = ["user"];
let attachmentOwner: string | null = null;

mock.module("../auth-audit", () => ({
  recordAuthEvent: async () => undefined,
}));

function thenableRows(rows: unknown[]) {
  const self = {
    from: () => self,
    innerJoin: () => self,
    leftJoin: () => self,
    where: () => self,
    orderBy: () => self,
    limit: async () => rows,
    returning: async () => rows,
    set: () => self,
    values: () => self,
    then: (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  return self;
}

mock.module("../db", () => {
  const dbMethods = {
    select: () => thenableRows([]),
    insert: () => thenableRows([]),
    update: () =>
      thenableRows([
        {
          id: "11111111-2222-4333-8444-555555555555",
          title: "Updated Title Only",
          description: "Preserved description",
          status: "todo",
          deadline: new Date("2026-12-31T00:00:00.000Z"),
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ]),
    delete: () => thenableRows([]),
    // withUserRls GUC setup (P2-3): no-op in the fake.
    execute: async () => [],
  };
  return {
    getDb: () => ({
      ...dbMethods,
      transaction: async (cb: any) => cb(dbMethods),
    }),
  };
});

mock.module("../supabase", () => ({
  createAnonClient: () => ({ auth: {} }),
  createUserClient: () => ({ auth: {} }),
  createServiceClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: { signedUrl: "https://example.com/signed" },
          error: null,
        }),
      }),
    },
  }),
}));

const { resetRateLimitBuckets } = await import("../../plugins/rate-limit");
const { app } = await import("../../app");

describe("authorization routes — adversarial", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    currentRoles = ["user"];
    currentCapabilities = [...DOMAIN_CAPABILITIES];
    attachmentOwner = null;

    setVerifyAccessTokenOverride(async (token) => {
      if (token === "user-a") {
        return { id: USER_A, email: "a@example.com", sessionId: "sa" };
      }
      if (token === "user-b") {
        return { id: USER_B, email: "b@example.com", sessionId: "sb" };
      }
      return null;
    });

    setLoadAuthorizationContextOverride(async (subject) =>
      createAuthorizationContext({
        subject,
        roles: currentRoles,
        capabilities: currentCapabilities,
      }),
    );

    setOwnershipOverrides({
      ownedCourse: async (userId, courseId) => {
        if (userId === USER_A && courseId === COURSE_A) {
          return {
            id: COURSE_A,
            userId: USER_A,
            name: "Owned",
            code: null,
            color: null,
            icon: null,
            description: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          };
        }
        return null;
      },
      ownedAttachmentByStoragePath: async (userId, storagePath) => {
        if (!storagePath.startsWith(`attachments/${userId}/`)) return null;
        if (attachmentOwner !== userId) return null;
        return {
          attachment: {
            id: "att-1",
            storagePath,
            type: "file" as const,
            taskId: "task-1",
            notes: null,
            url: null,
            createdAt: new Date(),
          },
          taskUserId: userId,
        };
      },
    });
  });

  afterEach(() => {
    setVerifyAccessTokenOverride(null);
    setVerifyAccessTokenClaimsOverride(null);
    setLoadAuthorizationContextOverride(null);
    setOwnershipOverrides(null);
  });

  test("unauthenticated domain request is 401", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/courses", { method: "GET" }),
    );
    expect(response.status).toBe(401);
  });

  test("authenticated user can list courses with capability", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/courses", {
        method: "GET",
        headers: { authorization: "Bearer user-a" },
      }),
    );
    expect(response.status).toBe(200);
  });

  test("missing capability yields 403 without leaking internals", async () => {
    currentCapabilities = [];
    const response = await app.handle(
      new Request("http://localhost/api/v1/courses", {
        method: "GET",
        headers: { authorization: "Bearer user-a" },
      }),
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: { message?: string } | string };
    const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
    expect(errMsg).toBe("Forbidden");
    expect(JSON.stringify(body).toLowerCase()).not.toContain("course.view");
  });

  test("cross-user course id returns 404", async () => {
    const response = await app.handle(
      new Request(`http://localhost/api/v1/courses/${COURSE_B}`, {
        method: "GET",
        headers: { authorization: "Bearer user-a" },
      }),
    );
    expect(response.status).toBe(404);
  });

  test("owner can get own course", async () => {
    const response = await app.handle(
      new Request(`http://localhost/api/v1/courses/${COURSE_A}`, {
        method: "GET",
        headers: { authorization: "Bearer user-a" },
      }),
    );
    expect(response.status).toBe(200);
  });

  test("admin endpoints deny non-admin", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/admin/roles/assign", {
        method: "POST",
        headers: {
          authorization: "Bearer user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          user_id: USER_B,
          role_slug: "admin",
        }),
      }),
    );
    expect(response.status).toBe(403);
  });

  test("client role injection does not grant admin", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/admin/roles/assign", {
        method: "POST",
        headers: {
          authorization: "Bearer user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          user_id: USER_A,
          role_slug: "admin",
          role: "admin",
          capabilities: ["role.assign"],
        }),
      }),
    );
    expect(response.status).toBe(403);
  });

  test("admin with capability can view audit", async () => {
    currentRoles = ["user", "admin"];
    currentCapabilities = [...DOMAIN_CAPABILITIES, ...ADMIN_CAPABILITIES];
    const response = await app.handle(
      new Request("http://localhost/api/v1/admin/audit", {
        method: "GET",
        headers: { authorization: "Bearer user-a" },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { events?: unknown[] };
    expect(Array.isArray(body.events)).toBe(true);
  });

  test("signed-url for another user path is 403", async () => {
    const response = await app.handle(
      new Request(
        `http://localhost/api/v1/attachments/signed-url?storage_path=attachments/${USER_B}/task/file.pdf`,
        {
          method: "GET",
          headers: { authorization: "Bearer user-a" },
        },
      ),
    );
    expect(response.status).toBe(403);
  });

  test("signed-url requires owned attachment row", async () => {
    attachmentOwner = null;
    const response = await app.handle(
      new Request(
        `http://localhost/api/v1/attachments/signed-url?storage_path=attachments/${USER_A}/task/file.pdf`,
        {
          method: "GET",
          headers: { authorization: "Bearer user-a" },
        },
      ),
    );
    expect(response.status).toBe(403);
  });

  test("signed-url succeeds for owned attachment", async () => {
    attachmentOwner = USER_A;
    const response = await app.handle(
      new Request(
        `http://localhost/api/v1/attachments/signed-url?storage_path=attachments/${USER_A}/task/file.pdf`,
        {
          method: "GET",
          headers: { authorization: "Bearer user-a" },
        },
      ),
    );
    expect(response.status).toBe(200);
  });

  test("rejects unknown body fields on course create", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/courses", {
        method: "POST",
        headers: {
          authorization: "Bearer user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Math", isAdmin: true }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string };
      requestId: string;
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.requestId).toBeTruthy();
  });

  test("rejects mass-assignment of userId on course create", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/courses", {
        method: "POST",
        headers: {
          authorization: "Bearer user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Math",
          userId: USER_B,
        }),
      }),
    );
    expect(response.status).toBe(400);
  });

  test("rejects oversized pagination limit", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/courses?limit=100000", {
        headers: { authorization: "Bearer user-a" },
      }),
    );
    expect(response.status).toBe(400);
  });

  test("rejects arbitrary task sort fields", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/tasks?sort=drop_table", {
        headers: { authorization: "Bearer user-a" },
      }),
    );
    expect(response.status).toBe(400);
  });

  test("echoes trusted UUID X-Request-Id", async () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const response = await app.handle(
      new Request("http://localhost/api/v1/courses", {
        headers: {
          authorization: "Bearer user-a",
          "x-request-id": id,
        },
      }),
    );
    expect(response.headers.get("X-Request-Id")).toBe(id);
  });

  describe("finding #13 — input boundary consistency", () => {
    const TASK_X = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

    function craftCursor(payload: unknown): string {
      return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    }

    test("crafted cursor with unparseable sort key is 400, not 500", async () => {
      const cursor = craftCursor({ v: 1, k: "not-a-date", id: "abc" });
      const response = await app.handle(
        new Request(
          `http://localhost/api/v1/tasks?cursor=${encodeURIComponent(cursor)}`,
          { headers: { authorization: "Bearer user-a" } },
        ),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        error?: { code?: string } | string;
      };
      const err = body.error;
      expect(typeof err === "string" ? err : err?.code).toBe(
        "VALIDATION_ERROR",
      );
    });

    test("oversized days_before is 400, not a database 500", async () => {
      setOwnershipOverrides({
        ownedTask: async (userId, taskId) =>
          userId === USER_A && taskId === TASK_X
            ? {
                id: TASK_X,
                userId: USER_A,
                courseId: COURSE_A,
                title: "T",
                description: null,
                deadline: new Date("2026-12-31T00:00:00.000Z"),
                status: "todo",
                completedAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                deadlineUpdatedAt: new Date(),
                deletedAt: null,
              }
            : null,
      });
      const response = await app.handle(
        new Request(`http://localhost/api/v1/tasks/${TASK_X}/thresholds`, {
          method: "POST",
          headers: {
            authorization: "Bearer user-a",
            "content-type": "application/json",
          },
          body: JSON.stringify({ days_before: 9999999999 }),
        }),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        error?: { code?: string } | string;
      };
      const err = body.error;
      expect(typeof err === "string" ? err : err?.code).toBe(
        "VALIDATION_ERROR",
      );
    });
  });

  describe("H-2 — task course owner invariant", () => {
    const TASK_A = "11111111-2222-4333-8444-555555555555";

    test("POST /tasks: User A + Course B (unowned course) → rejected (400)", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/v1/tasks", {
          method: "POST",
          headers: {
            authorization: "Bearer user-a",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            title: "Task with B course",
            course_id: COURSE_B,
            status: "todo",
            deadline: new Date("2026-12-31T00:00:00.000Z").toISOString(),
          }),
        }),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      expect(body.error?.code).toBe("VALIDATION_ERROR");
      expect(body.error?.message).toBe("Course not found");
    });

    test("PATCH /tasks/:id: User A + switch course_id to Course B → rejected (400)", async () => {
      const updatedAtDate = new Date("2026-01-01T00:00:00.000Z");
      setOwnershipOverrides({
        ownedTask: async (userId, taskId) =>
          userId === USER_A && taskId === TASK_A
            ? {
                id: TASK_A,
                userId: USER_A,
                courseId: COURSE_A,
                title: "Task A",
                description: null,
                deadline: new Date("2026-12-31T00:00:00.000Z"),
                status: "todo",
                completedAt: null,
                createdAt: new Date(),
                updatedAt: updatedAtDate,
                deadlineUpdatedAt: new Date(),
                deletedAt: null,
              }
            : null,
        ownedCourse: async (userId, courseId) => {
          if (userId === USER_A && courseId === COURSE_A) {
            return {
              id: COURSE_A,
              userId: USER_A,
              name: "Owned",
              code: null,
              color: null,
              icon: null,
              description: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              deletedAt: null,
            };
          }
          return null;
        },
      });

      const response = await app.handle(
        new Request(`http://localhost/api/v1/tasks/${TASK_A}`, {
          method: "PATCH",
          headers: {
            authorization: "Bearer user-a",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            title: "Task A updated",
            course_id: COURSE_B,
            status: "todo",
            deadline: new Date("2026-12-31T00:00:00.000Z").toISOString(),
            updatedAt: updatedAtDate.toISOString(),
          }),
        }),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      expect(body.error?.code).toBe("VALIDATION_ERROR");
      expect(body.error?.message).toBe("Course not found");
    });
  });

  describe("M6-H-1 — Admin role assign/revoke mass assignment policy", () => {
    test("admin can assign role with user_id in payload without getting 400 forbidden mutation key", async () => {
      currentRoles = ["user", "admin"];
      currentCapabilities = [...DOMAIN_CAPABILITIES, ...ADMIN_CAPABILITIES];
      const response = await app.handle(
        new Request("http://localhost/api/v1/admin/roles/assign", {
          method: "POST",
          headers: {
            authorization: "Bearer user-a",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            user_id: USER_B,
            role_slug: "user",
          }),
        }),
      );
      // Either 200 (if role assigned or mock db handles) or validation/conflict, but NOT 400 Forbidden key
      expect(response.status).not.toBe(403);
      if (response.status === 400) {
        const body = (await response.json()) as { error?: { message?: string } };
        expect(body.error?.message).not.toContain("Forbidden");
      }
    });

    test("admin role assign rejects forbidden keys like deletedAt or role_id", async () => {
      currentRoles = ["user", "admin"];
      currentCapabilities = [...DOMAIN_CAPABILITIES, ...ADMIN_CAPABILITIES];
      const response = await app.handle(
        new Request("http://localhost/api/v1/admin/roles/assign", {
          method: "POST",
          headers: {
            authorization: "Bearer user-a",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            user_id: USER_B,
            role_slug: "user",
            deleted_at: "2026-01-01T00:00:00.000Z",
          }),
        }),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: { message?: string } };
      expect(body.error?.message).toContain("Forbidden fields in request body");
    });
  });

  describe("M6-M-1 — Task PATCH partial update", () => {
    const TASK_PATCH_ID = "11111111-2222-4333-8444-555555555555";

    test("PATCH /tasks/:id allows partial payload (e.g. title only) without requiring full fields", async () => {
      const updatedAtDate = new Date("2026-06-01T12:00:00.000Z");
      setOwnershipOverrides({
        ownedTask: async (userId, taskId) =>
          userId === USER_A && taskId === TASK_PATCH_ID
            ? {
                id: TASK_PATCH_ID,
                userId: USER_A,
                courseId: COURSE_A,
                title: "Original Task",
                description: "Preserved description",
                deadline: new Date("2026-12-31T00:00:00.000Z"),
                status: "todo",
                completedAt: null,
                createdAt: new Date(),
                updatedAt: updatedAtDate,
                deadlineUpdatedAt: new Date(),
                deletedAt: null,
              }
            : null,
      });

      const response = await app.handle(
        new Request(`http://localhost/api/v1/tasks/${TASK_PATCH_ID}`, {
          method: "PATCH",
          headers: {
            authorization: "Bearer user-a",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            title: "Updated Title Only",
            updatedAt: updatedAtDate.toISOString(),
          }),
        }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        task?: { title?: string; description?: string };
      };
      expect(body.task?.title).toBe("Updated Title Only");
      expect(body.task?.description).toBe("Preserved description");
    });
  });

  describe("F-3 — capability matrix (roles x resources x verbs)", () => {
    // Every requireAuthz call site gets one row: strip exactly that
    // capability (nothing else) and the route must 403 without naming the
    // capability. requireAuthz runs before body parsing, so rows need no
    // valid bodies — a dropped requireAuthz call would 2xx/400/404 instead
    // of 403 and turn its row red.
    const TASK_X = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const GENERIC_ID = "11111111-2222-4333-8444-555555555555";
    const rows: { capability: Capability; method: string; path: string }[] = [
      { capability: "course.view", method: "GET", path: "/api/v1/courses" },
      { capability: "course.create", method: "POST", path: "/api/v1/courses" },
      {
        capability: "course.update",
        method: "PATCH",
        path: `/api/v1/courses/${COURSE_A}`,
      },
      {
        capability: "course.archive",
        method: "DELETE",
        path: `/api/v1/courses/${COURSE_A}`,
      },
      { capability: "task.view", method: "GET", path: "/api/v1/tasks" },
      { capability: "task.create", method: "POST", path: "/api/v1/tasks" },
      {
        capability: "task.update",
        method: "PATCH",
        path: `/api/v1/tasks/${TASK_X}`,
      },
      {
        capability: "task.archive",
        method: "DELETE",
        path: `/api/v1/tasks/${TASK_X}`,
      },
      {
        capability: "threshold.manage",
        method: "POST",
        path: `/api/v1/tasks/${TASK_X}/thresholds`,
      },
      {
        capability: "attachment.create",
        method: "POST",
        path: "/api/v1/attachments/link",
      },
      {
        capability: "attachment.delete",
        method: "DELETE",
        path: `/api/v1/attachments/${GENERIC_ID}`,
      },
      {
        capability: "attachment.signed-url",
        method: "GET",
        path: `/api/v1/attachments/signed-url?storage_path=attachments/${USER_A}/task/file.pdf`,
      },
      {
        capability: "notification.view",
        method: "GET",
        path: "/api/v1/notifications",
      },
      {
        capability: "notification.mark-read",
        method: "POST",
        path: `/api/v1/notifications/${GENERIC_ID}/read`,
      },
      {
        capability: "profile.view",
        method: "GET",
        path: "/api/v1/auth/session",
      },
      {
        capability: "profile.password.update",
        method: "POST",
        path: "/api/v1/auth/change-password",
      },
      {
        capability: "profile.email.update",
        method: "POST",
        path: "/api/v1/auth/change-email",
      },
      {
        capability: "profile.timezone.update",
        method: "PATCH",
        path: "/api/v1/auth/timezone",
      },
      {
        capability: "profile.time-format.update",
        method: "PATCH",
        path: "/api/v1/auth/time-format",
      },
      {
        capability: "role.assign",
        method: "POST",
        path: "/api/v1/admin/roles/assign",
      },
      {
        capability: "role.revoke",
        method: "POST",
        path: "/api/v1/admin/roles/revoke",
      },
      { capability: "audit.view", method: "GET", path: "/api/v1/admin/audit" },
    ];

    for (const row of rows) {
      test(`missing ${row.capability} on ${row.method} ${row.path} → 403`, async () => {
        currentCapabilities = (
          [...DOMAIN_CAPABILITIES, ...ADMIN_CAPABILITIES] as Capability[]
        ).filter((c) => c !== row.capability);
        const response = await app.handle(
          new Request(`http://localhost${row.path}`, {
            method: row.method,
            headers: { authorization: "Bearer user-a" },
          }),
        );
        expect(response.status).toBe(403);
        const body = (await response.json()) as {
          error?: { message?: string } | string;
        };
        const errMsg =
          typeof body.error === "string" ? body.error : body.error?.message;
        expect(errMsg).toBe("Forbidden");
        expect(JSON.stringify(body).toLowerCase()).not.toContain(
          row.capability,
        );
      });
    }

    test("non-admin role.revoke → 403 (mirror of role.assign)", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/v1/admin/roles/revoke", {
          method: "POST",
          headers: {
            authorization: "Bearer user-a",
            "content-type": "application/json",
          },
          body: JSON.stringify({ user_id: USER_B, role_slug: "user" }),
        }),
      );
      expect(response.status).toBe(403);
    });

    test("non-admin audit.view → 403 (mirror of role.assign)", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/v1/admin/audit", {
          method: "GET",
          headers: { authorization: "Bearer user-a" },
        }),
      );
      expect(response.status).toBe(403);
    });

    test("admin role.revoke with capability is not 403 (positive control)", async () => {
      currentRoles = ["user", "admin"];
      currentCapabilities = [...DOMAIN_CAPABILITIES, ...ADMIN_CAPABILITIES];
      const response = await app.handle(
        new Request("http://localhost/api/v1/admin/roles/revoke", {
          method: "POST",
          headers: {
            authorization: "Bearer user-a",
            "content-type": "application/json",
          },
          body: JSON.stringify({ user_id: USER_B, role_slug: "user" }),
        }),
      );
      // Mocked stores decide 200/404/400 — but never 403 for a capability holder.
      expect(response.status).not.toBe(403);
    });

    test("task.create holder is not 403 (positive control)", async () => {
      const response = await app.handle(
        new Request("http://localhost/api/v1/tasks", {
          method: "POST",
          headers: {
            authorization: "Bearer user-a",
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        }),
      );
      expect(response.status).not.toBe(403);
    });
  });

  describe("F-3 — route-level JWT edges (real verification, no overrides)", () => {
    const SECRET = "test-only-jwt-secret-32-chars-min!!";
    const ISSUER_BASE = "http://127.0.0.1:54321";
    let issuer = "";
    let savedSupabaseUrl: string | undefined;
    let savedJwtSecret: string | undefined;

    beforeEach(async () => {
      // Force-set (not ??=): task runners like nx load the repo .env.local,
      // whose real SUPABASE_JWT_SECRET would otherwise be kept here while
      // hs256Bearer signs with SECRET below — a guaranteed 401. Restored in
      // afterEach so no other suite observes the test secret.
      savedSupabaseUrl = process.env.SUPABASE_URL;
      savedJwtSecret = process.env.SUPABASE_JWT_SECRET;
      process.env.SUPABASE_URL = ISSUER_BASE;
      process.env.SUPABASE_JWT_SECRET = SECRET;
      const { resolveSupabaseUrl } = await import("../../env");
      issuer = `${resolveSupabaseUrl().replace(/\/$/, "")}/auth/v1`;
      // Drop the outer-suite identity stubs: these tests exercise the real
      // JWKS→HS256 path (JWKS refused fast locally, HS256 fallback verifies).
      setVerifyAccessTokenOverride(null);
      setVerifyAccessTokenClaimsOverride(null);
      resetJwksCache();
    });

    async function hs256Bearer(
      payload: Record<string, unknown>,
      opts: {
        issuer?: string;
        audience?: string;
        expired?: boolean;
      } = {},
    ): Promise<string> {
      const { SignJWT } = await import("jose");
      const now = Math.floor(Date.now() / 1000);
      const jwt = new SignJWT(payload)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(opts.issuer ?? issuer)
        .setIssuedAt(now - 60);
      if (opts.audience !== undefined) {
        jwt.setAudience(opts.audience);
      } else {
        jwt.setAudience("authenticated");
      }
      jwt.setExpirationTime(opts.expired ? now - 60 : now + 600);
      return `Bearer ${await jwt.sign(new TextEncoder().encode(SECRET))}`;
    }

    async function getCourses(auth: string | null) {
      return app.handle(
        new Request("http://localhost/api/v1/courses", {
          method: "GET",
          headers: auth ? { authorization: auth } : {},
        }),
      );
    }

    test("expired bearer on GET /courses → 401", async () => {
      const auth = await hs256Bearer({ sub: USER_A }, { expired: true });
      const response = await getCourses(auth);
      expect(response.status).toBe(401);
    });

    test("wrong audience bearer on GET /courses → 401", async () => {
      const auth = await hs256Bearer({ sub: USER_A }, { audience: "anon" });
      const response = await getCourses(auth);
      expect(response.status).toBe(401);
    });

    test("wrong issuer bearer on GET /courses → 401", async () => {
      const auth = await hs256Bearer(
        { sub: USER_A },
        { issuer: "http://evil.example/auth/v1" },
      );
      const response = await getCourses(auth);
      expect(response.status).toBe(401);
    });

    test("alg:none bearer on GET /courses → 401", async () => {
      const { UnsecuredJWT } = await import("jose");
      const token = new UnsecuredJWT({ sub: USER_A })
        .setIssuer(issuer)
        .setAudience("authenticated")
        .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
        .encode();
      const response = await getCourses(`Bearer ${token}`);
      expect(response.status).toBe(401);
    });

    test("garbage bearer on GET /courses → 401", async () => {
      const response = await getCourses("Bearer not-a-jwt");
      expect(response.status).toBe(401);
    });

    test("valid HS256 bearer on GET /courses → 200 (real path succeeds)", async () => {
      const auth = await hs256Bearer({ sub: USER_A });
      const response = await getCourses(auth);
      expect(response.status).toBe(200);
    });

    afterEach(() => {
      if (savedSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = savedSupabaseUrl;
      if (savedJwtSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
      else process.env.SUPABASE_JWT_SECRET = savedJwtSecret;
    });
  });
});
