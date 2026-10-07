/**
 * Attachment upload and deletion tests:
 * - Finding #5: upload orphan cleanup + idempotency fingerprint strength.
 * - F-01: Storage delete failure handling (HTTP 502 + DEPENDENCY_FAILURE, no DB delete).
 * - F-03: Unique storage key per attachment (4 segments, duplicate filename safety).
 */
process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  attachmentObjectKey,
  buildAttachmentStoragePath,
} from "@deadline-radar/validation";
import { attachments, idempotencyKeys } from "@deadline-radar/db";

import {
  createAuthorizationContext,
  setLoadAuthorizationContextOverride,
  setOwnershipOverrides,
  type Capability,
} from "../lib/authorization";
import { setVerifyAccessTokenOverride } from "../lib/auth-tokens";
import { hashRequestFingerprint } from "../lib/api/idempotency";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const TASK_ROW = {
  id: TASK_A,
  userId: USER_A,
  courseId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  title: "Task",
  description: null,
  deadline: new Date("2026-10-01T00:00:00Z"),
  status: "todo" as const,
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deadlineUpdatedAt: new Date(),
  deletedAt: null,
};

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------
type IdemRecord = {
  userId: string;
  key: string;
  method: string;
  path: string;
  requestHash: string;
  expiresAt: Date;
  responseStatus: number | null;
  responseBody: unknown;
};

type AttachmentRecord = {
  id: string;
  taskId: string;
  type: "file" | "link";
  notes: string | null;
  storagePath: string | null;
  url: string | null;
  createdAt: Date;
};

const idemStore = new Map<string, IdemRecord>();
const attachmentsStore = new Map<string, AttachmentRecord>();
let attachmentsInsertMode: "ok" | "fail" = "ok";
// I-03: "fail" throws on delete (DB failure); "empty" returns zero rows
// (ownership changed between lookup and delete — the IN-subquery race).
let attachmentsDeleteMode: "ok" | "fail" | "empty" = "ok";
let deleteExecutionCount = 0;
const storageCalls: Array<{ op: "upload" | "remove"; key: string }> = [];
let uploadMode: "ok" | "fail" = "ok";
let removeMode: "ok" | "fail" = "ok";

import { Param, SQL } from "drizzle-orm";

function extractIdFromWhere(where: unknown, seen = new Set<unknown>()): string | null {
  if (where === null || where === undefined) return null;
  if (typeof where === "string") {
    if (attachmentsStore.has(where)) return where;
    return null;
  }
  if (typeof where !== "object") return null;
  if (seen.has(where)) return null;
  seen.add(where);
  if (where instanceof SQL) {
    for (const chunk of where.queryChunks) {
      const found = extractIdFromWhere(chunk, seen);
      if (found) return found;
    }
  }
  if (where instanceof Param) {
    if (typeof where.value === "string" && attachmentsStore.has(where.value)) {
      return where.value;
    }
  }
  for (const key of Object.keys(where)) {
    try {
      const found = extractIdFromWhere((where as Record<string, unknown>)[key], seen);
      if (found) return found;
    } catch {
      // ignore
    }
  }
  return null;
}

function chain(op: "select" | "insert" | "update" | "delete", table?: unknown) {
  const state: { values?: unknown; set?: Record<string, unknown>; where?: unknown } = {};
  const self = {
    from: () => self,
    set: (v: Record<string, unknown>) => {
      state.set = v;
      return self;
    },
    values: (v: unknown) => {
      state.values = v;
      return self;
    },
    where: (w?: unknown) => {
      state.where = w;
      return self;
    },
    onConflictDoNothing: () => self,
    limit: async () => {
      if (op === "select") return [...idemStore.values()];
      return [];
    },
    returning: async () => {
      if (op === "insert" && table === idempotencyKeys) {
        const v = state.values as IdemRecord;
        if (idemStore.has(`${v.userId}:${v.key}`)) return [];
        idemStore.set(`${v.userId}:${v.key}`, {
          ...v,
          responseStatus: null,
          responseBody: null,
        });
        return [idemStore.get(`${v.userId}:${v.key}`)];
      }
      if (op === "insert" && table === attachments) {
        if (attachmentsInsertMode === "fail") throw new Error("db insert failed");
        const val = (state.values ?? {}) as Record<string, unknown>;
        const id = (val.id as string) ?? crypto.randomUUID();
        const row: AttachmentRecord = {
          id,
          taskId: (val.taskId as string) ?? TASK_A,
          type: (val.type as "file" | "link") ?? "file",
          notes: (val.notes as string | null) ?? null,
          storagePath: (val.storagePath as string | null) ?? null,
          url: (val.url as string | null) ?? null,
          createdAt: new Date(),
        };
        attachmentsStore.set(id, row);
        return [row];
      }
      if (op === "delete" && table === idempotencyKeys) {
        // #136: release drops our own uncompleted claim.
        for (const [mapKey, record] of [...idemStore]) {
          if (record.responseStatus == null) idemStore.delete(mapKey);
        }
        return [];
      }
      if (op === "delete") {
        deleteExecutionCount++;
        if (attachmentsDeleteMode === "fail") throw new Error("db delete failed");
        if (attachmentsDeleteMode === "empty") return [];
        const id = extractIdFromWhere(state.where);
        if (id) {
          attachmentsStore.delete(id);
          return [{ id }];
        }
        return [{ id: "deleted-id" }];
      }
      return [];
    },
    then: (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => {
      const run = async (): Promise<unknown> => {
        if (op === "insert" && table === idempotencyKeys) {
          const v = state.values as IdemRecord;
          idemStore.set(`${v.userId}:${v.key}`, {
            ...v,
            responseStatus: null,
            responseBody: null,
          });
          return [];
        }
        if (op === "update" && table === idempotencyKeys) {
          for (const record of idemStore.values()) {
            record.responseStatus = state.set?.["responseStatus"] as number;
            record.responseBody = state.set?.["responseBody"];
          }
          return [];
        }
        if (op === "insert" && table === attachments) {
          if (attachmentsInsertMode === "fail") {
            throw new Error("db insert failed");
          }
          const val = (state.values ?? {}) as Record<string, unknown>;
          const id = (val.id as string) ?? crypto.randomUUID();
          const row: AttachmentRecord = {
            id,
            taskId: (val.taskId as string) ?? TASK_A,
            type: (val.type as "file" | "link") ?? "file",
            notes: (val.notes as string | null) ?? null,
            storagePath: (val.storagePath as string | null) ?? null,
            url: (val.url as string | null) ?? null,
            createdAt: new Date(),
          };
          attachmentsStore.set(id, row);
          return [row];
        }
        if (op === "delete" && table === idempotencyKeys) {
          for (const [mapKey, record] of [...idemStore]) {
            if (record.responseStatus == null) idemStore.delete(mapKey);
          }
          return [];
        }
        if (op === "delete") {
          deleteExecutionCount++;
          if (attachmentsDeleteMode === "fail") throw new Error("db delete failed");
          if (attachmentsDeleteMode === "empty") return [];
          const id = extractIdFromWhere(state.where);
          if (id) {
            attachmentsStore.delete(id);
            return [{ id }];
          }
          return [{ id: "deleted-id" }];
        }
        if (op === "select") return [...idemStore.values()];
        return [];
      };
      return run().then(resolve, reject);
    },
  };
  return self;
}

mock.module("../lib/auth-audit", () => ({
  recordAuthEvent: async () => undefined,
}));

mock.module("../lib/db", () => ({
  getDb: () => {
    const db = {
      select: () => chain("select"),
      insert: (table: unknown) => chain("insert", table),
      update: (table: unknown) => chain("update", table),
      delete: (table: unknown) => chain("delete", table),
      // withUserRls single-tx handlers (P2-3): GUC setup is a no-op here.
      execute: async () => [],
      transaction: (cb: (tx: unknown) => unknown) => cb(db),
    };
    return db;
  },
}));

mock.module("../lib/supabase", () => ({
  createAnonClient: () => ({ auth: {} }),
  createUserClient: () => ({ auth: {} }),
  createServiceClient: () => ({
    storage: {
      from: () => ({
        upload: async (key: string) => {
          storageCalls.push({ op: "upload", key });
          if (uploadMode === "fail") return { data: null, error: { message: "boom" } };
          return { data: { path: key }, error: null };
        },
        remove: async (keys: string[]) => {
          for (const key of keys) storageCalls.push({ op: "remove", key });
          if (removeMode === "fail") return { data: null, error: { message: "delete boom" } };
          return { data: [], error: null };
        },
        createSignedUrl: async () => ({ data: { signedUrl: "https://example.com/signed" }, error: null }),
      }),
    },
  }),
}));

const { resetRateLimitBuckets } = await import("../plugins/rate-limit");
const { app } = await import("../app");

function authed(
  capabilities: Capability[] = [
    "attachment.create",
    "attachment.delete",
    "attachment.signed-url",
  ],
) {
  setVerifyAccessTokenOverride(async (token) => {
    if (token === "user-b") {
      return {
        id: USER_B,
        email: "b@example.com",
        sessionId: "sb",
      };
    }
    return {
      id: USER_A,
      email: "a@example.com",
      sessionId: "sa",
    };
  });
  setLoadAuthorizationContextOverride(async (subject) =>
    createAuthorizationContext({ subject, roles: ["user"], capabilities }),
  );
  setOwnershipOverrides({
    ownedTask: async (userId, taskId) =>
      userId === USER_A && taskId === TASK_A ? { ...TASK_ROW } : null,
    ownedAttachment: async (userId, attachmentId) => {
      const att = attachmentsStore.get(attachmentId);
      if (att && userId === USER_A && att.taskId === TASK_A) {
        return { attachment: att, taskUserId: USER_A };
      }
      return null;
    },
    ownedAttachmentByStoragePath: async (userId, storagePath) => {
      for (const att of attachmentsStore.values()) {
        if (att.storagePath === storagePath && userId === USER_A) {
          return { attachment: att, taskUserId: USER_A };
        }
      }
      return null;
    },
  });
}

function uploadRequest(
  content: string | Uint8Array,
  opts: {
    filename?: string;
    key?: string;
    taskId?: string;
    token?: string;
    type?: string;
    notes?: string;
  } = {},
) {
  const form = new FormData();
  form.set("task_id", opts.taskId ?? TASK_A);
  if (opts.notes !== undefined) form.set("notes", opts.notes);
  form.set(
    "file",
    new File([content], opts.filename ?? "doc.pdf", {
      type: opts.type ?? "application/pdf",
    }),
  );
  const headers: Record<string, string> = {
    authorization: `Bearer ${opts.token ?? "user-a"}`,
  };
  if (opts.key) headers["idempotency-key"] = opts.key;
  return app.handle(
    new Request("http://localhost/api/v1/attachments/file", {
      method: "POST",
      headers,
      body: form,
    }),
  );
}

function deleteRequest(attachmentId: string, token: string = "user-a") {
  return app.handle(
    new Request(`http://localhost/api/v1/attachments/${attachmentId}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${token}`,
      },
    }),
  );
}

function linkRequest(
  body: Record<string, unknown>,
  token: string = "user-a",
  key?: string,
) {
  return app.handle(
    new Request("http://localhost/api/v1/attachments/link", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(key ? { "idempotency-key": key } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("finding #5 — upload orphan cleanup", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    idemStore.clear();
    attachmentsStore.clear();
    storageCalls.length = 0;
    deleteExecutionCount = 0;
    attachmentsInsertMode = "ok";
    attachmentsDeleteMode = "ok";
    uploadMode = "ok";
    removeMode = "ok";
    setVerifyAccessTokenOverride(null);
    setLoadAuthorizationContextOverride(null);
    setOwnershipOverrides(null);
    authed();
  });

  test("DB success → object kept, no cleanup", async () => {
    const response = await uploadRequest("%PDF-1.4\nhello");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      attachment?: { id?: string; storagePath?: string };
    };
    expect(body.attachment?.id).toBeDefined();
    expect(body.attachment?.storagePath).toBeDefined();
    expect(
      storageCalls.filter((c) => c.op === "upload").length,
    ).toBe(1);
    expect(storageCalls.filter((c) => c.op === "remove").length).toBe(0);
  });

  test("DB failure → generic error + cleanup targets the uploaded object", async () => {
    attachmentsInsertMode = "fail";
    const response = await uploadRequest("%PDF-1.4\nhello");
    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      error?: { code?: string; message?: string } | string;
    };
    const err = body.error;
    expect(typeof err === "string" ? err : err?.code).toBe("INTERNAL");
    const removes = storageCalls.filter((c) => c.op === "remove");
    expect(removes.length).toBe(1);
    const uploadedKey = storageCalls.find((c) => c.op === "upload")?.key;
    expect(uploadedKey).toBeDefined();
    expect(removes[0].key).toBe(uploadedKey!);
    expect(removes[0].key).toMatch(
      new RegExp(`^${USER_A}/${TASK_A}/[0-9a-f-]+/doc\\.pdf$`),
    );
    // No storage internals leak to the client.
    expect(JSON.stringify(body)).not.toContain("delete boom");
  });

  test("DB failure + cleanup failure → generic error preserved, failure logged", async () => {
    attachmentsInsertMode = "fail";
    removeMode = "fail";
    const logged: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      const response = await uploadRequest("%PDF-1.4\nhello");
      expect(response.status).toBe(500);
      const body = (await response.json()) as {
        error?: { code?: string; message?: string } | string;
      };
      const err = body.error;
      expect(typeof err === "string" ? err : err?.code).toBe("INTERNAL");
      expect(JSON.stringify(body)).not.toContain("delete boom");
    } finally {
      console.error = originalError;
    }
    expect(
      logged.some((args) =>
        args.some((a) => String(a).includes("orphan cleanup failed")),
      ),
    ).toBe(true);
    expect(
      storageCalls.filter((c) => c.op === "remove").length,
    ).toBe(1);
  });
});

describe("finding #5 — upload idempotency fingerprint", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    idemStore.clear();
    attachmentsStore.clear();
    storageCalls.length = 0;
    deleteExecutionCount = 0;
    attachmentsInsertMode = "ok";
    attachmentsDeleteMode = "ok";
    setVerifyAccessTokenOverride(null);
    setLoadAuthorizationContextOverride(null);
    setOwnershipOverrides(null);
    authed();
  });

  const fingerprintBody = (overrides: Record<string, unknown> = {}) => ({
    task_id: TASK_A,
    user_id: USER_A,
    filename: "doc.pdf",
    notes: null,
    size: 11,
    type: "application/pdf",
    sha256: "aaa",
    ...overrides,
  });
  const fp = (body: unknown) =>
    hashRequestFingerprint("POST", "/api/v1/attachments/file", body);

  test("identical input → same fingerprint", () => {
    expect(fp(fingerprintBody())).toBe(fp(fingerprintBody()));
  });

  test("different content → different fingerprint", () => {
    expect(fp(fingerprintBody({ sha256: "aaa" }))).not.toBe(
      fp(fingerprintBody({ sha256: "bbb" })),
    );
  });

  test("different user → different fingerprint", () => {
    expect(fp(fingerprintBody({ user_id: USER_A }))).not.toBe(
      fp(fingerprintBody({ user_id: "other-user" })),
    );
  });

  test("different task → different fingerprint", () => {
    expect(fp(fingerprintBody({ task_id: TASK_A }))).not.toBe(
      fp(fingerprintBody({ task_id: "other-task" })),
    );
  });

  test("different filename/type → different fingerprint", () => {
    expect(fp(fingerprintBody({ filename: "a.pdf" }))).not.toBe(
      fp(fingerprintBody({ filename: "b.pdf" })),
    );
    expect(fp(fingerprintBody({ type: "application/pdf" }))).not.toBe(
      fp(fingerprintBody({ type: "image/png" })),
    );
  });

  test("same key + identical content replays without a second upload", async () => {
    const first = await uploadRequest("%PDF-1.4\nsame-bytes", { key: "replay-key-1" });
    expect(first.status).toBe(200);
    const second = await uploadRequest("%PDF-1.4\nsame-bytes", { key: "replay-key-1" });
    expect(second.status).toBe(200);
    expect(
      storageCalls.filter((c) => c.op === "upload").length,
    ).toBe(1);
  });

  test("same key + different content → 409 (content is bound)", async () => {
    const first = await uploadRequest("%PDF-1.4\ncontent-XX", { key: "conflict-key-1" });
    expect(first.status).toBe(200);
    const second = await uploadRequest("%PDF-1.4\ncontent-YY", { key: "conflict-key-1" });
    expect(second.status).toBe(409);
    const body = (await second.json()) as {
      error?: { code?: string } | string;
    };
    const err = body.error;
    expect(typeof err === "string" ? err : err?.code).toBe(
      "IDEMPOTENCY_CONFLICT",
    );
  });

  test("#136: upload 404 releases the claim; corrected retry with same key succeeds", async () => {
    const missingTask = "00000000-0000-4000-8000-000000000000";
    const bad = await uploadRequest("%PDF-1.4\nretry-bytes", {
      key: "file-key-release",
      taskId: missingTask,
    });
    expect(bad.status).toBe(404);
    expect(attachmentsStore.size).toBe(0);
    expect(idemStore.size).toBe(0);

    const retry = await uploadRequest("%PDF-1.4\nretry-bytes", {
      key: "file-key-release",
      taskId: TASK_A,
    });
    expect(retry.status).toBe(200);
    expect(attachmentsStore.size).toBe(1);
    expect(idemStore.get(`${USER_A}:file-key-release`)?.responseStatus).toBe(200);
  });
});

describe("I-03 — DB-first delete ordering (was F-01 storage-first)", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    idemStore.clear();
    attachmentsStore.clear();
    storageCalls.length = 0;
    deleteExecutionCount = 0;
    attachmentsInsertMode = "ok";
    attachmentsDeleteMode = "ok";
    uploadMode = "ok";
    removeMode = "ok";
    setVerifyAccessTokenOverride(null);
    setLoadAuthorizationContextOverride(null);
    setOwnershipOverrides(null);
    authed();
  });

  function seedFileAttachment(attId: string): void {
    attachmentsStore.set(attId, {
      id: attId,
      taskId: TASK_A,
      type: "file",
      notes: null,
      storagePath: `attachments/${USER_A}/${TASK_A}/${attId}/doc.pdf`,
      url: null,
      createdAt: new Date(),
    });
  }

  test("happy path unchanged → HTTP 200 + DB row gone + storage removed", async () => {
    const attId = "11111111-1111-4111-8111-111111111111";
    seedFileAttachment(attId);

    const response = await deleteRequest(attId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });

    // DB row is deleted first
    expect(attachmentsStore.has(attId)).toBe(false);
    expect(deleteExecutionCount).toBe(1);

    // Storage removal called with correct key
    const removes = storageCalls.filter((c) => c.op === "remove");
    expect(removes.length).toBe(1);
    expect(removes[0].key).toBe(`${USER_A}/${TASK_A}/${attId}/doc.pdf`);
  });

  test("storage remove fails post-delete → still 200, row gone, orphan logged for the sweeper", async () => {
    removeMode = "fail";
    const attId = "22222222-2222-4222-8222-222222222222";
    seedFileAttachment(attId);
    const logged: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      const response = await deleteRequest(attId);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      console.error = originalError;
    }

    // The already-applied delete is NOT rolled back into a 502: the row is
    // gone and the leftover object is an invisible orphan, not a broken row.
    expect(attachmentsStore.has(attId)).toBe(false);
    expect(deleteExecutionCount).toBe(1);
    expect(storageCalls.filter((c) => c.op === "remove").length).toBe(1);
    expect(
      logged.some((args) =>
        args.some((a) => String(a).includes("orphan, swept later")),
      ),
    ).toBe(true);
  });

  test("DB delete fails → generic 500, storage untouched, row intact", async () => {
    attachmentsDeleteMode = "fail";
    const attId = "33333333-3333-4333-8333-333333333333";
    seedFileAttachment(attId);

    const response = await deleteRequest(attId);
    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      error?: { code?: string; message?: string } | string;
    };
    const err = body.error;
    expect(typeof err === "string" ? err : err?.code).toBe("INTERNAL");

    // DB-first: storage is never touched when the row delete fails.
    expect(deleteExecutionCount).toBe(1);
    expect(storageCalls.filter((c) => c.op === "remove").length).toBe(0);
    expect(attachmentsStore.has(attId)).toBe(true);
  });

  test("ownership race (0 rows deleted) → generic 404, storage untouched", async () => {
    attachmentsDeleteMode = "empty";
    const attId = "44444444-4444-4444-8444-444444444444";
    seedFileAttachment(attId);

    const response = await deleteRequest(attId);
    expect(response.status).toBe(404);

    // Same generic 404 as a missing attachment, and no wasted storage call.
    expect(storageCalls.filter((c) => c.op === "remove").length).toBe(0);
    expect(attachmentsStore.has(attId)).toBe(true);
  });
});

describe("F-03 — unique storage key per attachment", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    idemStore.clear();
    attachmentsStore.clear();
    storageCalls.length = 0;
    deleteExecutionCount = 0;
    attachmentsInsertMode = "ok";
    attachmentsDeleteMode = "ok";
    uploadMode = "ok";
    removeMode = "ok";
    setVerifyAccessTokenOverride(null);
    setLoadAuthorizationContextOverride(null);
    setOwnershipOverrides(null);
    authed();
  });

  test("upload test.pdf 2x on same task produces different IDs and storage keys, delete A does not touch B", async () => {
    // 1. Upload first test.pdf
    const res1 = await uploadRequest("%PDF-1.4\ncontent-one", { filename: "test.pdf" });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as {
      attachment: { id: string; storagePath: string };
    };
    const att1 = body1.attachment;

    // 2. Upload second test.pdf on same task
    const res2 = await uploadRequest("%PDF-1.4\ncontent-two", { filename: "test.pdf" });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as {
      attachment: { id: string; storagePath: string };
    };
    const att2 = body2.attachment;

    // 3. Verify IDs and storage paths are unique and contain attachment ID
    expect(att1.id).toBeDefined();
    expect(att2.id).toBeDefined();
    expect(att1.id).not.toBe(att2.id);
    expect(att1.storagePath).not.toBe(att2.storagePath);

    expect(att1.storagePath).toBe(
      `attachments/${USER_A}/${TASK_A}/${att1.id}/test.pdf`,
    );
    expect(att2.storagePath).toBe(
      `attachments/${USER_A}/${TASK_A}/${att2.id}/test.pdf`,
    );

    expect(att1.storagePath.includes(att1.id)).toBe(true);
    expect(att2.storagePath.includes(att2.id)).toBe(true);

    const uploads = storageCalls.filter((c) => c.op === "upload");
    expect(uploads.length).toBe(2);
    expect(uploads[0].key).toBe(`${USER_A}/${TASK_A}/${att1.id}/test.pdf`);
    expect(uploads[1].key).toBe(`${USER_A}/${TASK_A}/${att2.id}/test.pdf`);

    // 4. Delete attachment A
    const delRes = await deleteRequest(att1.id);
    expect(delRes.status).toBe(200);

    // 5. Verify only storage key A is removed, storage key B is untouched
    const removes = storageCalls.filter((c) => c.op === "remove");
    expect(removes.length).toBe(1);
    expect(removes[0].key).toBe(`${USER_A}/${TASK_A}/${att1.id}/test.pdf`);
    expect(removes.some((r) => r.key.includes(att2.id))).toBe(false);

    // DB state: A deleted, B preserved
    expect(attachmentsStore.has(att1.id)).toBe(false);
    expect(attachmentsStore.has(att2.id)).toBe(true);
  });

  describe("L-10 — multipart file upload notes length validation", () => {
    beforeEach(() => {
      resetRateLimitBuckets();
      idemStore.clear();
      attachmentsStore.clear();
      storageCalls.length = 0;
      deleteExecutionCount = 0;
      attachmentsInsertMode = "ok";
    attachmentsDeleteMode = "ok";
      uploadMode = "ok";
      removeMode = "ok";
      setVerifyAccessTokenOverride(null);
      setLoadAuthorizationContextOverride(null);
      setOwnershipOverrides(null);
      authed();
    });

    test("no notes → valid upload", async () => {
      const res = await uploadRequest("%PDF-1.7\nvalid pdf");
      expect(res.status).toBe(200);
      expect(storageCalls.filter((c) => c.op === "upload").length).toBe(1);
      expect(attachmentsStore.size).toBe(1);
    });

    test("empty notes → valid upload", async () => {
      const res = await uploadRequest("%PDF-1.7\nvalid pdf", { notes: "" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        attachment?: { id?: string; notes?: string | null };
      };
      expect(body.attachment?.notes).toBeNull();
      expect(attachmentsStore.size).toBe(1);
    });

    test("notes below 1000 characters → valid upload", async () => {
      const res = await uploadRequest("%PDF-1.7\nvalid pdf", {
        notes: "short note",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        attachment?: { id?: string; notes?: string | null };
      };
      expect(body.attachment?.notes).toBe("short note");
      expect(attachmentsStore.size).toBe(1);
    });

    test("notes of exactly 1000 characters → valid upload", async () => {
      const res = await uploadRequest("%PDF-1.7\nvalid pdf", {
        notes: "n".repeat(1000),
      });
      expect(res.status).toBe(200);
      expect(attachmentsStore.size).toBe(1);
    });

    test("notes of 1001 characters → HTTP 400, no storage upload, no DB write", async () => {
      const res = await uploadRequest("%PDF-1.7\nvalid pdf", {
        notes: "n".repeat(1001),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      expect(body.error?.code).toBe("VALIDATION_ERROR");
      // Validation fails before any side effects: no storage upload, no DB insert.
      expect(storageCalls.filter((c) => c.op === "upload").length).toBe(0);
      expect(storageCalls.filter((c) => c.op === "remove").length).toBe(0);
      expect(attachmentsStore.size).toBe(0);
      expect(deleteExecutionCount).toBe(0);
    });
  });

  describe("M6-L-2 — Attachment magic byte signature verification", () => {
    test("rejects upload when declared MIME type contradicts actual file bytes (magic bytes mismatch)", async () => {
      // Declaring application/pdf but sending binary bytes starting with MZ (Windows PE executable)
      const fakePdf = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
      const res = await uploadRequest(fakePdf, {
        filename: "malicious.pdf",
        type: "application/pdf",
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      expect(body.error?.code).toBe("VALIDATION_ERROR");
    });

    test("accepts valid PDF with proper magic bytes %PDF", async () => {
      const validPdf = "%PDF-1.7\nsome valid pdf content";
      const res = await uploadRequest(validPdf, {
        filename: "document.pdf",
        type: "application/pdf",
      });
      expect(res.status).toBe(200);
    });
  });
});

describe("P2-3 — POST /link single-transaction create", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    idemStore.clear();
    attachmentsStore.clear();
    storageCalls.length = 0;
    deleteExecutionCount = 0;
    attachmentsInsertMode = "ok";
    attachmentsDeleteMode = "ok";
    uploadMode = "ok";
    removeMode = "ok";
    setVerifyAccessTokenOverride(null);
    setLoadAuthorizationContextOverride(null);
    setOwnershipOverrides(null);
    authed();
  });

  test("creates a link row in one transaction (200)", async () => {
    const res = await linkRequest({
      task_id: TASK_A,
      url: "https://example.com/spec",
      notes: "spec",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      attachment?: { id?: string; type?: string; url?: string; taskId?: string };
    };
    expect(body.attachment?.type).toBe("link");
    expect(body.attachment?.url).toBe("https://example.com/spec");
    expect(body.attachment?.taskId).toBe(TASK_A);
    expect(attachmentsStore.size).toBe(1);
  });

  test("unknown task → 404, no row created", async () => {
    const res = await linkRequest({
      task_id: "00000000-0000-4000-8000-000000000000",
      url: "https://example.com/spec",
    });
    expect(res.status).toBe(404);
    expect(attachmentsStore.size).toBe(0);
  });

  test("#136: link 404 releases the claim; corrected retry with same key succeeds", async () => {
    const missingTask = "00000000-0000-4000-8000-000000000000";
    const bad = await linkRequest(
      { task_id: missingTask, url: "https://example.com/spec" },
      "user-a",
      "link-key-release",
    );
    expect(bad.status).toBe(404);
    expect(attachmentsStore.size).toBe(0);
    expect(idemStore.size).toBe(0);

    const retry = await linkRequest(
      { task_id: TASK_A, url: "https://example.com/spec" },
      "user-a",
      "link-key-release",
    );
    expect(retry.status).toBe(200);
    expect(attachmentsStore.size).toBe(1);
    expect(idemStore.get(`${USER_A}:link-key-release`)?.responseStatus).toBe(200);
  });
});
