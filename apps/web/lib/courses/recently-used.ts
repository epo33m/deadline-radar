/**
 * Recently used course icons, persisted to localStorage.
 *
 * Mirrors the safe read/write pattern in lib/timezone.ts: tolerant of private
 * mode / quota errors, no-op outside the browser, and never throws.
 */

export const RECENTLY_USED_ICONS_STORAGE_KEY =
  "deadline-radar.recently-used-icons";

const RECENT_LIMIT = 8;

export function readRecentlyUsedIcons(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTLY_USED_ICONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

export function writeRecentlyUsedIcons(slugs: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      RECENTLY_USED_ICONS_STORAGE_KEY,
      JSON.stringify(slugs.slice(0, RECENT_LIMIT)),
    );
  } catch {
    // Ignore quota / private-mode failures; recents are a nicety, not critical.
  }
}

/** Add a slug to the front of the recents list, deduplicating. */
export function addRecentlyUsedIcon(slug: string): void {
  if (!slug) return;
  const current = readRecentlyUsedIcons();
  const updated = [slug, ...current.filter((s) => s !== slug)];
  writeRecentlyUsedIcons(updated);
}
