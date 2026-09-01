import { describe, expect, test } from "bun:test";
import { loginSchema, registerSchema } from "./auth";

describe("registerSchema", () => {
  test("accepts a valid email and password of at least 6 characters", () => {
    const result = registerSchema.safeParse({
      email: "student@example.com",
      password: "secret1",
    });
    expect(result.success).toBe(true);
  });

  test("rejects an invalid email", () => {
    const result = registerSchema.safeParse({
      email: "not-an-email",
      password: "secret1",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a password shorter than 6 characters", () => {
    const result = registerSchema.safeParse({
      email: "student@example.com",
      password: "short",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an empty email", () => {
    const result = registerSchema.safeParse({
      email: "",
      password: "secret1",
    });
    expect(result.success).toBe(false);
  });
});

describe("loginSchema", () => {
  test("accepts a valid email and password", () => {
    const result = loginSchema.safeParse({
      email: "student@example.com",
      password: "secret1",
    });
    expect(result.success).toBe(true);
  });

  test("rejects an invalid email", () => {
    const result = loginSchema.safeParse({
      email: "bad",
      password: "secret1",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an empty password", () => {
    const result = loginSchema.safeParse({
      email: "student@example.com",
      password: "",
    });
    expect(result.success).toBe(false);
  });
});
