/**
 * Markdown → plain text for the places that must stay one-line or unstyled:
 * mobile preview rows, email bodies, notification strings.
 *
 * The renderer (`react-markdown`) owns the styled view; this module only
 * strips syntax markers so a preview never shows `**bold**` or a half-cut
 * link destination. It is deliberately small: the supported subset matches
 * what the product documents (headings, lists, quotes, emphasis, links,
 * inline code, fenced code, GFM tables/task lists).
 */

const FENCE_PREFIX = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}\s+/;
const BLOCKQUOTE = /^\s{0,3}>\s?/;
const LIST_MARKER = /^\s*(?:[-+*]|\d{1,9}[.)])\s+/;
const TASK_MARKER = /^\[[ xX]\]\s+/;
const HORIZONTAL_RULE = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function stripInline(text: string): string {
  // Escaped punctuation must survive the emphasis passes: park each escaped
  // character behind a placeholder, then restore it at the end.
  const escaped: string[] = [];
  const parked = text.replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, (_match, char: string) => {
    escaped.push(char);
    return `\u0000${escaped.length - 1}\u0001`;
  });

  const stripped = parked
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1");

  return stripped.replace(/\u0000(\d+)\u0001/g, (_match, index: string) => escaped[Number(index)] ?? "");
}

function stripBlockLine(line: string): string {
  if (HORIZONTAL_RULE.test(line) || TABLE_DELIMITER.test(line)) return "";
  const withoutHeading = line.replace(HEADING, "");
  const withoutQuote = withoutHeading.replace(BLOCKQUOTE, "");
  const withoutList = withoutQuote.replace(LIST_MARKER, "");
  return withoutList.replace(TASK_MARKER, "");
}

export function stripMarkdown(input: string | null | undefined): string {
  if (!input) return "";

  const out: string[] = [];
  let inFence = false;

  for (const rawLine of input.replace(/\r\n?/g, "\n").split("\n")) {
    if (FENCE_PREFIX.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    // Inside a fence the content is code: keep it verbatim, markers included.
    if (inFence) {
      out.push(rawLine);
      continue;
    }
    // Table rows keep their cells as words; the pipe is structure, not text.
    // The `|---|---|` delimiter row carries no content at all.
    if (TABLE_DELIMITER.test(rawLine)) continue;
    const withoutPipes = rawLine.includes("|")
      ? rawLine.replace(/\|/g, " ").trim()
      : rawLine;
    out.push(stripInline(stripBlockLine(withoutPipes)));
  }

  return out
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}