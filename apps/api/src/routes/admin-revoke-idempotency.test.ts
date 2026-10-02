process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { idempotencyKeys } from "@deadline-radar/db";

import { resetRateLimitBuckets } from "../plugins/rate-limit";
import { setVerifyAccessTokenOverride } from "../lib/auth-tokens";
import {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
} from "../lib/authorization";
import { ADMIN_CAPABILITIES, DOMAIN_CAPABILITIES } from "../lib/authorization/capabilities";
import { hashRequestFingerprint } from "../lib/api";

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PATH = "/api/v1/admin/roles/revoke";
const BODY = { user_id: TARGET, role_slug: "admin" };

type IdemRow = {
  id: string;
  userId: string;
  key: string;
  method: string;
  path: string;
  requestHash: string;
  responseStatus: number | null;
  responseBody: unknown;
  createdAt: Date;
  expiresAt: Date;
};

let idemRow: IdemRow | null = null;
let deleteCalls = 0;
let userRolesDeleteReturns: Array<{ id: string }> = [{ id: "ur-1" }];
let completedStatus: number | undefined;
let completedBody: unknown;

mock.module("../lib/db", () => {
  const db = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => {
        const rows = (): unknown[] => {
          if (table === idempotencyKeys) {
            if (fields !== undefined) return [];
            return idemRow ? [idemRow] : [];
          }
          // roles select for revokeRole
          return [{ id: "role-1", slug: "admin" }];
        };
        const chain: any = {
          where: () => chain,
          orderBy: () => chain,
          limit: async () => rows(),
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(rows()).then(resolve, reject),
        };
        return chain;
      },
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        const builder: any = {
          onConflictDoNothing: () => builder,
          returning: async () => {
            if (table === idempotencyKeys) {
              return [{ id: "idem-1", ...v }];
            }
            return [];
          },
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve([]).then(resolve, reject),
        };
        return builder;
      },
    }),
    update: (table: unknown) => ({
      set: (s: Record<string, unknown>) => ({
        where: async () => {
          if (table === idempotencyKeys) {
            completedStatus = s.responseStatus as number;
            completedBody = s.responseBody;
          }
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => ({
        returning: async () => {
          deleteCalls += 1;
          return userRolesDeleteReturns;
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve),
      }),
    }),
    execute: async () => [],
    transaction: (cb: (tx: unknown) => unknown) => cb(db),
  };
  return { getDb: () => db };
});

mock.module("../lib/auth-audit", () => ({
  recordAuthEvent: async () => undefined,
}));

const { app } = await import("../app");

function revokeRequest(key?: string, body: unknown = BODY) {
  return app.handle(
    new Request(`http://localhost${PATH}`, {
      method: "POST",
      headers: {
        authorization: "Bearer token-admin",
        "content-type": "application/json",
        ...(key ? { "idempotency-key": key } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("I-10A: role revoke idempotency", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    idemRow = null;
    deleteCalls = 0;
    userRolesDeleteReturns = [{ id: "ur-1" }];
    completedStatus = undefined;
    completedBody = undefined;

    setVerifyAccessTokenOverride(async (token) =>
      token === "token-admin"
        ? { id: ADMIN, email: "admin@example.com", sessionId: "sa" }
        : null,
    );
    setLoadAuthorizationContextOverride(async (subject) =>
      createAuthorizationContext({
        subject,
        roles: ["admin"],
        capabilities: [...DOMAIN_CAPABILITIES, ...ADMIN_CAPABILITIES],
      }),
    );
  });

  test("claims the key and completes with the response", async () => {
    const res = await revokeRequest("revoke-key-1");
    expect(res.status).toBe(200);
    expect(deleteCalls).toBe(1);
    expect(completedStatus).toBe(200);
    expect((completedBody as { ok?: boolean }).ok).toBe(true);
  });

  test("revoke twice with same key → replayed success, revokeRole ran once", async () => {
    // First call runs the side effect and stores the response.
    const first = await revokeRequest("revoke-key-replay");
    expect(first.status).toBe(200);
    expect(deleteCalls).toBe(1);

    // Seed the row as completeIdempotent would have stored it.
    const firstBody = await first.json();
    idemRow = {
      id: "idem-1",
      userId: ADMIN,
      key: "revoke-key-replay",
      method: "POST",
      path: PATH,
      requestHash: hashRequestFingerprint("POST", PATH, BODY),
      responseStatus: 200,
      responseBody: firstBody,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    };

    const second = await revokeRequest("revoke-key-replay");
    expect(second.status).toBe(200);
    expect(deleteCalls).toBe(1);
    expect(await second.json()).toEqual(firstBody);
  });

  test("same key + different fingerprint → 409", async () => {
    const storedBody = { ok: true, userId: TARGET, roleSlug: "admin" };
    idemRow = {
      id: "idem-seed",
      userId: ADMIN,
      key: "revoke-key-conflict",
      method: "POST",
      path: PATH,
      requestHash: hashRequestFingerprint("POST", PATH, BODY),
      responseStatus: 200,
      responseBody: storedBody,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    };
    const res = await revokeRequest("revoke-key-conflict", {
      user_id: TARGET,
      role_slug: "user",
    });
    expect(res.status).toBe(409);
    expect(deleteCalls).toBe(0);
  });

  test("first-time not_assigned still errors 404 (no replay row)", async () => {
    userRolesDeleteReturns = [];
    const res = await revokeRequest(undefined);
    expect(res.status).toBe(404);
    expect(deleteCalls).toBe(1);
  });
});
