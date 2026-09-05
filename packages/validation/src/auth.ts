import { z } from "zod";

const emailSchema = z
  .string()
  .min(1, "Email is required")
  .pipe(z.email("Enter a valid email"));

/** Matches Supabase Auth's default minimum password length. */
const passwordSchema = z
  .string()
  .min(1, "Password is required")
  .min(6, "Password must be at least 6 characters");

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
