import { describe, expect, test } from "bun:test";

import { checkRoutes } from "./verify-routes";

describe("checkRoutes", () => {
  test("passes on the expected manifest shape", () => {
    expect(checkRoutes({ "/": {}, "/_not-found": {} })).toEqual([]);
  });

  test("fails when a dynamic auth page prerenders (2026-09-27 outage)", () => {
    const violations = checkRoutes({ "/": {}, "/login": {} });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("/login");
    expect(violations[0]).toContain("force-dynamic");
  });

  test("fails when the landing page is not prerendered", () => {
    const violations = checkRoutes({ "/login": {} });
    expect(violations.some((v) => v.includes("expected static"))).toBe(true);
  });
});
