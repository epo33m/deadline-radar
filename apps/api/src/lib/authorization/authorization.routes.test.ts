import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import {
  ADMIN_CAPABILITIES,
  DOMAIN_CAPABILITIES,
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
  setOwnershipOverrides,
  type Capability,
} from "./index";
import { setVerifyAccessTokenOverride } from "../auth-tokens";

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

mock.module("../db", () => ({
  getDb: () => ({
    select: () => thenableRows([]),
    insert: () => thenableRows([]),
    update: () => thenableRows([]),
    delete: () => thenableRows([]),
  }),
}));

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
            createdAt: new Date(),
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
            name: "f.pdf",
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
    setLoadAuthorizationContextOverride(null);
    setOwnershipOverrides(null);
  });

  test("unauthenticated domain request is 401", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/courses", { method: "GET" }),
    );
    expect(response.status).toBe(401);
  });

  test("authenticated user can list courses with capability", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/courses", {
        method: "GET",
        headers: { authorization: "Bearer user-a" },
      }),
    );
    expect(response.status).toBe(200);
  });

  test("missing capability yields 403 without leaking internals", async () => {
    currentCapabilities = [];
    const response = await app.handle(
      new Request("http://localhost/api/courses", {
        method: "GET",
        headers: { authorization: "Bearer user-a" },
      }),
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("Forbidden");
    expect(JSON.stringify(body).toLowerCase()).not.toContain("course.view");
  });

  test("cross-user course id returns 404", async () => {
    const response = await app.handle(
      new Request(`http://localhost/api/courses/${COURSE_B}`, {
        method: "GET",
        headers: { authorization: "Bearer user-a" },
      }),
    );
    expect(response.status).toBe(404);
  });

  test("owner can get own course", async () => {
    const response = await app.handle(
      new Request(`http://localhost/api/courses/${COURSE_A}`, {
        method: "GET",
        headers: { authorization: "Bearer user-a" },
      }),
    );
    expect(response.status).toBe(200);
  });

  test("admin endpoints deny non-admin", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/admin/roles/assign", {
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
      new Request("http://localhost/api/admin/roles/assign", {
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
      new Request("http://localhost/api/admin/audit", {
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
        `http://localhost/api/attachments/signed-url?storage_path=attachments/${USER_B}/task/file.pdf`,
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
        `http://localhost/api/attachments/signed-url?storage_path=attachments/${USER_A}/task/file.pdf`,
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
        `http://localhost/api/attachments/signed-url?storage_path=attachments/${USER_A}/task/file.pdf`,
        {
          method: "GET",
          headers: { authorization: "Bearer user-a" },
        },
      ),
    );
    expect(response.status).toBe(200);
  });
});
