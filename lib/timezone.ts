import { z } from "zod";

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z
  .string()
  .min(1, "Timezone is required")
  .refine(isValidTimeZone, { message: "Enter a valid IANA timezone" });

export type TimezoneInput = z.infer<typeof timezoneSchema>;

/** Browser/runtime default; falls back to UTC if unavailable. */
export function detectBrowserTimeZone(): string {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return detected && isValidTimeZone(detected) ? detected : "UTC";
}
