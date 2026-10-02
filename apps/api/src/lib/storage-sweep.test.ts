/**
 * I-03: orphan sweeper — orphans removed, referenced objects kept, bounded,
 * failures contained (never throws).
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

let dbPaths: string[] = [];
let bucketObjects: string[] = [];
let removedKeys: string[] = [];
let listMode: "ok" | "fail" = "ok";
let removeMode: "ok" | "fail" = "ok";

mock.module("./db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => dbPaths.map((p) => ({ storagePath: p })),
        }),
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
          return { data: names.map((name) => ({ name })), error: null };
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

const { sweepOrphanedAttachments } = await import("./storage-sweep");

describe("I-03 — sweepOrphanedAttachments", () => {
  beforeEach(() => {
    dbPaths = [];
    bucketObjects = [];
    removedKeys = [];
    listMode = "ok";
    removeMode = "ok";
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
