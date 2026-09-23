export const ROLE_SLUGS = ["user", "admin"] as const;

export type RoleSlug = (typeof ROLE_SLUGS)[number];

export function isRoleSlug(value: string): value is RoleSlug {
  return (ROLE_SLUGS as readonly string[]).includes(value);
}

/** Stable seed UUIDs matching supabase/migrations/20260905010000_rbac.sql */
export const ROLE_IDS = {
  user: "a0000000-0000-4000-8000-000000000001",
  admin: "a0000000-0000-4000-8000-000000000002",
} as const satisfies Record<RoleSlug, string>;
