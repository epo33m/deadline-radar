import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import {
  attachmentObjectKey,
  buildAttachmentStoragePath,
  linkAttachmentRequestSchema,
  sanitizeAttachmentFilename,
} from "@deadline-radar/validation";
import { attachments } from "@deadline-radar/db";

import { requireAuthPlugin } from "../plugins/auth";
import { getDb } from "../lib/db";
import { createServiceClient } from "../lib/supabase";
import {
  assertNoForbiddenMutationKeys,
  ownedAttachment,
  ownedAttachmentByStoragePath,
  ownedTask,
} from "../lib/authorization";
import {
  ApiError,
  beginIdempotent,
  completeIdempotent,
  jsonBodyDetail,
  openApiBodies,
  readIdempotencyKey,
  readJsonBody,
  serializeAttachment,
  validationFromZod,
} from "../lib/api";
import {
  assertAllowedUploadMime,
  assertUploadSize,
} from "../plugins/body-limit";

export const attachmentRoutes = new Elysia({ prefix: "/api/v1/attachments" })
  .use(requireAuthPlugin)
  .post(
    "/link",
    async ({ requireAuthz, request, set }) => {
      const ctx = await requireAuthz("attachment.create");
      const body = await readJsonBody(request);
      assertNoForbiddenMutationKeys(body);

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

      const parsed = linkAttachmentRequestSchema.safeParse(body);
      if (!parsed.success) {
        throw validationFromZod(
          "Invalid link attachment",
          parsed.error.flatten().fieldErrors,
        );
      }
      const task = await ownedTask(ctx.subject.id, parsed.data.task_id);
      if (!task) throw ApiError.notFound("Task not found");
      const [row] = await getDb()
        .insert(attachments)
        .values({
          taskId: task.id,
          type: "link",
          name: parsed.data.name,
          url: parsed.data.url,
          storagePath: null,
        })
        .returning();
      const response = { attachment: serializeAttachment(row) };
      if (idemKey) {
        await completeIdempotent({
          userId: ctx.subject.id,
          key: idemKey,
          statusCode: 200,
          body: response,
        });
      }
      return response;
    },
    {
      detail: {
        tags: ["Attachments"],
        summary: "Add link attachment",
        requestBody: jsonBodyDetail(openApiBodies.linkAttachment),
      },
    },
  )
  .post(
    "/file",
    async ({ body, requireAuthz, request, set }) => {
      const ctx = await requireAuthz("attachment.create");
      const taskId = body.task_id;
      const name = body.name;
      const file = body.file;

      if (!taskId || !file) {
        throw ApiError.validation("task_id and file are required");
      }

      assertAllowedUploadMime(file.type);
      assertUploadSize(file.size);

      const idemKey = readIdempotencyKey(request);
      if (idemKey) {
        const { replay } = await beginIdempotent({
          userId: ctx.subject.id,
          key: idemKey,
          method: "POST",
          path: "/api/v1/attachments/file",
          body: { task_id: taskId, name, size: file.size, type: file.type },
        });
        if (replay) {
          set.status = replay.statusCode;
          return replay.body;
        }
      }

      const task = await ownedTask(ctx.subject.id, taskId);
      if (!task) throw ApiError.notFound("Task not found");

      const filename = sanitizeAttachmentFilename(
        name?.trim() || file.name || "upload",
      );
      const dbPath = buildAttachmentStoragePath(
        ctx.subject.id,
        task.id,
        filename,
      );
      const objectKey = attachmentObjectKey(dbPath);

      const bytes = await file.arrayBuffer();
      assertUploadSize(bytes.byteLength);

      const supabase = createServiceClient();
      const { error: uploadError } = await supabase.storage
        .from("attachments")
        .upload(objectKey, bytes, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });

      if (uploadError) {
        console.error("[attachments] upload failed", uploadError.message);
        throw new ApiError({
          status: 502,
          code: "DEPENDENCY_FAILURE",
          message: "Unable to store attachment",
        });
      }

      const [row] = await getDb()
        .insert(attachments)
        .values({
          taskId: task.id,
          type: "file",
          name: filename,
          storagePath: dbPath,
          url: null,
        })
        .returning();

      const response = { attachment: serializeAttachment(row) };
      if (idemKey) {
        await completeIdempotent({
          userId: ctx.subject.id,
          key: idemKey,
          statusCode: 200,
          body: response,
        });
      }
      return response;
    },
    {
      body: t.Object({
        task_id: t.String({ format: "uuid" }),
        name: t.Optional(t.String()),
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
      detail: { tags: ["Attachments"], summary: "Upload file attachment" },
    },
  )
  .delete(
    "/:id",
    async ({ params, requireAuthz }) => {
      const ctx = await requireAuthz("attachment.delete");
      const row = await ownedAttachment(ctx.subject.id, params.id);

      if (!row) throw ApiError.notFound("Attachment not found");

      if (row.attachment.type === "file" && row.attachment.storagePath) {
        const objectKey = row.attachment.storagePath.replace(
          /^attachments\//,
          "",
        );
        const supabase = createServiceClient();
        await supabase.storage.from("attachments").remove([objectKey]);
      }

      await getDb().delete(attachments).where(eq(attachments.id, params.id));

      return { ok: true };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: { tags: ["Attachments"], summary: "Remove attachment" },
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
      const { data, error } = await supabase.storage
        .from("attachments")
        .createSignedUrl(objectKey, 60 * 10);
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
      detail: { tags: ["Attachments"], summary: "Signed URL for file" },
    },
  );
