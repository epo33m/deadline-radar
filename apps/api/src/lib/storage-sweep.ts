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
 *
 * Issue #133: referenced membership is resolved per candidate with a
 * chunked exact lookup (`storage_path = ANY(...)`), never a silently
 * truncated sample, so live files past any historical row cap survive.
 * Candidates younger than STORAGE_SWEEP_MIN_AGE_MS are left alone, which
 * closes the upload-then-insert window (storage is written before the row).
 */
import { and, inArray, isNotNull } from "drizzle-orm";
import { attachments } from "@deadline-radar/db";
import { attachmentObjectKey } from "@deadline-radar/validation";

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
/** Candidate object keys resolved per exact-membership DB query. */
export const STORAGE_SWEEP_REFERENCED_CHUNK = 500;
/**
 * An object must be at least this old before it may be removed. Storage is
 * written before the attachment row (upload, then insert), so a fresh
 * unreferenced object can simply be one whose row has not landed yet.
 */
export const STORAGE_SWEEP_MIN_AGE_MS = 60 * 60_000;

type Candidate = { key: string; createdAt: string | null };

export type StorageSweepResult = {
  examined: number;
  removed: number;
};

function storagePathFor(objectKey: string): string {
  return `attachments/${objectKey}`;
}

/** Fail-closed on missing/unparsable timestamps: fresh objects are kept. */
function isOldEnough(createdAt: string | null, cutoff: number): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && created <= cutoff;
}

/** Exact referenced set among `objectKeys`, chunked to keep the payload small. */
async function referencedPaths(objectKeys: string[]): Promise<Set<string>> {
  const referenced = new Set<string>();
  for (let i = 0; i < objectKeys.length; i += STORAGE_SWEEP_REFERENCED_CHUNK) {
    const chunk = objectKeys
      .slice(i, i + STORAGE_SWEEP_REFERENCED_CHUNK)
      .map(storagePathFor);
    const rows = await getDb()
      .select({ storagePath: attachments.storagePath })
      .from(attachments)
      .where(
        and(
          isNotNull(attachments.storagePath),
          inArray(attachments.storagePath, chunk),
        ),
      );
    for (const row of rows) {
      if (row.storagePath) referenced.add(attachmentObjectKey(row.storagePath));
    }
  }
  return referenced;
}

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
  const cutoff = Date.now() - STORAGE_SWEEP_MIN_AGE_MS;

  const candidates: Candidate[] = [];
  const prefixes: string[] = [""];
  try {
    while (prefixes.length > 0 && candidates.length < maxObjects) {
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
        return { examined: candidates.length, removed: 0 };
      }
      for (const entry of data) {
        const key = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        if (key.split("/").length < OBJECT_KEY_SEGMENTS) {
          prefixes.push(key);
          continue;
        }
        if (candidates.length >= maxObjects) break;
        candidates.push({ key, createdAt: entry.created_at ?? null });
      }
    }
  } catch (error) {
    console.error(
      "[storage-sweep] walk failed",
      error instanceof Error ? error.message : "unknown",
    );
    return { examined: candidates.length, removed: 0 };
  }

  const examined = candidates.length;
  const eligible = candidates.filter((c) => isOldEnough(c.createdAt, cutoff));
  if (eligible.length === 0) return { examined, removed: 0 };

  let referenced: Set<string>;
  try {
    referenced = await referencedPaths(eligible.map((c) => c.key));
  } catch (error) {
    // Fail closed: without an exact answer, delete nothing this run.
    console.error(
      "[storage-sweep] referenced lookup failed",
      error instanceof Error ? error.message : "unknown",
    );
    return { examined, removed: 0 };
  }

  const victims = eligible
    .filter((c) => !referenced.has(c.key))
    .slice(0, maxRemovals)
    .map((c) => c.key);
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
