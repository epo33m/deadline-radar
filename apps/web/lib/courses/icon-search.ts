/**
 * Ranked search over the course icon catalog.
 *
 * Slugs stay the source of truth (see ./icons). Labels and keywords from
 * SUGGESTED_COURSE_ICONS are indexed alongside the slug words so typing a
 * visible label ("Lab", "Math") finds its icon, and matching is separator
 * insensitive so the canonical Lucide slug "arrow-down-0-1" still finds the
 * "arrow-down01" slug Lucide exports.
 */

import {
  getAllCourseIconSlugs,
  getCourseIconLabel,
  SUGGESTED_COURSE_ICONS,
  type CourseIconSuggestion,
} from "./icons";

const DEFAULT_LIMIT = 60;
const MAX_QUERY_LENGTH = 64;

/** Curated suggestions win near-ties against the wider catalog. */
const CURATED_BOOST = 150;

type IconSearchEntry = {
  slug: string;
  label: string;
  compactSlug: string;
  slugTokens: string[];
  labelTokens: string[];
  keywordTokens: string[];
  /** Deduplicated token union, scored for prefix/contains/fuzzy matches. */
  terms: string[];
  /** Whole strings (label and keywords) for exact-phrase matches. */
  phrases: string[];
  curated: boolean;
};

export type CourseIconSearchOptions = {
  limit?: number;
};

export type CourseIconSearchResults = {
  results: CourseIconSuggestion[];
  total: number;
};

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function compactText(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function buildIndex(): IconSearchEntry[] {
  const suggestions = new Map(
    SUGGESTED_COURSE_ICONS.map((suggestion) => [suggestion.slug, suggestion]),
  );

  return getAllCourseIconSlugs().map((slug) => {
    const suggestion = suggestions.get(slug);
    const label = suggestion?.label ?? getCourseIconLabel(slug);
    const slugTokens = tokenize(slug);
    const labelTokens = tokenize(label);
    const keywordTokens = (suggestion?.keywords ?? []).flatMap(tokenize);

    return {
      slug,
      label,
      compactSlug: compactText(slug),
      slugTokens,
      labelTokens,
      keywordTokens,
      terms: unique([...slugTokens, ...labelTokens, ...keywordTokens]),
      phrases: unique([
        normalizeText(label),
        ...(suggestion?.keywords ?? []).map(normalizeText),
      ]).filter(Boolean),
      curated: Boolean(suggestion),
    };
  });
}

let cachedIndex: IconSearchEntry[] | null = null;

function getIndex(): IconSearchEntry[] {
  cachedIndex ??= buildIndex();
  return cachedIndex;
}

/** Ordered-character match used for light fuzzy hits; returns skipped chars. */
function subsequenceGaps(haystack: string, needle: string): number | null {
  let cursor = 0;
  let last = -1;

  for (const char of needle) {
    const next = haystack.indexOf(char, cursor);
    if (next === -1) return null;
    cursor = next + 1;
    last = next;
  }

  return last + 1 - needle.length;
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }

  return previous[b.length];
}

/** Score a single query token against one catalog entry; 0 means no match. */
function scoreToken(entry: IconSearchEntry, token: string): number {
  if (entry.slugTokens.includes(token)) return 760;
  if (entry.labelTokens.includes(token)) return 740;
  if (entry.keywordTokens.includes(token)) return 700;

  if (entry.terms.some((term) => term.startsWith(token))) return 620;
  if (entry.terms.some((term) => term.includes(token))) return 500;
  if (entry.compactSlug.includes(token)) return 420;

  if (token.length >= 4) {
    const maxDistance = token.length >= 7 ? 2 : 1;
    let best = Number.POSITIVE_INFINITY;

    for (const term of entry.terms) {
      if (Math.abs(term.length - token.length) > maxDistance) continue;
      const distance = editDistance(term, token);
      if (distance < best) best = distance;
      if (best === 1) break;
    }

    if (best <= maxDistance) return 260 - best * 50;
  }

  // Abbreviation-style fallback, anchored to a word start so it cannot match
  // an arbitrary scatter of letters in the middle of an unrelated word.
  if (token.length >= 3) {
    let bestGaps: number | null = null;

    for (const term of entry.terms) {
      if (term[0] !== token[0]) continue;
      const gaps = subsequenceGaps(term, token);
      if (gaps === null || gaps > 6) continue;
      if (bestGaps === null || gaps < bestGaps) bestGaps = gaps;
    }

    if (bestGaps !== null) return Math.max(200, 320 - bestGaps * 15);
  }

  return 0;
}

function scoreEntry(
  entry: IconSearchEntry,
  tokens: readonly string[],
  normalizedQuery: string,
  compactQuery: string,
): number {
  let score = entry.curated ? CURATED_BOOST : 0;

  if (entry.compactSlug === compactQuery) score += 1600;
  if (entry.phrases.includes(normalizedQuery)) score += 1400;

  for (const token of tokens) {
    const tokenScore = scoreToken(entry, token);
    if (tokenScore === 0) return 0;
    score += tokenScore;
  }

  return score;
}

function compareScored(
  a: { entry: IconSearchEntry; score: number },
  b: { entry: IconSearchEntry; score: number },
): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.entry.curated !== b.entry.curated) return a.entry.curated ? -1 : 1;
  if (a.entry.label !== b.entry.label) {
    return a.entry.label.localeCompare(b.entry.label, "en");
  }
  return a.entry.slug.localeCompare(b.entry.slug, "en");
}

/**
 * Rank catalog icons for a free-text query. Multi-word queries require every
 * token to match (in any order), so "open book" and "book open" both hit.
 * A blank query returns no results; the picker shows curated suggestions there.
 */
export function searchCourseIcons(
  query: string,
  options: CourseIconSearchOptions = {},
): CourseIconSearchResults {
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const normalizedQuery = normalizeText(query)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_QUERY_LENGTH);

  if (!normalizedQuery) return { results: [], total: 0 };

  const tokens = unique(tokenize(normalizedQuery));
  if (tokens.length === 0) return { results: [], total: 0 };

  const compactQuery = compactText(normalizedQuery);
  const scored: { entry: IconSearchEntry; score: number }[] = [];

  for (const entry of getIndex()) {
    const score = scoreEntry(entry, tokens, normalizedQuery, compactQuery);
    if (score > 0) scored.push({ entry, score });
  }

  scored.sort(compareScored);

  return {
    results: scored.slice(0, limit).map(({ entry }) => ({
      slug: entry.slug,
      label: entry.label,
    })),
    total: scored.length,
  };
}
