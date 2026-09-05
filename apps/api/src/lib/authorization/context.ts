import type { AuthUser } from "../auth-tokens";
import type { Capability } from "./capabilities";
import type { RoleSlug } from "./roles";

/**
 * Server-derived authorization context. Immutable snapshot for one request.
 * Roles and capabilities always come from trusted DB rows — never from the client.
 */
export type AuthorizationContext = Readonly<{
  subject: Readonly<AuthUser>;
  roles: readonly RoleSlug[];
  capabilities: ReadonlySet<Capability>;
  requestId: string | null;
}>;

export function createAuthorizationContext(input: {
  subject: AuthUser;
  roles: readonly RoleSlug[];
  capabilities: Iterable<Capability>;
  requestId?: string | null;
}): AuthorizationContext {
  return Object.freeze({
    subject: Object.freeze({ ...input.subject }),
    roles: Object.freeze([...input.roles]),
    capabilities: new Set(input.capabilities),
    requestId: input.requestId ?? null,
  });
}
