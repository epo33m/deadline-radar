import { afterAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { render } from "@testing-library/react";

import { MARKDOWN_CORPUS } from "@deadline-radar/domain/test-fixtures/markdown-corpus";
import { MarkdownPreview } from "./markdown";

GlobalRegistrator.register();

function renderMarkdown(source: string) {
  return render(<MarkdownPreview>{source}</MarkdownPreview>);
}

describe("MarkdownPreview", () => {
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test("renders emphasis, lists, and inline code", () => {
    const { container } = renderMarkdown(
      ["**bold** and *italic* and `code`", "", "- one", "- two"].join("\n"),
    );

    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    expect(container.querySelector("code")?.textContent).toBe("code");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  test("opens external links safely and keeps in-app links internal", () => {
    const { container } = renderMarkdown(
      ["[external](https://example.com) [internal](/tasks/123)"].join("\n"),
    );
    const [external, internal] = Array.from(container.querySelectorAll("a"));

    expect(external?.getAttribute("target")).toBe("_blank");
    expect(external?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(internal?.getAttribute("href")).toBe("/tasks/123");
    expect(internal?.getAttribute("target")).toBeNull();
  });

  test("drops javascript: URLs instead of turning them into anchors", () => {
    const { container } = renderMarkdown("[click](javascript:alert(1))");

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("click");
  });

  test("never renders raw HTML", () => {
    const { container } = renderMarkdown(
      "<script>alert(1)</script><img src=x onerror=alert(2)>",
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  test("shows image alt text instead of loading the image", () => {
    const { container } = renderMarkdown("![diagram](https://example.com/x.png)");

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("diagram");
  });

  test("renders GFM tables", () => {
    const { container } = renderMarkdown(
      ["| A | B |", "| --- | --- |", "| one | two |"].join("\n"),
    );

    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelectorAll("td")).toHaveLength(2);
  });

  test("demotes author headings under the section heading", () => {
    const { container } = renderMarkdown("# Top\n\n## Second");

    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("h2")).toBeNull();
    expect(container.querySelector("h4")?.textContent).toBe("Top");
  });

  test("renders nothing for an empty description", () => {
    const { container } = render(<MarkdownPreview>{null}</MarkdownPreview>);
    expect(container.textContent).toBe("");
  });

  test("headings carry explicit styling classes", () => {
    const { container } = renderMarkdown("# Top\n\n## Second");
    const h4 = container.querySelector("h4");
    expect(h4?.className).toContain("font-semibold");
    expect(h4?.className).toContain("text-");
  });

  test("GFM task lists render disabled checkboxes with state", () => {
    const { container } = renderMarkdown("- [x] done\n- [ ] open");
    const boxes = container.querySelectorAll('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect((boxes[1] as HTMLInputElement).checked).toBe(false);
    expect((boxes[0] as HTMLInputElement).disabled).toBe(true);
  });

  test("code blocks are keyboard-scrollable", () => {
    const { container } = renderMarkdown("```ts\nconst x = 1;\n```");
    const pre = container.querySelector("pre");
    expect(pre?.getAttribute("tabindex")).toBe("0");
  });

  test("URL audit: rejects dangerous schemes and protocol-relative URLs", () => {
    const cases = [
      "[x](data:text/html,<script>alert(1)</script>)",
      "[x](vbscript:msgbox(1))",
      "[x](//evil.com)",
      "[x](java\nscript:alert(1))",
    ];
    for (const src of cases) {
      const { container } = renderMarkdown(src);
      expect(container.querySelector("a")).toBeNull();
      expect(container.textContent).toContain("x");
    }
  });

  test("golden corpus: no forbidden tags and no raw markdown markers", () => {
    const { container } = render(<MarkdownPreview>{MARKDOWN_CORPUS}</MarkdownPreview>);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("object")).toBeNull();
    expect(container.querySelector("embed")).toBeNull();
    expect(container.textContent).not.toContain("**");
    expect(container.textContent).toContain("Heading one");
    expect(container.textContent).toContain("diagram");
  });
});
