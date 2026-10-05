/**
 * I-03 / #133: orphan sweeper — orphans removed, referenced objects kept,
 * exact membership beyond any row cap, minimum-age guard, bounded per run,
 * failures contained (never throws).
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

let dbPaths: string[] = [];
let bucketObjects: string[] = [];
let removedKeys: string[] = [];
let listMode: "ok" | "fail" = "ok";
let removeMode: "ok" | "fail" = "ok";
let dbMode: "ok" | "fail" = "ok";
let dbQueryCount = 0;
let createdAtOverrides = new Map<string, string | null>();

/** Objects are old unless a test overrides them (mirrors the 1h guard). */
const OLD = new Date(Date.now() - 2 * 60 * 60_000).toISOString();

mock.module("./db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        // Query builder is thenable AND supports .limit(n) like the real
        // builder: the old truncated query would slice here, so the >cap
        // regression test genuinely fails against the buggy implementation.
        where: () => {
          if (dbMode === "fail") return Promise.reject(new Error("db boom"));
          dbQueryCount += 1;
          const rows = dbPaths.map((p) => ({ storagePath: p }));
          return {
            limit: async (n: number) => rows.slice(0, n),
            then: (
              onFulfilled: (value: typeof rows) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) => Promise.resolve(rows).then(onFulfilled, onRejected),
          };
        },
      }),
    }),
  }),
}));

mock.module("./supabase", () => ({
  // NOTE: bun's mock registry is process-global across test files in one
  // run — this mock must carry every export other suites import from
  // ../lib/supabase (else their imports break when run together).
  createAnonClient: () => ({ auth: {} }),
  createUserClient: () => ({ auth: {} }),
  createServiceClient: () => ({
    storage: {
      from: () => ({
        list: async (prefix?: string, opts?: { limit?: number; offset?: number }) => {
          if (listMode === "fail") {
            return { data: null, error: { message: "list boom" } };
          }
          const p = prefix ?? "";
          const children = new Set<string>();
          for (const key of bucketObjects) {
            if (p !== "" && !(key === p || key.startsWith(`${p}/`))) continue;
            const rest = p === "" ? key : key.slice(p.length + 1);
            const seg = rest.split("/")[0];
            if (seg) children.add(seg);
          }
          const names = [...children].slice(
            opts?.offset ?? 0,
            (opts?.offset ?? 0) + (opts?.limit ?? 1000),
          );
          return {
            data: names.map((name) => {
              const fullKey = p === "" ? name : `${p}/${name}`;
              const isFile = fullKey.split("/").length >= 4;
              return {
                name,
                created_at: isFile
                  ? createdAtOverrides.has(fullKey)
                    ? createdAtOverrides.get(fullKey)!
                    : OLD
                  : null,
              };
            }),
            error: null,
          };
        },
        remove: async (keys: string[]) => {
          if (removeMode === "fail") {
            return { data: null, error: { message: "remove boom" } };
          }
          for (const k of keys) {
            removedKeys.push(k);
            bucketObjects = bucketObjects.filter((o) => o !== k);
          }
          return { data: [], error: null };
        },
      }),
    },
  }),
}));

const { sweepOrphanedAttachments, STORAGE_SWEEP_REFERENCED_CHUNK } =
  await import("./storage-sweep");

describe("I-03 — sweepOrphanedAttachments", () => {
  beforeEach(() => {
    dbPaths = [];
    bucketObjects = [];
    removedKeys = [];
    listMode = "ok";
    removeMode = "ok";
    dbMode = "ok";
    dbQueryCount = 0;
    createdAtOverrides = new Map();
  });

  test("orphan removed, referenced object kept", async () => {
    dbPaths = ["attachments/u1/t1/id1/doc.pdf"];
    bucketObjects = ["u1/t1/id1/doc.pdf", "u1/t1/idX/old.pdf"];

    const result = await sweepOrphanedAttachments();

    expect(result).toEqual({ examined: 2, removed: 1 });
    expect(removedKeys).toEqual(["u1/t1/idX/old.pdf"]);
    expect(bucketObjects).toEqual(["u1/t1/id1/doc.pdf"]);
  });

  test("fully referenced bucket → nothing removed", async () => {
    dbPaths = ["attachments/u1/t1/id1/doc.pdf"];
    bucketObjects = ["u1/t1/id1/doc.pdf"];

    const result = await sweepOrphanedAttachments();

    expect(result).toEqual({ examined: 1, removed: 0 });
    expect(removedKeys).toEqual([]);
  });

  test("#133: live file past the old 5000 row cap survives; orphan still removed", async () => {
    const fillers = Array.from(
      { length: 5000 },
      (_, i) => `attachments/filler/t${i}/id/f.pdf`,
    );
    const live = "attachments/u2/tX/idX/live.pdf";
    // The live row is the 5001st entry: outside a LIMIT 5000 sample.
    dbPaths = [...fillers, live];
    bucketObjects = ["u2/tX/idX/live.pdf", "u2/tX/idY/orphan.pdf"];

    const result = await sweepOrphanedAttachments();

    expect(result).toEqual({ examined: 2, removed: 1 });
    expect(removedKeys).toEqual(["u2/tX/idY/orphan.pdf"]);
    expect(bucketObjects).toContain("u2/tX/idX/live.pdf");
  });

  test("#133: exact lookup spans multiple chunks", async () => {
    const total = STORAGE_SWEEP_REFERENCED_CHUNK + 200;
    const kept = Array.from(
      { length: total },
      (_, i) => `u1/t1/id${i}/f.pdf`,
    );
    dbPaths = kept.map((k) => `attachments/${k}`);
    bucketObjects = [...kept, "u1/t1/orphan/f.pdf"];

    const result = await sweepOrphanedAttachments(undefined, {
      listLimit: 5000,
    });

    expect(result).toEqual({ examined: total + 1, removed: 1 });
    expect(removedKeys).toEqual(["u1/t1/orphan/f.pdf"]);
    expect(dbQueryCount).toBe(
      Math.ceil((total + 1) / STORAGE_SWEEP_REFERENCED_CHUNK),
    );
  });

  test("#133: fresh unreferenced object is kept (upload→insert window)", async () => {
    dbPaths = [];
    bucketObjects = ["u1/t1/fresh/fresh.pdf", "u1/t1/old/old.pdf"];
    createdAtOverrides.set("u1/t1/fresh/fresh.pdf", new Date().toISOString());

    const result = await sweepOrphanedAttachments();

    expect(result).toEqual({ examined: 2, removed: 1 });
    expect(removedKeys).toEqual(["u1/t1/old/old.pdf"]);
    expect(bucketObjects).toEqual(["u1/t1/fresh/fresh.pdf"]);
  });

  test("#133: unparsable created_at is kept (fail-closed)", async () => {
    dbPaths = [];
    bucketObjects = ["u1/t1/no-ts/no-ts.pdf", "u1/t1/old/old.pdf"];
    createdAtOverrides.set("u1/t1/no-ts/no-ts.pdf", null);

    const result = await sweepOrphanedAttachments();

    expect(result).toEqual({ examined: 2, removed: 1 });
    expect(removedKeys).toEqual(["u1/t1/old/old.pdf"]);
    expect(bucketObjects).toEqual(["u1/t1/no-ts/no-ts.pdf"]);
  });

  test("#133: DB lookup failure deletes nothing", async () => {
    dbMode = "fail";
    dbPaths = ["attachments/u1/t1/id1/doc.pdf"];
    bucketObjects = ["u1/t1/idX/old.pdf"];

    const result = await sweepOrphanedAttachments();

    expect(result).toEqual({ examined: 1, removed: 0 });
    expect(removedKeys).toEqual([]);
    expect(bucketObjects).toEqual(["u1/t1/idX/old.pdf"]);
  });

  test("second sweep is a no-op (idempotent)", async () => {
    dbPaths = ["attachments/u1/t1/id1/doc.pdf"];
    bucketObjects = ["u1/t1/id1/doc.pdf", "u1/t1/idX/old.pdf"];

    const first = await sweepOrphanedAttachments();
    expect(first.removed).toBe(1);
    const second = await sweepOrphanedAttachments();

    expect(second).toEqual({ examined: 1, removed: 0 });
    expect(removedKeys).toEqual(["u1/t1/idX/old.pdf"]);
    expect(bucketObjects).toEqual(["u1/t1/id1/doc.pdf"]);
  });

  test("examine cap honored (bounded per run)", async () => {
    dbPaths = [];
    bucketObjects = Array.from(
      { length: 5 },
      (_, i) => `u1/t1/id${i}/f.pdf`,
    );

    const result = await sweepOrphanedAttachments(undefined, { maxObjects: 2 });

    expect(result.examined).toBe(2);
    expect(removedKeys).toHaveLength(2);
    expect(bucketObjects).toHaveLength(3);
  });

  test("removal cap honored (bounded per run)", async () => {
    dbPaths = [];
    bucketObjects = ["u1/t1/a/f.pdf", "u1/t1/b/f.pdf", "u1/t1/c/f.pdf"];

    const result = await sweepOrphanedAttachments(undefined, {
      maxRemovals: 1,
    });

    expect(result.removed).toBe(1);
    expect(removedKeys).toHaveLength(1);
    expect(bucketObjects).toHaveLength(2);
  });

  test("list failure → zeros, never throws", async () => {
    listMode = "fail";
    dbPaths = ["attachments/u1/t1/id1/doc.pdf"];
    bucketObjects = ["u1/t1/idX/old.pdf"];

    const result = await sweepOrphanedAttachments();

    expect(result.removed).toBe(0);
    expect(removedKeys).toEqual([]);
  });

  test("remove failure → zeros, never throws, objects intact", async () => {
    removeMode = "fail";
    dbPaths = [];
    bucketObjects = ["u1/t1/idX/old.pdf"];

    const result = await sweepOrphanedAttachments();

    expect(result).toEqual({ examined: 1, removed: 0 });
    expect(bucketObjects).toEqual(["u1/t1/idX/old.pdf"]);
  });
});
