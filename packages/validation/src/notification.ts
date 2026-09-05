import { z } from "zod";

export const markNotificationReadSchema = z.object({
  id: z.string().trim().min(1, "Notification id is required"),
});

export type MarkNotificationReadInput = z.infer<
  typeof markNotificationReadSchema
>;
