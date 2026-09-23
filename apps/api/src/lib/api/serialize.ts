/** Public API DTOs — never return raw DB rows from handlers without going through these. */

import {
  REMINDER_LATE_AFTER_MS,
  thresholdTriggerAt,
} from "@deadline-radar/domain";

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

export type CourseRow = {
  id: string;
  userId: string;
  name: string;
  code: string | null;
  color: string | null;
  icon: string | null;
  description: string | null;
  createdAt: Date | string;
  updatedAt?: Date | string | null;
  deletedAt?: Date | string | null;
};

export function serializeCourse(row: CourseRow) {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    code: row.code,
    color: row.color,
    icon: row.icon,
    description: row.description,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt ?? row.createdAt),
    deletedAt: iso(row.deletedAt ?? null),
  };
}

export type TaskRow = {
  id: string;
  userId: string;
  courseId: string;
  title: string;
  /** Absent in slim list projections (`serializeTaskList`); present otherwise. */
  description?: string | null;
  deadline: Date | string;
  status: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  completedAt?: Date | string | null;
  deletedAt?: Date | string | null;
  courseName?: string | null;
  courseColor?: string | null;
};

export function serializeTask(row: TaskRow) {
  const base = {
    id: row.id,
    userId: row.userId,
    courseId: row.courseId,
    title: row.title,
    description: row.description ?? null,
    deadline: iso(row.deadline)!,
    status: row.status,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
    completedAt: iso(row.completedAt ?? null),
    deletedAt: iso(row.deletedAt ?? null),
  };
  if (row.courseName !== undefined || row.courseColor !== undefined) {
    return {
      ...base,
      courseName: row.courseName ?? null,
      courseColor: row.courseColor ?? null,
    };
  }
  return base;
}

/**
 * Slim list projection: everything the list/calendar UI renders, minus
 * `description` (unbounded text × N rows). Detail + write paths keep the
 * full {@link serializeTask} shape.
 */
export function serializeTaskList(row: TaskRow) {
  const { description: _omitted, ...rest } = serializeTask(row);
  return rest;
}

export type ThresholdRow = {
  id: string;
  taskId: string;
  daysBefore: number;
  isDefault: boolean;
  createdAt: Date | string;
};

export function serializeThreshold(row: ThresholdRow) {
  return {
    id: row.id,
    taskId: row.taskId,
    daysBefore: row.daysBefore,
    isDefault: row.isDefault,
    createdAt: iso(row.createdAt)!,
  };
}

export type AttachmentRow = {
  id: string;
  taskId: string;
  type: string;
  notes: string | null;
  storagePath: string | null;
  url: string | null;
  createdAt: Date | string;
};

export function serializeAttachment(row: AttachmentRow) {
  return {
    id: row.id,
    taskId: row.taskId,
    type: row.type,
    notes: row.notes,
    storagePath: row.storagePath,
    url: row.url,
    createdAt: iso(row.createdAt)!,
  };
}

export type NotificationRow = {
  id: string;
  taskId: string;
  thresholdId: string;
  channel: string;
  status: string;
  retryCount: number;
  sentAt: Date | string | null;
  readAt: Date | string | null;
  createdAt: Date | string;
  taskTitle?: string | null;
  daysBefore?: number | null;
  /** RF-11: current task deadline (UTC instant of the local deadline). */
  taskDeadline?: Date | string | null;
  /** RF-11: recipient profile timezone, needed to derive the trigger instant. */
  timeZone?: string | null;
};

/**
 * RF-11: the email path freezes a `late` label into the body at first attempt.
 * In-app notifications have no body, so the same label is derived on read:
 * the delivery is "late" when its sent time was at least
 * REMINDER_LATE_AFTER_MS after the (timezone-aware) trigger instant for the
 * reminder offset. Absent inputs → not late.
 */
export function notificationIsLate(row: NotificationRow): boolean {
  if (
    !row.sentAt ||
    row.daysBefore == null ||
    !row.taskDeadline ||
    !row.timeZone
  ) {
    return false;
  }
  const trigger = thresholdTriggerAt(
    new Date(row.taskDeadline).toISOString(),
    row.daysBefore,
    row.timeZone,
  );
  return (
    new Date(row.sentAt).getTime() - trigger.getTime() >= REMINDER_LATE_AFTER_MS
  );
}

export function serializeNotification(row: NotificationRow) {
  return {
    id: row.id,
    taskId: row.taskId,
    thresholdId: row.thresholdId,
    channel: row.channel,
    status: row.status,
    retryCount: row.retryCount,
    sentAt: iso(row.sentAt),
    readAt: iso(row.readAt),
    createdAt: iso(row.createdAt)!,
    taskTitle: row.taskTitle ?? null,
    daysBefore: row.daysBefore ?? null,
    isLate: notificationIsLate(row),
  };
}

export function serializeAuditEvent(row: {
  id: string;
  event: string;
  userId: string | null;
  sessionId: string | null;
  result: string;
  method: string | null;
  ip: string | null;
  userAgent?: string | null;
  requestId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date | string;
}) {
  return {
    id: row.id,
    event: row.event,
    userId: row.userId,
    sessionId: row.sessionId,
    result: row.result,
    method: row.method,
    ip: row.ip,
    userAgent: row.userAgent ?? null,
    requestId: row.requestId,
    metadata: row.metadata,
    createdAt: iso(row.createdAt)!,
  };
}
