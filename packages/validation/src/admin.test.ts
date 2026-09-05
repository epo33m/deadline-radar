import { describe, expect, test } from "bun:test";
import { roleAssignSchema } from "./admin";

describe("roleAssignSchema", () => {
  test("accepts valid payload", () => {
    const parsed = roleAssignSchema.safeParse({
      user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      role_slug: "admin",
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects unknown fields", () => {
    const parsed = roleAssignSchema.safeParse({
      user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      role_slug: "admin",
      isSuper: true,
    });
    expect(parsed.success).toBe(false);
  });
});
