/**
 * `?pages=N` parsing for the server-rendered list surfaces (#141).
 *
 * The value comes straight from the URL, so it is untrusted: garbage must
 * never throw or produce an unbounded walk. Anything unparseable falls back to
 * a single page, and the ceiling is `LIST_MAX_PAGES`.
 */
import { LIST_MAX_PAGES } from "./limit";

function firstValue(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/**
 * How many pages a list surface should walk. Always within 1..LIST_MAX_PAGES.
 *
 * Only plain digits are accepted. `Number()` alone would read `1e3` as 1000 and
 * `0x10` as 16, so a crafted link could quietly ask for a walk the user never
 * navigated to; anything else falls back to a single page.
 */
export function parsePageCount(
  raw: string | string[] | undefined,
  maxPages: number = LIST_MAX_PAGES,
): number {
  const value = firstValue(raw)?.trim();
  if (!value || !/^\d+$/.test(value)) return 1;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, maxPages);
}
