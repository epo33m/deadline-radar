/**
 * Stable capability identifiers — single source of truth for type-safe references.
 * Unknown capability strings are never treated as granted (fail closed).
 */

export const CAPABILITIES = [
  "course.view",
  "course.create",
  "course.update",
  "course.archive",
  "task.view",
  "task.create",
  "task.update",
  "task.archive",
  "threshold.manage",
  "attachment.create",
  "attachment.delete",
  "attachment.signed-url",
  "notification.view",
  "notification.mark-read",
  "profile.view",
  "profile.timezone.update",
  "profile.password.update",
  "profile.email.update",
  "role.assign",
  "role.revoke",
  "audit.view",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set(CAPABILITIES);

export function isCapability(value: string): value is Capability {
  return CAPABILITY_SET.has(value);
}

/** Domain capabilities granted to both `user` and `admin` roles. */
export const DOMAIN_CAPABILITIES: readonly Capability[] = [
  "course.view",
  "course.create",
  "course.update",
  "course.archive",
  "task.view",
  "task.create",
  "task.update",
  "task.archive",
  "threshold.manage",
  "attachment.create",
  "attachment.delete",
  "attachment.signed-url",
  "notification.view",
  "notification.mark-read",
  "profile.view",
  "profile.timezone.update",
  "profile.password.update",
  "profile.email.update",
] as const;

/** Admin-only capabilities. */
export const ADMIN_CAPABILITIES: readonly Capability[] = [
  "role.assign",
  "role.revoke",
  "audit.view",
] as const;
