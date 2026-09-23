import { z } from "zod";

export type TimezoneMode = "automatic" | "manual";

export const TIMEZONE_MODE_STORAGE_KEY = "deadline-radar.timezone-mode";

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
  .refine(isValidTimeZone, { message: "Enter a valid timezone" });

export type TimezoneInput = z.infer<typeof timezoneSchema>;

/** Browser/runtime default; falls back to UTC if unavailable. */
export function detectBrowserTimeZone(): string {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return detected && isValidTimeZone(detected) ? detected : "UTC";
}

/** Sorted unique IANA identifiers available in the runtime. */
export function listTimeZones(): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  const zones = new Set<string>(supported);
  zones.add("UTC");
  return [...zones].sort((a, b) => a.localeCompare(b));
}

/**
 * Formats a timezone's UTC offset as `GMT±HH:MM` for the given instant.
 */
export function formatUtcOffset(timeZone: string, at = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(at);
  const raw = parts.find((part) => part.type === "timeZoneName")?.value;

  if (!raw) return "GMT+00:00";
  if (raw === "GMT" || raw === "UTC") return "GMT+00:00";

  const match = raw.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (!match) return raw;

  const sign = match[1] ?? "+";
  const hours = (match[2] ?? "0").padStart(2, "0");
  const minutes = (match[3] ?? "00").padStart(2, "0");
  return `GMT${sign}${hours}:${minutes}`;
}

export function searchTimeZones(
  query: string,
  catalog: string[] = listTimeZones(),
  at = new Date(),
): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return catalog;

  return catalog.filter((zone) => {
    if (zone.toLowerCase().includes(normalized)) return true;
    return formatUtcOffset(zone, at).toLowerCase().includes(normalized);
  });
}

export function parseTimezoneMode(value: string | null | undefined): TimezoneMode {
  return value === "automatic" ? "automatic" : "manual";
}

export function resolveTimezoneForSave(input: {
  mode: TimezoneMode;
  selectedZone: string;
  browserZone: string;
}): string {
  return input.mode === "automatic" ? input.browserZone : input.selectedZone;
}

export function readStoredTimezoneMode(): TimezoneMode {
  if (typeof window === "undefined") return "manual";
  try {
    return parseTimezoneMode(window.localStorage.getItem(TIMEZONE_MODE_STORAGE_KEY));
  } catch {
    return "manual";
  }
}

export function writeStoredTimezoneMode(mode: TimezoneMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TIMEZONE_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore quota / private-mode failures; mode is display-only.
  }
}
