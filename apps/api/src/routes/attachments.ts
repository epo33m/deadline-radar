import { and, eq, inArray } from "drizzle-orm";
import { Elysia, t } from "elysia";
import {
  attachmentObjectKey,
  buildAttachmentStoragePath,
  linkAttachmentRequestSchema,
  sanitizeAttachmentFilename,
} from "@deadline-radar/validation";
import { attachments, tasks } from "@deadline-radar/db";

import { requireAuthPlugin } from "../plugins/auth";
import { getDb } from "../lib/db";
import { createServiceClient } from "../lib/supabase";
import {
  assertNoForbiddenMutationKeys,
  ownedAttachment,
  ownedAttachmentByStoragePath,
  ownedTask,
  ownedTaskInTx,
  withUserRls,
} from "../lib/authorization";
import {
  ApiError,
  apiDoc,
  beginIdempotent,
  completeIdempotent,
  completeIdempotentInTx,
  envelope,
  idempotent,
  isUniqueViolation,
  jsonBodyDetail,
  openApiBodies,
  R,
  readIdempotencyKey,
  readJsonBody,
  releaseIdempotentOnClientError,
  runTxWithCompletionRetry,
  secured,
  serializeAttachment,
  sha256Hex,
  validationFromZod,
} from "../lib/api";
import {
  assertAllowedUploadMime,
  assertUploadSize,
} from "../plugins/body-limit";
import {
  isStorageDuplicateError,
  storageRemove,
  storageSignedUrl,
  storageUpload,
} from "../lib/storage";

export const attachmentRoutes = new Elysia({ prefix: "/api/v1/attachments" })
  .use(requireAuthPlugin)
  .post(
    "/link",
    async ({ requireAuthz, request, set }) => {
      const ctx = await requireAuthz("attachment.create");
      const body = await readJsonBody(request);
      assertNoForbiddenMutationKeys(body);

      // #136: parse before claiming so an invalid body never poisons the key.
      const parsed = linkAttachmentRequestSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod(
          "Invalid link attachment",
          parsed.error.flatten().fieldErrors,
        );
      }

      const idemKey = readIdempotencyKey(request);
      if (idemKey) {
        const { replay } = await beginIdempotent({
          userId: ctx.subject.id,
          key: idemKey,
          method: "POST",
          path: "/api/v1/attachments/link",
          body,
        });
        if (replay) {
          set.status = replay.statusCode;
          return replay.body;
        }
      }

      // Check + insert + idempotency completion in one transaction (P2-3,
      // #137). A 4xx from the tx (e.g. unknown task) frees the claim for a
      // corrected same-key retry.
      let response: { attachment: ReturnType<typeof serializeAttachment> };
      try {
        response = await runTxWithCompletionRetry(
          () =>
            withUserRls(ctx.subject.id, async (tx) => {
              const task = await ownedTaskInTx(
                tx,
                ctx.subject.id,
                parsed.data.task_id,
              );
              if (!task) throw ApiError.notFound("Task not found");
              const [row] = await tx
                .insert(attachments)
                .values({
                  taskId: task.id,
                  type: "link",
                  notes: parsed.data.notes,
                  url: parsed.data.url,
                  storagePath: null,
                  idempotencyKey: idemKey,
                })
                .returning();
              const res = { attachment: serializeAttachment(row) };
              if (idemKey) {
                await completeIdempotentInTx(tx, {
                  userId: ctx.subject.id,
                  key: idemKey,
                  statusCode: 200,
                  body: res,
                });
              }
              return res;
            }),
          { key: idemKey },
        );
      } catch (error: unknown) {
        if (idemKey && isUniqueViolation(error)) {
          // #137 Layer B: stale-reclaim re-execution replays the committed row.
          const [existing] = await getDb()
            .select()
            .from(attachments)
            .where(
              and(
                eq(attachments.taskId, parsed.data.task_id),
                eq(attachments.idempotencyKey, idemKey),
              ),
            )
            .limit(1);
          if (existing) {
            const replay = { attachment: serializeAttachment(existing) };
            await completeIdempotent({
              userId: ctx.subject.id,
              key: idemKey,
              statusCode: 200,
              body: replay,
            });
            return replay;
          }
        }
        await releaseIdempotentOnClientError(error, {
          userId: ctx.subject.id,
          key: idemKey,
        });
        throw error;
      }
      return response;
    },
    {
      detail: {
        tags: ["Attachments"],
        summary: "Add link attachment",
        requestBody: jsonBodyDetail(openApiBodies.linkAttachment),
        ...secured(),
        ...apiDoc({
          ok: envelope({ attachment: R("Attachment") }, ["attachment"]),
          errors: [400, 401, 403, 404, 409, 429],
        }),
        ...idempotent(),
      },
    },
  )
  .post(
    "/file",
    async ({ body, requireAuthz, request, set }) => {
      const ctx = await requireAuthz("attachment.create");
      const taskId = body.task_id;
      const notesRaw = body.notes;
      const notes =
        typeof notesRaw === "string" && notesRaw.trim()
          ? notesRaw.trim()
          : null;
      const file = body.file;

      if (!taskId || !file) {
        throw ApiError.validation("task_id and file are required");
      }

      assertAllowedUploadMime(file.type);
      assertUploadSize(file.size);

      // Read bytes before the idempotency check so the fingerprint can bind
      // the actual content (not just filename/size metadata).
      const bytes = await file.arrayBuffer();
      assertUploadSize(bytes.byteLength);
      assertAllowedUploadMime(file.type, bytes);
      const contentHash = sha256Hex(bytes);
      const filename = sanitizeAttachmentFilename(file.name || "upload");

      const idemKey = readIdempotencyKey(request);
      if (idemKey) {
        const { replay } = await beginIdempotent({
          userId: ctx.subject.id,
          key: idemKey,
          method: "POST",
          path: "/api/v1/attachments/file",
          body: {
            task_id: taskId,
            user_id: ctx.subject.id,
            filename,
            notes,
            size: bytes.byteLength,
            type: file.type,
            sha256: contentHash,
          },
        });
        if (replay) {
          set.status = replay.statusCode;
          return replay.body;
        }
      }

      let response: { attachment: ReturnType<typeof serializeAttachment> };
      try {
        const task = await ownedTask(ctx.subject.id, taskId);
        if (!task) throw ApiError.notFound("Task not found");

        const attachmentId = crypto.randomUUID();
        const dbPath = buildAttachmentStoragePath(
          ctx.subject.id,
          task.id,
          attachmentId,
          filename,
        );
        const objectKey = attachmentObjectKey(dbPath);

        const supabase = createServiceClient();
        // Transport timeout via the service client fetch; bounded retries on
        // thrown transport failures only (upsert:false makes duplicates
        // impossible, and returned errors are definitive answers).
        const { error: uploadError } = await storageUpload(
          supabase,
          objectKey,
          bytes,
          file.type || "application/octet-stream",
        );

        if (uploadError) {
          if (isStorageDuplicateError(uploadError)) {
            throw ApiError.conflict(
              "An attachment with this file name already exists for this task",
            );
          }
          console.error("[attachments] upload failed", uploadError.message);
          throw new ApiError({
            status: 502,
            code: "DEPENDENCY_FAILURE",
            message: "Unable to store attachment",
          });
        }

        // Best-effort compensation: remove only the object this request just
        // uploaded so a DB failure cannot leave an orphan in storage. A
        // cleanup failure is logged for operations and never replaces the
        // original (generic) error contract.
        const compensateOrphan = async () => {
          try {
            const { error: cleanupError } = await supabase.storage
              .from("attachments")
              .remove([objectKey]);
            if (cleanupError) {
              console.error(
                "[attachments] orphan cleanup failed",
                objectKey,
                cleanupError.message,
              );
            }
          } catch (cleanupError) {
            console.error(
              "[attachments] orphan cleanup failed",
              objectKey,
              cleanupError instanceof Error
                ? cleanupError.message
                : "unknown",
            );
          }
        };

        try {
          // #137: DB insert + completion commit atomically. The storage
          // upload above stays outside the tx (external side effect); the
          // bounded retry only re-runs the rolled-back DB work.
          response = await runTxWithCompletionRetry(
            () =>
              withUserRls(ctx.subject.id, async (tx) => {
                const [row] = await tx
                  .insert(attachments)
                  .values({
                    id: attachmentId,
                    taskId: task.id,
                    type: "file",
                    notes,
                    storagePath: dbPath,
                    url: null,
                    idempotencyKey: idemKey,
                  })
                  .returning();
                const res = { attachment: serializeAttachment(row) };
                if (idemKey) {
                  await completeIdempotentInTx(tx, {
                    userId: ctx.subject.id,
                    key: idemKey,
                    statusCode: 200,
                    body: res,
                  });
                }
                return res;
              }),
            { key: idemKey },
          );
        } catch (dbError) {
          if (idemKey && isUniqueViolation(dbError)) {
            // #137 Layer B: a stale-reclaim re-execution found the committed
            // row via the dedupe key — clean up this attempt's object (a fresh
            // attachmentId means a different path) and replay the row.
            const [existing] = await getDb()
              .select()
              .from(attachments)
              .where(
                and(
                  eq(attachments.taskId, task.id),
                  eq(attachments.idempotencyKey, idemKey),
                ),
              )
              .limit(1);
            if (existing) {
              await compensateOrphan();
              const replay = { attachment: serializeAttachment(existing) };
              await completeIdempotent({
                userId: ctx.subject.id,
                key: idemKey,
                statusCode: 200,
                body: replay,
              });
              return replay;
            }
          }
          await compensateOrphan();
          throw dbError;
        }
      } catch (error) {
        // #136: 404/409 free the claim for a corrected same-key retry; 5xx
        // (e.g. the 502 storage failure) keeps it so a lost response replays.
        await releaseIdempotentOnClientError(error, {
          userId: ctx.subject.id,
          key: idemKey,
        });
        throw error;
      }
      return response;
    },
    {
      body: t.Object({
        task_id: t.String({ format: "uuid" }),
        notes: t.Optional(t.String({ maxLength: 1000 })),
        file: t.File({
          type: [
            "application/pdf",
            "image/png",
            "image/jpeg",
            "image/webp",
            "image/gif",
            "text/plain",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ],
          maxSize: "10m",
        }),
      }),
      detail: {
        tags: ["Attachments"],
        summary: "Upload file attachment",
        ...secured(),
        ...apiDoc({
          ok: envelope({ attachment: R("Attachment") }, ["attachment"]),
          errors: [400, 401, 403, 404, 409, 413, 429, 502],
          description:
            "Multipart upload (10 MiB max, allowlisted MIME types). " +
            "Success returns the created attachment.",
        }),
        ...idempotent(),
      },
    },
  )
  .delete(
    "/:id",
    async ({ params, requireAuthz }) => {
      const ctx = await requireAuthz("attachment.delete");
      const row = await ownedAttachment(ctx.subject.id, params.id);

      if (!row) throw ApiError.notFound("Attachment not found");

      // I-03: DB-first. The row is deleted before storage is touched, so a
      // DB failure leaves everything intact (storage untouched, row present)
      // instead of a user-visible broken attachment with the file gone.
      const deleted = await getDb()
        .delete(attachments)
        .where(
          and(
            eq(attachments.id, params.id),
            // Ownership is enforced in the mutation itself, not only by the
            // lookup above: attachments carry no userId column, so scope
            // through the parent task owned by the requester.
            inArray(
              attachments.taskId,
              getDb()
                .select({ id: tasks.id })
                .from(tasks)
                .where(eq(tasks.userId, ctx.subject.id)),
            ),
          ),
        )
        .returning({ id: attachments.id });
      if (deleted.length === 0) {
        // Ownership changed (or row vanished) between lookup and delete.
        // Same generic 404 as a missing attachment — no enumeration. Reached
        // before any storage call, so no wasted storage delete either.
        throw ApiError.notFound("Attachment not found");
      }

      // Best-effort storage removal: the row is already gone, so a failure
      // here leaves only an invisible storage orphan for the periodic
      // sweeper (sweepOrphanedAttachments) — never a broken row, never a
      // 502 for an already-applied delete.
      if (row.attachment.type === "file" && row.attachment.storagePath) {
        const objectKey = row.attachment.storagePath.replace(
          /^attachments\//,
          "",
        );
        try {
          const supabase = createServiceClient();
          const { error: removeError } = await storageRemove(supabase, [
            objectKey,
          ]);
          if (removeError) {
            console.error(
              "[attachments] post-delete storage remove failed (orphan, swept later)",
              objectKey,
              removeError.message,
            );
          }
        } catch (error) {
          console.error(
            "[attachments] post-delete storage remove failed (orphan, swept later)",
            objectKey,
            error instanceof Error ? error.message : "unknown",
          );
        }
      }

      return { ok: true };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: {
        tags: ["Attachments"],
        summary: "Remove attachment",
        ...secured(),
        ...apiDoc({
          ok: envelope({ ok: { type: "boolean" } }, ["ok"]),
          errors: [401, 403, 404, 429],
        }),
      },
    },
  )
  .get(
    "/signed-url",
    async ({ query, requireAuthz }) => {
      const ctx = await requireAuthz("attachment.signed-url");
      const storagePath = query.storage_path;
      const expectedPrefix = `attachments/${ctx.subject.id}/`;
      if (!storagePath?.startsWith(expectedPrefix)) {
        throw ApiError.forbidden();
      }

      const owned = await ownedAttachmentByStoragePath(
        ctx.subject.id,
        storagePath,
      );
      if (!owned) throw ApiError.forbidden();

      const objectKey = storagePath.replace(/^attachments\//, "");
      const supabase = createServiceClient();
      const { data, error } = await storageSignedUrl(
        supabase,
        objectKey,
        60 * 10,
      );
      if (error || !data?.signedUrl) {
        console.error("[attachments] signed url failed", error?.message);
        throw new ApiError({
          status: 502,
          code: "DEPENDENCY_FAILURE",
          message: "Unable to create signed URL",
        });
      }
      return { url: data.signedUrl };
    },
    {
      query: t.Object({ storage_path: t.String() }),
      detail: {
        tags: ["Attachments"],
        summary: "Signed URL for file",
        ...secured(),
        ...apiDoc({
          ok: envelope({ url: { type: "string" } }, ["url"]),
          description:
            "Short-lived (10 minute) signed download URL. Requires both " +
            "the `attachments/{userId}/` path prefix and an owned file row.",
          errors: [401, 403, 429, 502],
        }),
      },
    },
  );
