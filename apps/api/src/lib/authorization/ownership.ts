import { and, eq, isNull } from "drizzle-orm";
import { attachments, courses, tasks } from "@deadline-radar/db";

import { withUserRls } from "./rls-context";

type CourseRow = typeof courses.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
type AttachmentRow = typeof attachments.$inferSelect;

type OwnedAttachmentRow = {
  attachment: AttachmentRow;
  taskUserId: string;
};

type OwnershipOverrides = {
  ownedCourse?: (
    userId: string,
    courseId: string,
  ) => Promise<CourseRow | null>;
  ownedTask?: (userId: string, taskId: string) => Promise<TaskRow | null>;
  ownedAttachment?: (
    userId: string,
    attachmentId: string,
  ) => Promise<OwnedAttachmentRow | null>;
  ownedAttachmentByStoragePath?: (
    userId: string,
    storagePath: string,
  ) => Promise<OwnedAttachmentRow | null>;
};

const ownershipOverrides: OwnershipOverrides = {};

/** Test-only ownership stubs. */
export function setOwnershipOverrides(
  overrides: OwnershipOverrides | null,
): void {
  ownershipOverrides.ownedCourse = overrides?.ownedCourse;
  ownershipOverrides.ownedTask = overrides?.ownedTask;
  ownershipOverrides.ownedAttachment = overrides?.ownedAttachment;
  ownershipOverrides.ownedAttachmentByStoragePath =
    overrides?.ownedAttachmentByStoragePath;
}

export async function ownedCourse(
  userId: string,
  courseId: string,
): Promise<CourseRow | null> {
  if (ownershipOverrides.ownedCourse) {
    return ownershipOverrides.ownedCourse(userId, courseId);
  }
  return withUserRls(userId, async (tx) => {
    const [row] = await tx
      .select()
      .from(courses)
      .where(
        and(
          eq(courses.id, courseId),
          eq(courses.userId, userId),
          isNull(courses.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  });
}

export async function ownedTask(
  userId: string,
  taskId: string,
): Promise<TaskRow | null> {
  if (ownershipOverrides.ownedTask) {
    return ownershipOverrides.ownedTask(userId, taskId);
  }
  return withUserRls(userId, async (tx) => {
    const [row] = await tx
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  });
}

/** Attachment row only if the parent task is owned by userId. */
export async function ownedAttachment(
  userId: string,
  attachmentId: string,
): Promise<OwnedAttachmentRow | null> {
  if (ownershipOverrides.ownedAttachment) {
    return ownershipOverrides.ownedAttachment(userId, attachmentId);
  }
  return withUserRls(userId, async (tx) => {
    const [row] = await tx
      .select({
        attachment: attachments,
        taskUserId: tasks.userId,
      })
      .from(attachments)
      .innerJoin(tasks, eq(attachments.taskId, tasks.id))
      .where(and(eq(attachments.id, attachmentId), eq(tasks.userId, userId)))
      .limit(1);
    return row ?? null;
  });
}

/**
 * File attachment owned by user with exact storage_path match.
 * Used for signed-URL authorization (path prefix alone is insufficient).
 */
export async function ownedAttachmentByStoragePath(
  userId: string,
  storagePath: string,
): Promise<OwnedAttachmentRow | null> {
  if (ownershipOverrides.ownedAttachmentByStoragePath) {
    return ownershipOverrides.ownedAttachmentByStoragePath(userId, storagePath);
  }
  return withUserRls(userId, async (tx) => {
    const [row] = await tx
      .select({
        attachment: attachments,
        taskUserId: tasks.userId,
      })
      .from(attachments)
      .innerJoin(tasks, eq(attachments.taskId, tasks.id))
      .where(
        and(
          eq(attachments.storagePath, storagePath),
          eq(tasks.userId, userId),
          eq(attachments.type, "file"),
        ),
      )
      .limit(1);
    return row ?? null;
  });
}
