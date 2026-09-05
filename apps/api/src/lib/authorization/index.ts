export { CAPABILITIES, DOMAIN_CAPABILITIES, ADMIN_CAPABILITIES, isCapability } from "./capabilities";
export type { Capability } from "./capabilities";

export { ROLE_SLUGS, ROLE_IDS, isRoleSlug } from "./roles";
export type { RoleSlug } from "./roles";

export { createAuthorizationContext } from "./context";
export type { AuthorizationContext } from "./context";

export { isAllowed, hasCapability } from "./decide";
export type { AuthzDecision, AuthzDenyReason } from "./decide";

export {
  ownedCourse,
  ownedTask,
  ownedAttachment,
  ownedAttachmentByStoragePath,
  setOwnershipOverrides,
} from "./ownership";

export {
  FORBIDDEN_MUTATION_KEYS,
  findForbiddenMutationKeys,
  assertNoForbiddenMutationKeys,
  ForbiddenFieldError,
} from "./field-policy";

export { AUTHZ_ERRORS, unauthorizedResponse, forbiddenResponse } from "./errors";

export { recordAuthzDenied, recordRoleChange } from "./audit";

export { loadAuthorizationContext, setLoadAuthorizationContextOverride } from "./load";

export {
  getCachedAuthz,
  setCachedAuthz,
  invalidateAuthzCache,
  resetAuthzCache,
  setAuthzCacheTtlMs,
} from "./cache";

export { withUserRls } from "./rls-context";

export { requireCapability } from "./guard";
