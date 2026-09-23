import { describe, expect, test } from "bun:test";
import {
  forgotPasswordSchema,
  isValidTimeZone,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  timeFormatUpdateSchema,
  timezoneUpdateSchema,
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

describe("timeFormatUpdateSchema", () => {
  test("accepts 24h", () => {
    expect(timeFormatUpdateSchema.safeParse({ timeFormat: "24h" }).success).toBe(
      true,
    );
  });

  test("accepts 12h", () => {
    expect(timeFormatUpdateSchema.safeParse({ timeFormat: "12h" }).success).toBe(
      true,
    );
  });

  test("rejects an unknown format", () => {
    expect(
      timeFormatUpdateSchema.safeParse({ timeFormat: "AM" }).success,
    ).toBe(false);
  });

  test("rejects an empty format", () => {
    expect(timeFormatUpdateSchema.safeParse({ timeFormat: "" }).success).toBe(
      false,
    );
  });

  test("rejects a missing format", () => {
    expect(timeFormatUpdateSchema.safeParse({}).success).toBe(false);
  });

  test("rejects unknown keys", () => {
    expect(
      timeFormatUpdateSchema.safeParse({ timeFormat: "24h", userId: "user-1" })
        .success,
    ).toBe(false);
  });
});

describe("timezoneUpdateSchema & isValidTimeZone (L-5)", () => {
  test("accepts valid IANA timezones", () => {
    expect(timezoneUpdateSchema.safeParse({ timezone: "Asia/Jakarta" }).success).toBe(true);
    expect(timezoneUpdateSchema.safeParse({ timezone: "UTC" }).success).toBe(true);
    expect(timezoneUpdateSchema.safeParse({ timezone: "America/New_York" }).success).toBe(true);
  });

  test("rejects invalid timezone names", () => {
    expect(timezoneUpdateSchema.safeParse({ timezone: "Invalid/Timezone" }).success).toBe(false);
    expect(timezoneUpdateSchema.safeParse({ timezone: "NotATimezone" }).success).toBe(false);
  });

  test("rejects empty or whitespace timezone", () => {
    expect(timezoneUpdateSchema.safeParse({ timezone: "" }).success).toBe(false);
    expect(timezoneUpdateSchema.safeParse({ timezone: "   " }).success).toBe(false);
  });

  test("rejects unknown keys", () => {
    expect(
      timezoneUpdateSchema.safeParse({ timezone: "UTC", email: "new@example.com" }).success,
    ).toBe(false);
  });
});

