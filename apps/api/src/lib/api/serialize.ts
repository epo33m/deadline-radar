/** Public API DTOs — never return raw DB rows from handlers without going through these. */

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
  description: string | null;
  deadline: Date | string;
  status: string;
  estimatedDuration: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
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
    description: row.description,
    deadline: iso(row.deadline)!,
    status: row.status,
    estimatedDuration: row.estimatedDuration,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
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
  name: string;
  storagePath: string | null;
  url: string | null;
  createdAt: Date | string;
};

export function serializeAttachment(row: AttachmentRow) {
  return {
    id: row.id,
    taskId: row.taskId,
    type: row.type,
    name: row.name,
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
};

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
