/**
 * Mass-assignment / privilege-escalation field deny-list.
 * Client must never set identity, ownership, roles, or soft-delete fields.
 */

export const FORBIDDEN_MUTATION_KEYS = [
  "userId",
  "user_id",
  "ownerId",
  "owner_id",
  "role",
  "roles",
  "capability",
  "capabilities",
  "deletedAt",
  "deleted_at",
  "assignedBy",
  "assigned_by",
  "id",
] as const;

export type ForbiddenMutationKey = (typeof FORBIDDEN_MUTATION_KEYS)[number];

/**
 * Returns forbidden keys present on a raw body object.
 * Call before trusting write payloads; presence → reject (400).
 */
export function findForbiddenMutationKeys(
  body: unknown,
  options?: { allow?: readonly ForbiddenMutationKey[] },
): ForbiddenMutationKey[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return [];
  }
  const keys = Object.keys(body as Record<string, unknown>);
  const allowed = new Set<string>(options?.allow ?? []);
  return FORBIDDEN_MUTATION_KEYS.filter(
    (k) => keys.includes(k) && !allowed.has(k),
  );
}

export function assertNoForbiddenMutationKeys(
  body: unknown,
  options?: { allow?: readonly ForbiddenMutationKey[] },
): void {
  const found = findForbiddenMutationKeys(body, options);
  if (found.length > 0) {
    throw new ForbiddenFieldError(found);
  }
}

export class ForbiddenFieldError extends Error {
  readonly fields: readonly ForbiddenMutationKey[];

  constructor(fields: readonly ForbiddenMutationKey[]) {
    super("Forbidden fields in request body");
    this.name = "ForbiddenFieldError";
    this.fields = fields;
  }
}
