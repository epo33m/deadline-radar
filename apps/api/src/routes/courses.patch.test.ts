process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { beforeEach, describe, expect, mock, test } from "bun:test";

import { setVerifyAccessTokenOverride } from "../lib/auth-tokens";
import {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
  setOwnershipOverrides,
  type Capability,
} from "../lib/authorization";
import { DOMAIN_CAPABILITIES } from "../lib/authorization/capabilities";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COURSE_A = "11111111-1111-4111-8111-111111111111";
const COURSE_B = "22222222-2222-4222-8222-222222222222";

type RecordedSet = Record<string, unknown>;
const recordedSets: RecordedSet[] = [];

mock.module("../lib/db", () => ({
  getDb: () => {
    const rows = [
      {
        id: COURSE_A,
        userId: USER_A,
        name: "Original Name",
        code: "CS101",
        color: "#ff0000",
        icon: "book",
        description: "Original Description",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        deletedAt: null,
      },
    ];
    const chain = {
      select: () => chain,
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: async () => rows,
      update: () => chain,
      set: (updates: Record<string, unknown>) => {
        recordedSets.push(updates);
        return chain;
      },
      returning: () => chain,
      // withUserRls single-tx handlers (P2-3): GUC setup is a no-op here;
      // the tx reuses this chain so query behavior is unchanged.
      execute: async () => [],
      transaction: (cb: (tx: unknown) => unknown) => cb(chain),
      then: (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise.resolve(rows).then(resolve, reject),
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

const { resetRateLimitBuckets } = await import("../plugins/rate-limit");
const { app } = await import("../app");

describe("PATCH /api/v1/courses/:id partial update semantics", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    recordedSets.length = 0;
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
        roles: ["user"],
        capabilities: [...DOMAIN_CAPABILITIES] as Capability[],
      }),
    );

    setOwnershipOverrides({
      ownedCourse: async (userId, courseId) => {
        if (userId === USER_A && courseId === COURSE_A) {
          return {
            id: COURSE_A,
            userId: USER_A,
            name: "Original Name",
            code: "CS101",
            color: "#ff0000",
            icon: "book",
            description: "Original Description",
            createdAt: new Date("2026-01-01T00:00:00Z"),
            updatedAt: new Date("2026-01-01T00:00:00Z"),
            deletedAt: null,
          };
        }
        return null;
      },
    });
  });

  test("PATCH only name: updates name, leaves code/color/icon/description untouched in DB set", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/courses/${COURSE_A}`, {
        method: "PATCH",
        headers: {
          authorization: "Bearer user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Updated Name" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(recordedSets.length).toBe(1);
    const setObj = recordedSets[0];
    expect(setObj.name).toBe("Updated Name");
    expect(setObj.code).toBeUndefined();
    expect(setObj.color).toBeUndefined();
    expect(setObj.icon).toBeUndefined();
    expect(setObj.description).toBeUndefined();
    expect(setObj.updatedAt).toBeInstanceOf(Date);
  });

  test("PATCH only description: succeeds without name, leaving name and other fields untouched in DB set", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/courses/${COURSE_A}`, {
        method: "PATCH",
        headers: {
          authorization: "Bearer user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({ description: "New Course Description" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(recordedSets.length).toBe(1);
    const setObj = recordedSets[0];
    expect(setObj.description).toBe("New Course Description");
    expect(setObj.name).toBeUndefined();
    expect(setObj.code).toBeUndefined();
    expect(setObj.color).toBeUndefined();
    expect(setObj.icon).toBeUndefined();
  });

  test("PATCH only color", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/courses/${COURSE_A}`, {
        method: "PATCH",
        headers: {
          authorization: "Bearer user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({ color: "0066cc" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(recordedSets.length).toBe(1);
    const setObj = recordedSets[0];
    expect(setObj.color).toBe("#0066cc");
    expect(setObj.name).toBeUndefined();
    expect(setObj.description).toBeUndefined();
  });

  test("PATCH only icon", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/courses/${COURSE_A}`, {
        method: "PATCH",
        headers: {
          authorization: "Bearer user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({ icon: "Book-Open" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(recordedSets.length).toBe(1);
    const setObj = recordedSets[0];
    expect(setObj.icon).toBe("book-open");
    expect(setObj.name).toBeUndefined();
  });

  test("Explicit null sets target fields to null while preserving omitted fields", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/courses/${COURSE_A}`, {
        method: "PATCH",
        headers: {
          authorization: "Bearer user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({ description: null, code: null }),
      }),
    );

    expect(res.status).toBe(200);
    expect(recordedSets.length).toBe(1);
    const setObj = recordedSets[0];
    expect(setObj.description).toBeNull();
    expect(setObj.code).toBeNull();
    expect(setObj.name).toBeUndefined();
    expect(setObj.color).toBeUndefined();
    expect(setObj.icon).toBeUndefined();
  });

  test("Empty object {} PATCH returns 400 Bad Request", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/courses/${COURSE_A}`, {
        method: "PATCH",
        headers: {
          authorization: "Bearer user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(400);
    expect(recordedSets.length).toBe(0);
    const emptyBody = (await res.json()) as {
      error?: { code?: string };
      requestId?: string;
    };
    expect(emptyBody.error?.code).toBe("VALIDATION_ERROR");
    expect(emptyBody.requestId).toBeTruthy();
  });

  test("Invalid name values (empty string or explicit null) return 400 Bad Request", async () => {
    const emptyRes = await app.handle(
      new Request(`http://localhost/api/v1/courses/${COURSE_A}`, {
        method: "PATCH",
        headers: {
          authorization: "Bearer user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "" }),
      }),
    );
    expect(emptyRes.status).toBe(400);
    const emptyBody = (await emptyRes.json()) as {
      error?: { code?: string };
      requestId?: string;
    };
    expect(emptyBody.error?.code).toBe("VALIDATION_ERROR");
    expect(emptyBody.requestId).toBeTruthy();

    const nullRes = await app.handle(
      new Request(`http://localhost/api/v1/courses/${COURSE_A}`, {
        method: "PATCH",
        headers: {
          authorization: "Bearer user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: null }),
      }),
    );
    expect(nullRes.status).toBe(400);
    const nullBody = (await nullRes.json()) as {
      error?: { code?: string };
      requestId?: string;
    };
    expect(nullBody.error?.code).toBe("VALIDATION_ERROR");
    expect(nullBody.requestId).toBeTruthy();
  });

  test("Cross-user PATCH is denied with 404", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/courses/${COURSE_B}`, {
        method: "PATCH",
        headers: {
          authorization: "Bearer user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Hacked Course" }),
      }),
    );

    expect(res.status).toBe(404);
    expect(recordedSets.length).toBe(0);
  });

  test("Stale updatedAt returns 409 Conflict", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/courses/${COURSE_A}`, {
        method: "PATCH",
        headers: {
          authorization: "Bearer user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Stale Edit",
          updatedAt: "2020-01-01T00:00:00.000Z",
        }),
      }),
    );

    expect(res.status).toBe(409);
    expect(recordedSets.length).toBe(0);
  });

  test("Full object PATCH from web client updates all fields successfully", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/v1/courses/${COURSE_A}`, {
        method: "PATCH",
        headers: {
          authorization: "Bearer user-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Full Name",
          code: "CS999",
          color: "#123456",
          icon: "star",
          description: "Full Desc",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(recordedSets.length).toBe(1);
    const setObj = recordedSets[0];
    expect(setObj.name).toBe("Full Name");
    expect(setObj.code).toBe("CS999");
    expect(setObj.color).toBe("#123456");
    expect(setObj.icon).toBe("star");
    expect(setObj.description).toBe("Full Desc");
  });
});
