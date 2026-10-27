import { describe, expect, test } from "bun:test";

import { searchCourseIcons } from "./icon-search";
import {
  SUGGESTED_COURSE_ICONS,
  getAllCourseIconSlugs,
} from "./icons";

function slugs(query: string, limit = 5): string[] {
  return searchCourseIcons(query, { limit }).results.map((result) => result.slug);
}

function firstSlug(query: string): string | undefined {
  return slugs(query, 1)[0];
}

describe("course icon search", () => {
  test("matches visible suggestion labels that are aliases", () => {
    expect(firstSlug("lab")).toBe("flask-conical");
    expect(firstSlug("math")).toBe("calculator");
    expect(firstSlug("health")).toBe("heart-pulse");
    expect(firstSlug("writing")).toBe("pen-line");
    expect(firstSlug("art")).toBe("palette");
  });

  test("matches curated keywords and synonyms", () => {
    expect(firstSlug("gym")).toBe("dumbbell");
    expect(firstSlug("sport")).toBe("dumbbell");
    expect(firstSlug("graduation")).toBe("graduation-cap");
    expect(slugs("science", 3)).toContain("flask-conical");
  });

  test("ranks exact labels above incidental substrings", () => {
    // "art" is a substring of earth/heart and a prefix of arrow; palette wins.
    expect(firstSlug("art")).toBe("palette");
    expect(slugs("art", 10)).toContain("palette");
  });

  test("matches multi-word queries in any order", () => {
    expect(firstSlug("book open")).toBe("book-open");
    expect(firstSlug("open book")).toBe("book-open");
    expect(firstSlug("alarm clock")).toBe("alarm-clock");
  });

  test("treats separators in canonical slugs as equivalent", () => {
    expect(firstSlug("arrow-down-0-1")).toBe("arrow-down01");
    expect(firstSlug("arrow-down01")).toBe("arrow-down01");
    expect(firstSlug("grid-2x2")).toBe("grid2x2");
    expect(firstSlug("grid2x2")).toBe("grid2x2");
  });

  test("tolerates small typos", () => {
    expect(firstSlug("graduaton")).toBe("graduation-cap");
    expect(firstSlug("calender")).toBe("calendar");
  });

  test("limits results but reports the full total", () => {
    const capped = searchCourseIcons("arrow", { limit: 5 });
    expect(capped.results).toHaveLength(5);
    expect(capped.total).toBeGreaterThan(5);

    const all = searchCourseIcons("arrow", { limit: 2000 });
    expect(all.results).toHaveLength(all.total);
  });

  test("is deterministic", () => {
    expect(slugs("arrow", 20)).toEqual(slugs("arrow", 20));
  });

  test("returns nothing for a blank query", () => {
    expect(searchCourseIcons("").results).toHaveLength(0);
    expect(searchCourseIcons("   ").total).toBe(0);
    expect(searchCourseIcons("---").total).toBe(0);
  });

  test("reports no matches instead of fuzzy noise", () => {
    expect(searchCourseIcons("zzzzzz")).toEqual({ results: [], total: 0 });
  });

  test("every suggestion is reachable by its label and keywords", () => {
    for (const suggestion of SUGGESTED_COURSE_ICONS) {
      const terms = [suggestion.label, ...(suggestion.keywords ?? [])];

      for (const term of terms) {
        expect(`${term} → ${slugs(term, 3).join(",")}`).toContain(
          suggestion.slug,
        );
      }
    }
  });

  test("every catalog slug is its own top search result", () => {
    for (const slug of getAllCourseIconSlugs()) {
      const result = searchCourseIcons(slug, { limit: 1 });
      expect(result.results[0]?.slug, `top result for "${slug}"`).toBe(slug);
    }
  });
});
