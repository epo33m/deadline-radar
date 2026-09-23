import type { AuthorizationContext } from "./context";
import { isAllowed, type AuthzDenyReason } from "./decide";
import { recordAuthzDenied } from "./audit";
import { forbiddenResponse, unauthorizedResponse } from "./errors";
import type { Capability } from "./capabilities";

/**
 * Require capability on an already-authenticated AuthorizationContext.
 * Throws Response (401/403) for Elysia error handling.
 */
export async function requireCapability(
  ctx: AuthorizationContext | null | undefined,
  capability: Capability,
  options?: {
    request?: Request;
    policyOk?: boolean;
    resource?: string;
    resourceId?: string;
  },
): Promise<AuthorizationContext> {
  const decision = isAllowed(ctx, capability, options?.policyOk ?? true);

  if (decision.allowed) {
    return ctx!;
  }

  const reason: AuthzDenyReason = decision.reason;
  try {
    // Audit must never break the verdict: a throwing audit sink would
    // otherwise convert this deny into a 500 (fail-open observability).
    await recordAuthzDenied({
      ctx,
      capability,
      reason,
      resource: options?.resource,
      resourceId: options?.resourceId,
      request: options?.request,
    });
  } catch (error) {
    console.error(
      "[authz] denial audit failed",
      error instanceof Error ? error.message : "unknown",
    );
  }

  if (reason === "missing_identity") {
    unauthorizedResponse();
  }
  forbiddenResponse();
}
