import { isCapability, type Capability } from "./capabilities";
import type { AuthorizationContext } from "./context";

export type AuthzDecision =
  | { allowed: true }
  | { allowed: false; reason: AuthzDenyReason };

export type AuthzDenyReason =
  | "missing_identity"
  | "missing_capability"
  | "unknown_capability"
  | "invalid_role"
  | "policy_failed"
  | "resource_not_owned";

/**
 * Explicit positive authorization. Default deny.
 * Unknown capability IDs are never allowed.
 */
export function isAllowed(
  ctx: AuthorizationContext | null | undefined,
  capability: string,
  policyOk: boolean = true,
): AuthzDecision {
  if (!ctx?.subject?.id) {
    return { allowed: false, reason: "missing_identity" };
  }
  if (!isCapability(capability)) {
    return { allowed: false, reason: "unknown_capability" };
  }
  if (!ctx.capabilities.has(capability as Capability)) {
    return { allowed: false, reason: "missing_capability" };
  }
  if (!policyOk) {
    return { allowed: false, reason: "policy_failed" };
  }
  return { allowed: true };
}

export function hasCapability(
  ctx: AuthorizationContext | null | undefined,
  capability: Capability,
): boolean {
  return isAllowed(ctx, capability).allowed === true;
}
