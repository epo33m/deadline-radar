import { describe, expect, test } from "bun:test";

import { MARKDOWN_CORPUS } from "./test-fixtures/markdown-corpus";
import { stripMarkdown } from "./plain-text";

describe("stripMarkdown", () => {
  test("drops block markers", () => {
    const input = [
      "# Heading",
      "",
      "> quoted line",
      "",
      "- first item",
      "- [ ] open task",
      "1. numbered",
      "",
      "---",
    ].join("\n");

    expect(stripMarkdown(input)).toBe(
      ["Heading", "", "quoted line", "", "first item", "open task", "numbered"].join("\n"),
    );
  });

  test("drops inline markers", () => {
    expect(stripMarkdown("**bold** and *italic* and ~~gone~~ and `code`")).toBe(
      "bold and italic and gone and code",
    );
    expect(stripMarkdown("[label](https://example.com) ![alt text](x.png)")).toBe(
      "label alt text",
    );
    expect(stripMarkdown("keep \\*literal\\* asterisks")).toBe(
      "keep *literal* asterisks",
    );
  });

  test("keeps fenced code content", () => {
    expect(stripMarkdown(["```ts", "const **not** = 1;", "```"].join("\n"))).toBe(
      "const **not** = 1;",
    );
  });

  test("flattens GFM tables into words", () => {
    const input = ["| A | B |", "| --- | --- |", "| one | two |"].join("\n");
    expect(stripMarkdown(input)).toBe("A B\none two");
  });

  test("is safe for empty input and collapses blank runs", () => {
    expect(stripMarkdown(null)).toBe("");
    expect(stripMarkdown(undefined)).toBe("");
    expect(stripMarkdown("")).toBe("");
    expect(stripMarkdown("a\n\n\n\nb")).toBe("a\n\nb");
  });

  test("never leaves a list marker at the start of a preview", () => {
    expect(stripMarkdown("- item")).toBe("item");
    expect(stripMarkdown("* item")).toBe("item");
  });

  test("golden corpus: strip removes every syntax marker", () => {
    const stripped = stripMarkdown(MARKDOWN_CORPUS);
    expect(stripped).not.toContain("**");
    expect(stripped).not.toContain("~~");
    expect(stripped).not.toContain("`");
    expect(stripped).not.toContain("](");
    expect(stripped).not.toContain("# Heading");
    expect(stripped).not.toContain("|");
    expect(stripped).not.toContain("<script");
    expect(stripped).not.toContain("---");
    expect(stripped).toContain("Heading one");
    expect(stripped).toContain("bold");
    expect(stripped).toContain("answer = 42");
  });
});
