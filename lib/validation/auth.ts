import { z } from "zod";

/** Matches Supabase Auth's default minimum password length. */
const passwordSchema = z.string().min(6, "Password must be at least 6 characters");

export const registerSchema = z.object({
  email: z.email("Enter a valid email"),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
