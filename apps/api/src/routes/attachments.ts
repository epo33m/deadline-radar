import { Elysia, t } from "elysia";
import { and, eq, isNull } from "drizzle-orm";
import {
  attachmentObjectKey,
  buildAttachmentStoragePath,
  linkAttachmentSchema,
  sanitizeAttachmentFilename,
} from "@deadline-radar/validation";
import { attachments, tasks } from "@deadline-radar/db";

import { authPlugin } from "../plugins/auth";
import { getDb } from "../lib/db";
import { createServiceClient } from "../lib/supabase";

async function ownedTask(userId: string, taskId: string) {
  const [row] = await getDb()
    .select()
    .from(tasks)
    .where(
      and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)),
    )
    .limit(1);
  return row ?? null;
}

export const attachmentRoutes = new Elysia({ prefix: "/api/attachments" })
  .use(authPlugin)
  .post(
    "/link",
    async ({ body, requireUser, set }) => {
      const user = requireUser();
      const parsed = linkAttachmentSchema.safeParse({
        name: body.name,
        url: body.url,
      });
      if (!parsed.success) {
        set.status = 400;
        return {
          error: "Invalid link attachment",
          fieldErrors: parsed.error.flatten().fieldErrors,
        };
      }
      const task = await ownedTask(user.id, body.task_id);
      if (!task) {
        set.status = 404;
        return { error: "Task not found" };
      }
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
      return { attachment: row };
    },
    {
      body: t.Object({
        task_id: t.String(),
        name: t.String(),
        url: t.String(),
      }),
      detail: { tags: ["Attachments"], summary: "Add link attachment" },
    },
  )
  .post(
    "/file",
    async ({ body, requireUser, set }) => {
      const user = requireUser();
      const taskId = body.task_id;
      const name = body.name;
      const file = body.file;

      if (!taskId || !file) {
        set.status = 400;
        return { error: "task_id and file are required" };
      }

      const task = await ownedTask(user.id, taskId);
      if (!task) {
        set.status = 404;
        return { error: "Task not found" };
      }

      const filename = sanitizeAttachmentFilename(
        name?.trim() || file.name || "upload",
      );
      const dbPath = buildAttachmentStoragePath(user.id, task.id, filename);
      const objectKey = attachmentObjectKey(dbPath);

      const bytes = await file.arrayBuffer();
      const supabase = createServiceClient();
      const { error: uploadError } = await supabase.storage
        .from("attachments")
        .upload(objectKey, bytes, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });

      if (uploadError) {
        set.status = 400;
        return { error: uploadError.message };
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

      return { attachment: row };
    },
    {
      body: t.Object({
        task_id: t.String(),
        name: t.Optional(t.String()),
        file: t.File(),
      }),
      detail: { tags: ["Attachments"], summary: "Upload file attachment" },
    },
  )
  .delete(
    "/:id",
    async ({ params, requireUser, set }) => {
      const user = requireUser();
      const [row] = await getDb()
        .select({
          attachment: attachments,
          taskUserId: tasks.userId,
        })
        .from(attachments)
        .innerJoin(tasks, eq(attachments.taskId, tasks.id))
        .where(and(eq(attachments.id, params.id), eq(tasks.userId, user.id)))
        .limit(1);

      if (!row) {
        set.status = 404;
        return { error: "Attachment not found" };
      }

      if (row.attachment.type === "file" && row.attachment.storagePath) {
        const objectKey = row.attachment.storagePath.replace(
          /^attachments\//,
          "",
        );
        const supabase = createServiceClient();
        await supabase.storage.from("attachments").remove([objectKey]);
      }

      await getDb()
        .delete(attachments)
        .where(eq(attachments.id, params.id));

      return { ok: true };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ["Attachments"], summary: "Remove attachment" },
    },
  )
  .get(
    "/signed-url",
    async ({ query, requireUser, set }) => {
      const user = requireUser();
      const storagePath = query.storage_path;
      if (!storagePath?.startsWith(`attachments/${user.id}/`)) {
        set.status = 403;
        return { error: "Forbidden" };
      }
      const objectKey = storagePath.replace(/^attachments\//, "");
      const supabase = createServiceClient();
      const { data, error } = await supabase.storage
        .from("attachments")
        .createSignedUrl(objectKey, 60 * 10);
      if (error || !data?.signedUrl) {
        set.status = 400;
        return { error: error?.message ?? "Unable to create signed URL" };
      }
      return { url: data.signedUrl };
    },
    {
      query: t.Object({ storage_path: t.String() }),
      detail: { tags: ["Attachments"], summary: "Signed URL for file" },
    },
  );
