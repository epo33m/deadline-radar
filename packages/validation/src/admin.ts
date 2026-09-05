import { z } from "zod";

export const roleAssignSchema = z
  .object({
    user_id: z.uuid("User id is required"),
    role_slug: z.string().trim().min(1, "Role is required").max(64),
  })
  .strict();

export const roleRevokeSchema = roleAssignSchema;

export type RoleAssignInput = z.infer<typeof roleAssignSchema>;
