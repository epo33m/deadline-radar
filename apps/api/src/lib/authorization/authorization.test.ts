import { describe, expect, mock, test } from "bun:test";

import {
  ADMIN_CAPABILITIES,
  CAPABILITIES,
  DOMAIN_CAPABILITIES,
  createAuthorizationContext,
  findForbiddenMutationKeys,
  getCachedAuthz,
  hasCapability,
  invalidateAuthzCache,
  isAllowed,
  isCapability,
  isRoleSlug,
  requireCapability,
  resetAuthzCache,
  setCachedAuthz,
} from "./index";
import { ApiError } from "../api/errors";

// Fail-closed seam: the audit sink is down for this file, so any test that
// reaches recordAuthzDenied proves the verdict survives it.
mock.module("../auth-audit", () => ({
  recordAuthEvent: async () => {
    throw new Error("AUDIT_SINK_DOWN");
  },
}));

const subject = { id: "user-1", email: "a@example.com", sessionId: "s1" };

describe("capabilities", () => {
  test("recognizes known capability ids", () => {
    expect(isCapability("course.view")).toBe(true);
    expect(isCapability("role.assign")).toBe(true);
    expect(isCapability("canCreate")).toBe(false);
    expect(isCapability("")).toBe(false);
  });

  test("admin capabilities are not in the domain-only list", () => {
    for (const cap of ADMIN_CAPABILITIES) {
      expect(DOMAIN_CAPABILITIES.includes(cap)).toBe(false);
      expect(CAPABILITIES.includes(cap)).toBe(true);
    }
  });
});

describe("roles", () => {
  test("validates role slugs", () => {
    expect(isRoleSlug("user")).toBe(true);
    expect(isRoleSlug("admin")).toBe(true);
    expect(isRoleSlug("superadmin")).toBe(false);
  });
});

describe("isAllowed / default-deny", () => {
  const userCtx = createAuthorizationContext({
    subject,
    roles: ["user"],
    capabilities: DOMAIN_CAPABILITIES,
  });

  const adminCtx = createAuthorizationContext({
    subject,
    roles: ["user", "admin"],
    capabilities: [...DOMAIN_CAPABILITIES, ...ADMIN_CAPABILITIES],
  });

  const emptyCtx = createAuthorizationContext({
    subject,
    roles: [],
    capabilities: [],
  });

  test("allows when capability is present", () => {
    expect(isAllowed(userCtx, "course.view")).toEqual({ allowed: true });
    expect(hasCapability(userCtx, "course.create")).toBe(true);
  });

  test("denies missing capability", () => {
    expect(isAllowed(userCtx, "role.assign")).toEqual({
      allowed: false,
      reason: "missing_capability",
    });
  });

  test("denies unknown capability", () => {
    expect(isAllowed(userCtx, "inventory.item.create")).toEqual({
      allowed: false,
      reason: "unknown_capability",
    });
  });

  test("denies null context", () => {
    expect(isAllowed(null, "course.view")).toEqual({
      allowed: false,
      reason: "missing_identity",
    });
  });

  test("denies empty capabilities (fail closed)", () => {
    expect(isAllowed(emptyCtx, "course.view").allowed).toBe(false);
  });

  test("denies when policy fails even with capability", () => {
    expect(isAllowed(userCtx, "course.update", false)).toEqual({
      allowed: false,
      reason: "policy_failed",
    });
  });

  test("admin has role.assign", () => {
    expect(hasCapability(adminCtx, "role.assign")).toBe(true);
    expect(hasCapability(userCtx, "role.assign")).toBe(false);
  });

  test("context is immutable snapshot", () => {
    expect(Object.isFrozen(userCtx)).toBe(true);
    expect(Object.isFrozen(userCtx.subject)).toBe(true);
  });
});

describe("field-policy mass assignment", () => {
  test("detects forbidden ownership and role keys", () => {
    expect(
      findForbiddenMutationKeys({
        name: "Calc",
        userId: "other",
        role: "admin",
      }),
    ).toEqual(["userId", "role"]);
  });

  test("allows normal domain fields", () => {
    expect(
      findForbiddenMutationKeys({
        name: "Calc",
        code: "MATH",
        color: "#fff",
        icon: "book-open",
      }),
    ).toEqual([]);
  });

  test("ignores non-objects", () => {
    expect(findForbiddenMutationKeys(null)).toEqual([]);
    expect(findForbiddenMutationKeys("x")).toEqual([]);
  });
});

describe("authz cache", () => {
  test("keys by user id and does not collide across users", () => {
    resetAuthzCache();
    setCachedAuthz("user-a", {
      roles: ["user"],
      capabilities: ["course.view"],
    });
    setCachedAuthz("user-b", {
      roles: ["admin"],
      capabilities: ["role.assign"],
    });
    expect(getCachedAuthz("user-a")?.roles).toEqual(["user"]);
    expect(getCachedAuthz("user-b")?.roles).toEqual(["admin"]);
    invalidateAuthzCache("user-a");
    expect(getCachedAuthz("user-a")).toBeNull();
    expect(getCachedAuthz("user-b")?.capabilities).toEqual(["role.assign"]);
    resetAuthzCache();
  });

  test("ignores empty user id keys", () => {
    resetAuthzCache();
    setCachedAuthz("", {
      roles: ["admin"],
      capabilities: ["role.assign"],
    });
    expect(getCachedAuthz("")).toBeNull();
  });
});

describe("F-8 — requireCapability stays fail-closed when the audit sink throws", () => {
  const deniedCtx = createAuthorizationContext({
    subject,
    roles: ["user"],
    capabilities: [],
  });
  const allowedCtx = createAuthorizationContext({
    subject,
    roles: ["user"],
    capabilities: ["task.view"],
  });

  test("denied capability still throws 403 (not the audit error)", async () => {
    const err = await requireCapability(deniedCtx, "task.view").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).message).toBe("Forbidden");
    expect((err as ApiError).message).not.toContain("AUDIT_SINK_DOWN");
  });

  test("missing identity still throws 401 when the audit sink throws", async () => {
    const err = await requireCapability(null, "task.view").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });

  test("allowed capability returns ctx without touching audit", async () => {
    await expect(requireCapability(allowedCtx, "task.view")).resolves.toBe(
      allowedCtx,
    );
  });
});
