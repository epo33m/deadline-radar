/**
 * Issue #123 regression: attachment ownership must exclude soft-deleted
 * tasks in the ACTUAL predicate (otherwise a signed URL is still mintable
 * for files of a deleted task — attachments/signed-url-deleted-task-disclosure).
 *
 * The predicates are built with real drizzle code, so the `.where()`
 * condition captured from a recording fake tx is rendered via
 * `PgDialect.sqlToQuery` and asserted to contain `tasks.deleted_at is null`.
 */
process.env.NODE_ENV = "test";
process.env.AUTH_BRIDGE_SECRET ??= "test-auth-bridge-secret";
import { describe, expect, test } from "bun:test";
import { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  ownedAttachmentByStoragePathInTx,
  ownedAttachmentInTx,
  setOwnershipOverrides,
} from "./ownership";

const dialect = new PgDialect();

function recordingTx(recordedWheres: unknown[]) {
  const self = {
    from: () => self,
    innerJoin: () => self,
    where: (condition: unknown) => {
      recordedWheres.push(condition);
      return self;
    },
    limit: async () => [],
  };
  return {
    select: () => self,
  };
}

describe("attachment ownership excludes soft-deleted tasks (#123)", () => {
  test("ownedAttachmentInTx predicate includes tasks.deleted_at IS NULL", async () => {
    setOwnershipOverrides({});
    const recordedWheres: unknown[] = [];
    await ownedAttachmentInTx(
      recordingTx(recordedWheres) as never,
      "user-1",
      "att-1",
    );
    expect(recordedWheres.length).toBe(1);
    const { sql } = dialect.sqlToQuery(recordedWheres[0] as SQL);
    expect(sql).toContain('"deleted_at" is null');
  });

  test("ownedAttachmentByStoragePathInTx predicate includes tasks.deleted_at IS NULL", async () => {
    setOwnershipOverrides({});
    const recordedWheres: unknown[] = [];
    await ownedAttachmentByStoragePathInTx(
      recordingTx(recordedWheres) as never,
      "user-1",
      "attachments/user-1/f.png",
    );
    expect(recordedWheres.length).toBe(1);
    const { sql } = dialect.sqlToQuery(recordedWheres[0] as SQL);
    expect(sql).toContain('"deleted_at" is null');
  });
});
