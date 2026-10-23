"use client";

import type { ComponentProps } from "react";
import { memo, useMemo, useState, useId } from "react";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Markdown preview for the two description fields (task, course).
 *
 * Safety model: `react-markdown` builds React elements, never HTML strings, so
 * there is no `dangerouslySetInnerHTML` path. Raw HTML in the source is not
 * rendered (no `rehype-raw`), and every URL goes through `safeUrl`/`safeImageUrl`,
 * which allows only http(s), mailto, in-app paths, blob:, and data:image. Images
 * render for same-origin/blob/data only; external images render as alt text,
 * matching the CSP `img-src 'self' blob: data:` policy. Author headings are
 * demoted so the page outline still starts at the section level, and each
 * heading gets a per-instance id so in-description `#anchor` links work.
 */
const ALLOWED_ELEMENTS = [
  "p",
  "br",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "img",
  "input",
  "span",
] as const;

const bodyTextClassName = "text-[15px] leading-relaxed text-ink sm:text-[17px]";

type WithNode<T> = T & { node?: unknown };

type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function splitNode<T extends { node?: unknown }>(props: T): Omit<T, "node"> {
  const rest = { ...props };
  delete (rest as { node?: unknown }).node;
  return rest;
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return slug || "section";
}

function safeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed || /[\u0000-\u001F\u007F]/.test(trimmed)) return "";
  if (trimmed.startsWith("//")) return "";
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
  if (/^(?:https?:|mailto:)/i.test(trimmed)) return trimmed;
  return "";
}

function safeImageUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed || /[\u0000-\u001F\u007F]/.test(trimmed)) return "";
  if (trimmed.startsWith("//")) return "";
  if (trimmed.startsWith("/")) return trimmed;
  if (/^blob:/i.test(trimmed)) return trimmed;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  return "";
}

function MarkdownLink(props: WithNode<ComponentProps<"a">>) {
  const { href, children } = props;
  const url = typeof href === "string" ? safeUrl(href) : "";
  const rest = splitNode(props);
  delete (rest as { href?: string }).href;
  delete (rest as { children?: unknown }).children;

  if (!url) return <span {...rest}>{children}</span>;

  const internal = url.startsWith("/") || url.startsWith("#");
  return (
    <a
      {...rest}
      href={url}
      {...(internal ? {} : { target: "_blank", rel: "noopener noreferrer" })}
      className="break-words rounded-sm text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </a>
  );
}

function MarkdownImage(props: WithNode<ComponentProps<"img">>) {
  const { src, alt } = props;
  const url = typeof src === "string" ? safeImageUrl(src) : "";
  const [errored, setErrored] = useState(false);

  if (!url) {
    return alt ? <span className="text-ink-muted-64 italic">{alt}</span> : null;
  }
  if (errored) {
    return alt ? <span className="text-ink-muted-64 italic">{alt}</span> : null;
  }

  const rest = splitNode(props);
  delete (rest as { src?: string }).src;
  delete (rest as { alt?: string }).alt;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...rest}
      src={url}
      alt={alt ?? ""}
      loading="lazy"
      decoding="async"
      onError={() => setErrored(true)}
      className="max-w-full rounded-md"
    />
  );
}

// Prefix headings with a per-instance id and rewrite in-description anchors so
// `#section` links resolve to a heading within this rendered copy.
function anchorPlugin(prefix: string) {
  return () => (tree: HastNode) => {
    const seen = new Map<string, number>();
    const visitHeadings = (node: HastNode) => {
      if (!node || !Array.isArray(node.children)) return;
      if (node.type === "element" && typeof node.tagName === "string" && /^h[1-6]$/.test(node.tagName)) {
        const text = nodeText(node);
        const base = slugify(text);
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const id = count === 0 ? `${prefix}-${base}` : `${prefix}-${base}-${count + 1}`;
        node.properties = { ...(node.properties ?? {}), id };
      }
      for (const child of node.children) visitHeadings(child);
    };
    visitHeadings(tree);

    const rewriteLinks = (node: HastNode) => {
      if (!node || !Array.isArray(node.children)) return;
      if (
        node.type === "element" &&
        node.tagName === "a" &&
        typeof node.properties?.href === "string" &&
        node.properties.href.startsWith("#")
      ) {
        const fragment = node.properties.href.slice(1);
        node.properties.href = `#${prefix}-${slugify(decodeURIComponent(fragment))}`;
      }
      for (const child of node.children) rewriteLinks(child);
    };
    rewriteLinks(tree);
  };
}

function nodeText(node: HastNode): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  if (Array.isArray(node.children)) {
    return node.children.map(nodeText).join("");
  }
  return "";
}

const headingClassNames: Record<number, string> = {
  1: "font-sans text-2xl font-semibold leading-tight tracking-[-0.28px] text-ink",
  2: "font-sans text-xl font-semibold leading-tight text-ink",
  3: "font-sans text-lg font-semibold leading-snug text-ink",
  4: "font-sans text-[17px] font-semibold leading-snug text-ink",
  5: "font-sans text-[15px] font-semibold leading-snug text-ink",
  6: "font-sans text-sm font-semibold leading-snug text-ink",
};

function makeComponents(): Components {
  return {
    h1: (props) => <h4 className={headingClassNames[1]} {...splitNode(props)} />,
    h2: (props) => <h4 className={headingClassNames[2]} {...splitNode(props)} />,
    h3: (props) => <h5 className={headingClassNames[3]} {...splitNode(props)} />,
    h4: (props) => <h6 className={headingClassNames[4]} {...splitNode(props)} />,
    h5: (props) => <h6 className={headingClassNames[5]} {...splitNode(props)} />,
    h6: (props) => <h6 className={headingClassNames[6]} {...splitNode(props)} />,
    p: (props) => <p className={cn(bodyTextClassName, "font-normal")} {...splitNode(props)} />,
    strong: (props) => <strong className="font-bold" {...splitNode(props)} />,
    em: (props) => <em className="italic" {...splitNode(props)} />,
    del: (props) => <del className="text-ink-muted-64 line-through" {...splitNode(props)} />,
    a: MarkdownLink,
    ul: (props) => {
      const { className } = props as { className?: string };
      const isTaskList = typeof className === "string" && className.includes("contains-task-list");
      const rest = splitNode(props);
      delete (rest as { className?: string }).className;
      return (
        <ul
          className={cn(
            isTaskList ? "list-none space-y-1 pl-0" : "list-disc space-y-1 pl-5 marker:text-ink-muted-48",
            className,
          )}
          {...rest}
        />
      );
    },
    ol: (props) => (
      <ol className="list-decimal space-y-1 pl-5 marker:text-ink-muted-48" {...splitNode(props)} />
    ),
    li: (props) => {
      const { className } = props as { className?: string };
      const rest = splitNode(props);
      delete (rest as { className?: string }).className;
      return (
        <li
          className={cn(bodyTextClassName, "font-normal", className)}
          {...rest}
        />
      );
    },
    blockquote: (props) => (
      <blockquote
        className={cn(bodyTextClassName, "border-l-2 border-hairline pl-3 text-ink-muted-80")}
        {...splitNode(props)}
      />
    ),
    hr: () => <hr className="my-3 border-hairline" />,
    code: (props) => {
      const { className, children } = props;
      const isBlock = typeof className === "string" && className.startsWith("language-");
      const rest = splitNode(props);
      delete (rest as { className?: string }).className;
      delete (rest as { children?: unknown }).children;

      if (!isBlock) {
        return (
          <code {...rest} className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em] text-ink">
            {children}
          </code>
        );
      }
      return (
        <code {...rest} className={cn(className, "font-mono text-[13px] leading-relaxed")}>
          {children}
        </code>
      );
    },
    pre: (props) => (
      <pre
        tabIndex={0}
        role="group"
        aria-label="Code block"
        className="overflow-x-auto rounded-md border border-hairline bg-muted/60 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        {...splitNode(props)}
      />
    ),
    table: (props) => (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[14px]" {...splitNode(props)} />
      </div>
    ),
    th: (props) => (
      <th className="border-b border-hairline px-2 py-1 font-semibold text-ink" {...splitNode(props)} />
    ),
    td: (props) => (
      <td className="border-b border-hairline/60 px-2 py-1 align-top" {...splitNode(props)} />
    ),
    img: MarkdownImage,
    input: (props) => {
      const { type, checked } = props;
      if (type !== "checkbox") return null;
      const rest = splitNode(props);
      return (
        <input
          {...rest}
          type="checkbox"
          checked={Boolean(checked)}
          disabled
          readOnly
          aria-label={checked ? "Done" : "Not done"}
          className="mr-1.5 size-3.5 translate-y-[1px] accent-primary"
        />
      );
    },
  };
}

function MarkdownPreviewInner({
  children,
  className,
}: {
  children: string | null | undefined;
  className?: string;
}) {
  const prefix = useId().replace(/[^a-zA-Z0-9_-]/g, "") || "md";
  const components = useMemo(() => makeComponents(), []);
  const rehypePlugins = useMemo(() => [rehypeHighlight, anchorPlugin(prefix)], [prefix]);

  if (!children || children.trim() === "") return null;

  return (
    <div className={cn("space-y-2 break-words", className)}>
      <Markdown
        allowedElements={[...ALLOWED_ELEMENTS]}
        components={components}
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        urlTransform={(url) => safeUrl(url) || safeImageUrl(url)}
      >
        {children}
      </Markdown>
    </div>
  );
}

export const MarkdownPreview = memo(MarkdownPreviewInner);