import { describe, expect, test } from "bun:test";

import { checkMarkers, extractInlineBlocks } from "./build-csp-hashes";

const FIXTURE = `<!DOCTYPE html><html><head>
<script src="/_next/static/chunks/app.js"></script>
<script>(self.__next_f=self.__next_f||[]).push([0])</script>
<style>body{margin:0}</style>
</head><body>
<script async src="https://example.com/x.js"></script>
<script type="application/ld+json">{"@context":"x"}</script>
</body></html>`;

describe("extractInlineBlocks", () => {
  test("collects src-less scripts, skips external ones", () => {
    const scripts = extractInlineBlocks(FIXTURE, "script");
    expect(scripts).toHaveLength(2);
    expect(scripts[0]).toBe("(self.__next_f=self.__next_f||[]).push([0])");
    expect(scripts[1]).toBe('{"@context":"x"}');
  });

  test("collects inline styles", () => {
    expect(extractInlineBlocks(FIXTURE, "style")).toEqual(["body{margin:0}"]);
  });

  test("returns empty for pages without inline blocks", () => {
    expect(extractInlineBlocks("<html><body>hi</body></html>", "script")).toEqual(
      [],
    );
  });
});

describe("checkMarkers", () => {
  test("passes when all markers are present", () => {
    expect(() =>
      checkMarkers("/", "index.html", '<a href="/login">Stay ahead of every'),
    ).not.toThrow();
  });

  test("throws when a marker is missing (bailed boundary)", () => {
    // Regression test for the 2026-09-27 outage: login.html prerendered
    // with an empty Suspense fallback (no form), which hash-CSP then made
    // permanent by blocking the streamed flight chunks.
    expect(() =>
      checkMarkers("/", "index.html", "<html><body>empty shell</body></html>"),
    ).toThrow(/missing marker/);
  });

  test("unknown pathname has no markers to check", () => {
    expect(() => checkMarkers("/nope", "x.html", "")).not.toThrow();
  });
});
