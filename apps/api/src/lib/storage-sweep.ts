/**
 * I-03: periodic bounded sweeper for invisible storage orphans.
 *
 * The attachment DELETE path is DB-first: when the post-delete storage
 * removal fails, the row is already gone and only an unreferenced object
 * remains. This sweeper lists bucket objects, drops the ones no attachment
 * row references, and reports counts. It never throws — a listing/removal
 * failure is logged and yields a zero (the next scheduled run retries).
 *
 * Object keys are `<userId>/<taskId>/<uuid>/<file>` (bucket prefix
 * `attachments/` stripped). The walk descends prefixes until keys have
 * OBJECT_KEY_SEGMENTS segments; everything is capped so one run stays
 * cheap on the hourly cron.
 */
import { isNotNull } from "drizzle-orm";
import { attachments } from "@deadline-radar/db";

import { getDb } from "./db";
import { createServiceClient } from "./supabase";
import { storageList, storageRemove, type ServiceClient } from "./storage";

/** Segments of a full object key (`user/task/uuid/file`). */
const OBJECT_KEY_SEGMENTS = 4;

/** Max entries fetched per single storage list call. */
export const STORAGE_SWEEP_LIST_LIMIT = 1000;
/** Max objects examined per run (listing stops here). */
export const STORAGE_SWEEP_MAX_OBJECTS = 2000;
/** Max orphan removals per run. */
export const STORAGE_SWEEP_MAX_REMOVALS = 100;
/** Max referenced paths read from the DB per run. */
const STORAGE_SWEEP_DB_LIMIT = 5000;

export type StorageSweepResult = {
  examined: number;
  removed: number;
};

export async function sweepOrphanedAttachments(
  client: ServiceClient = createServiceClient(),
  options?: {
    listLimit?: number;
    maxObjects?: number;
    maxRemovals?: number;
  },
): Promise<StorageSweepResult> {
  const listLimit = options?.listLimit ?? STORAGE_SWEEP_LIST_LIMIT;
  const maxObjects = options?.maxObjects ?? STORAGE_SWEEP_MAX_OBJECTS;
  const maxRemovals = options?.maxRemovals ?? STORAGE_SWEEP_MAX_REMOVALS;

  const rows = await getDb()
    .select({ storagePath: attachments.storagePath })
    .from(attachments)
    .where(isNotNull(attachments.storagePath))
    .limit(STORAGE_SWEEP_DB_LIMIT);
  const referenced = new Set(
    (rows.map((r) => r.storagePath).filter(Boolean) as string[]).map((p) =>
      p.replace(/^attachments\//, ""),
    ),
  );

  const orphans: string[] = [];
  let examined = 0;
  const prefixes: string[] = [""];
  try {
    while (
      prefixes.length > 0 &&
      examined < maxObjects &&
      orphans.length < maxRemovals
    ) {
      const prefix = prefixes.pop() as string;
      const { data, error } = await storageList(
        client,
        prefix === "" ? undefined : prefix,
        { limit: listLimit },
      );
      if (error || !data) {
        console.error(
          "[storage-sweep] list failed",
          prefix === "" ? "(root)" : prefix,
          error instanceof Error
            ? error.message
            : typeof error === "object" && error !== null && "message" in error
              ? String((error as { message?: unknown }).message)
              : "unknown",
        );
        return { examined, removed: 0 };
      }
      for (const entry of data) {
        const key = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        if (key.split("/").length < OBJECT_KEY_SEGMENTS) {
          prefixes.push(key);
          continue;
        }
        examined += 1;
        if (examined > maxObjects) break;
        if (!referenced.has(key)) orphans.push(key);
        if (orphans.length >= maxRemovals) break;
      }
    }
  } catch (error) {
    console.error(
      "[storage-sweep] walk failed",
      error instanceof Error ? error.message : "unknown",
    );
    return { examined, removed: 0 };
  }

  const victims = orphans.slice(0, maxRemovals);
  if (victims.length === 0) return { examined, removed: 0 };
  try {
    const { error } = await storageRemove(client, victims);
    if (error) {
      console.error(
        "[storage-sweep] remove failed",
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "message" in error
            ? String((error as { message?: unknown }).message)
            : "unknown",
      );
      return { examined, removed: 0 };
    }
  } catch (error) {
    console.error(
      "[storage-sweep] remove failed",
      error instanceof Error ? error.message : "unknown",
    );
    return { examined, removed: 0 };
  }
  return { examined, removed: victims.length };
}
