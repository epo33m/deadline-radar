import { z } from "zod";

const emailSchema = z
  .string()
  .min(1, "Email is required")
  .pipe(z.email("Enter a valid email"));

/**
 * Password policy for registration and resets.
 * Hashing / storage is owned by Supabase Auth.
 */
const passwordSchema = z
  .string()
  .min(1, "Password is required")
  .min(8, "Password must be at least 8 characters")
  .refine((value) => !/^\s+$/.test(value), {
    message: "Password cannot be only whitespace",
  })
  .refine((value) => !/^(.)\1+$/.test(value), {
    message: "Password is too weak",
  })
  .refine((value) => !/^(password|12345678|qwertyui|abcdefgh)$/i.test(value), {
    message: "Password is too weak",
  });

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    timezone: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, "Password is required"),
  })
  .strict();

export const forgotPasswordSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .strict()
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const timezoneUpdateSchema = z
  .object({
    timezone: z.string().trim().min(1, "Timezone is required").max(64),
  })
  .strict();
