import { describe, expect, test } from "bun:test";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "./auth";

describe("registerSchema", () => {
  test("accepts a valid email and password of at least 8 characters", () => {
    const result = registerSchema.safeParse({
      email: "student@example.com",
      password: "secret12",
    });
    expect(result.success).toBe(true);
  });

  test("rejects an invalid email", () => {
    const result = registerSchema.safeParse({
      email: "not-an-email",
      password: "secret12",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a password shorter than 8 characters", () => {
    const result = registerSchema.safeParse({
      email: "student@example.com",
      password: "short1",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a repeated-character weak password", () => {
    const result = registerSchema.safeParse({
      email: "student@example.com",
      password: "aaaaaaaa",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an empty email", () => {
    const result = registerSchema.safeParse({
      email: "",
      password: "secret12",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.email?.[0]).toBe(
        "Email is required",
      );
    }
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

describe("forgotPasswordSchema", () => {
  test("accepts a valid email", () => {
    const result = forgotPasswordSchema.safeParse({
      email: "student@example.com",
    });
    expect(result.success).toBe(true);
  });

  test("rejects an invalid email", () => {
    const result = forgotPasswordSchema.safeParse({ email: "bad" });
    expect(result.success).toBe(false);
  });

  test("rejects an empty email", () => {
    const result = forgotPasswordSchema.safeParse({ email: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.email?.[0]).toBe(
        "Email is required",
      );
    }
  });
});

describe("resetPasswordSchema", () => {
  test("accepts matching passwords of at least 8 characters", () => {
    const result = resetPasswordSchema.safeParse({
      password: "secret12",
      confirmPassword: "secret12",
    });
    expect(result.success).toBe(true);
  });

  test("rejects mismatched passwords", () => {
    const result = resetPasswordSchema.safeParse({
      password: "secret12",
      confirmPassword: "secret99",
    });
    expect(result.success).toBe(false);
  });

  test("rejects passwords shorter than 8 characters", () => {
    const result = resetPasswordSchema.safeParse({
      password: "short1",
      confirmPassword: "short1",
    });
    expect(result.success).toBe(false);
  });
});
