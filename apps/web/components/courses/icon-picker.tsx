"use client";

import { ChevronDown, Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { FieldInfoButton } from "@/components/courses/field-info-button";
import { CourseIconView } from "@/components/courses/course-icon";
import { PortalMenu } from "@/components/ui/portal-menu";
import { searchCourseIcons } from "@/lib/courses/icon-search";
import {
  addRecentlyUsedIcon,
  readRecentlyUsedIcons,
} from "@/lib/courses/recently-used";
import {
  getCourseIconCategories,
  getCourseIconLabel,
  normalizeCourseIconForStorage,
  SUGGESTED_COURSE_ICONS,
  toCanonicalSlug,
} from "@/lib/courses/icons";
import { ensureIndex } from "@/lib/courses/icon-search";
import { cn } from "@/lib/utils";

type IconPickerProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  info?: string;
  className?: string;
  "aria-describedby"?: string;
};

const SEARCH_LIMIT = 60;

function summarizeResults(total: number, shown: number, query: string): string {
  if (total === 0) return `No icons match "${query}"`;
  if (total > shown) return `First ${shown} of ${total} results`;
  return `${total} ${total === 1 ? "result" : "results"}`;
}

function tokenizeQuery(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function matchRanges(text: string, tokens: string[]): [number, number][] {
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const token of tokens) {
    const index = lower.indexOf(token.toLowerCase());
    if (index !== -1) ranges.push([index, index + token.length]);
  }
  return mergeRanges(ranges);
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const last = merged[merged.length - 1];
    if (sorted[i][0] <= last[1]) {
      last[1] = Math.max(last[1], sorted[i][1]);
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged;
}

function HighlightedLabel({
  label,
  tokens,
}: {
  label: string;
  tokens: string[];
}) {
  const ranges = matchRanges(label, tokens);
  if (ranges.length === 0) {
    return <span>{label}</span>;
  }

  const parts: Array<React.ReactNode> = [];
  let cursor = 0;
  for (let i = 0; i < ranges.length; i += 1) {
    const [start, end] = ranges[i];
    if (start > cursor) {
      parts.push(<span key={`t-${i}-a`}>{label.slice(cursor, start)}</span>);
    }
    parts.push(<mark key={`t-${i}-b`}>{label.slice(start, end)}</mark>);
    cursor = end;
  }
  if (cursor < label.length) {
    parts.push(<span key={`t-end`}>{label.slice(cursor)}</span>);
  }
  return <span>{parts}</span>;
}

function IconOption({
  id,
  slug,
  label,
  selected,
  tokens,
  onSelect,
  onFocus,
}: {
  id: string;
  slug: string;
  label: string;
  selected: boolean;
  tokens?: string[];
  onSelect: () => void;
  onFocus: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={selected}
      onFocus={onFocus}
      onClick={onSelect}
      className={cn(
        "flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left text-[15px] text-ink transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
        selected && "bg-muted/70",
      )}
    >
      <CourseIconView slug={slug} size="sm" />
      <HighlightedLabel label={label} tokens={tokens ?? []} />
    </button>
  );
}

function SuggestedSection({
  menuId,
  activeCategory,
  setActiveCategory,
  storedCanonical,
  queryTokens,
  selectPreset,
  setActiveOptionId,
}: {
  menuId: string;
  activeCategory: string | null;
  setActiveCategory: (category: string | null) => void;
  storedCanonical: string;
  queryTokens: string[];
  selectPreset: (slug: string) => void;
  setActiveOptionId: (id: string | null) => void;
}) {
  const categories = getCourseIconCategories();
  const filtered = SUGGESTED_COURSE_ICONS.filter(
    (suggestion) => !activeCategory || suggestion.category === activeCategory,
  );

  return (
    <>
      <div className="px-3 py-1">
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setActiveCategory(null)}
            className={cn(
              "px-2 py-0.5 text-xs rounded-md border border-hairline transition-colors",
              !activeCategory ? "bg-muted text-ink" : "text-ink-muted-48",
            )}
          >
            All
          </button>
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setActiveCategory(category)}
              className={cn(
                "px-2 py-0.5 text-xs rounded-md border border-hairline transition-colors",
                activeCategory === category
                  ? "bg-muted text-ink"
                  : "text-ink-muted-48",
              )}
            >
              {category}
            </button>
          ))}
        </div>
      </div>
      <div className="px-3 py-1.5 text-xs font-medium tracking-normal text-ink-muted-48">
        Suggested
      </div>
      {filtered.map((option) => {
        const label = option.label;
        const optionId = `${menuId}-suggested-${option.slug}`;
        return (
          <IconOption
            key={option.slug}
            id={optionId}
            slug={option.slug}
            label={label}
            selected={toCanonicalSlug(option.slug) === storedCanonical}
            tokens={queryTokens}
            onSelect={() => selectPreset(option.slug)}
            onFocus={() => setActiveOptionId(optionId)}
          />
        );
      })}
    </>
  );
}

export function IconPicker({
  id,
  value,
  onChange,
  info,
  className,
  "aria-describedby": ariaDescribedByExternal,
}: IconPickerProps) {
  const menuId = useId();
  const listboxId = `${menuId}-listbox`;
  const helpId = useId();
  const searchId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(SEARCH_LIMIT);
  const [activeOptionId, setActiveOptionId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const stored = normalizeCourseIconForStorage(value);
  const storedCanonical = toCanonicalSlug(stored);
  const selectedLabel = getCourseIconLabel(stored);
  const ariaDescribedBy = [ariaDescribedByExternal, info ? helpId : null]
    .filter(Boolean)
    .join(" ");

  const trimmedQuery = query.trim();
  const search = searchCourseIcons(query, { limit });
  const resultSummary = trimmedQuery
    ? summarizeResults(search.total, search.results.length, trimmedQuery)
    : "";
  const queryTokens = tokenizeQuery(trimmedQuery);
  const hasResults = trimmedQuery && search.results.length > 0;

  const recents = readRecentlyUsedIcons();
  const recentsExcludingCurrent = recents.filter(
    (slug) => toCanonicalSlug(slug) !== storedCanonical,
  );

  function closeMenu() {
    setOpen(false);
    setQuery("");
    setLimit(SEARCH_LIMIT);
    setActiveOptionId(null);
  }

  function toggleMenu() {
    if (open) {
      closeMenu();
      return;
    }
    // Precompute the search index while the menu is opening so the first
    // keystroke isn't delayed by the index build.
    ensureIndex();
    setOpen(true);
  }

  function selectPreset(nextValue: string) {
    onChange(nextValue);
    if (nextValue) {
      addRecentlyUsedIcon(nextValue);
    }
    closeMenu();
  }

  function handleClear() {
    setQuery("");
    setLimit(SEARCH_LIMIT);
    setActiveOptionId(null);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      const first = search.results[0];
      if (!trimmedQuery || !first) return;
      event.preventDefault();
      selectPreset(first.slug);
      return;
    }

    if (event.key === "ArrowDown") {
      const option = listRef.current?.querySelector<HTMLButtonElement>(
        '[role="option"]',
      );
      if (!option) return;
      event.preventDefault();
      option.focus();
    }
  }

  // Scroll the selected (or currently active virtual) option into view.
  const scrollSelectedIntoView = useCallback(() => {
    if (!listRef.current) return;
    const target =
      listRef.current.querySelector<HTMLElement>(
        activeOptionId ? `#${activeOptionId}` : '[role="option"][aria-selected="true"]',
      ) ??
      listRef.current.querySelector<HTMLElement>('[role="option"]');
    target?.scrollIntoView({ block: "nearest" });
  }, [listRef, activeOptionId]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      scrollSelectedIntoView();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, scrollSelectedIntoView]);

  return (
    <div className={cn("relative min-w-0", className)}>
      {info ? (
        <span id={helpId} className="sr-only">
          {info}
        </span>
      ) : null}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-describedby={ariaDescribedBy || undefined}
        onClick={toggleMenu}
        className="flex w-full items-center justify-end gap-2 rounded-md border border-hairline bg-canvas px-3 py-2 text-left text-ink transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <CourseIconView slug={stored} size="sm" />
        <span className="min-w-0 truncate">
          {stored ? selectedLabel : "None"}
        </span>
        <ChevronDown
          className="size-4 shrink-0 text-ink-muted-48"
          aria-hidden="true"
          strokeWidth={1.75}
        />
      </button>
      {info ? (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center">
          <FieldInfoButton info={info} />
        </div>
      ) : null}

      <div role="status" className="sr-only">
        {trimmedQuery ? resultSummary : ""}
      </div>

      <PortalMenu
        open={open}
        onClose={closeMenu}
        triggerRef={triggerRef}
        menuId={listboxId}
        label="Course icon options"
        role="none"
        arrowNav
        searchRef={searchRef}
        measureOptions={{
          minWidth: 280,
          maxHeight: 360,
          minSpace: 120,
          belowThreshold: 160,
        }}
      >
        <div className="flex items-center gap-2 border-b border-divider-soft px-3 py-2">
          <Search className="size-4 shrink-0 text-ink-muted-48" aria-hidden="true" />
          <input
            ref={searchRef}
            id={searchId}
            type="search"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={
              activeOptionId ? activeOptionId : undefined
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveOptionId(null);
            }}
            onFocus={() => setActiveOptionId(null)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search icons"
            aria-label="Search icons"
            className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-muted-48"
          />
          {trimmedQuery ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={handleClear}
              className="shrink-0 p-1 text-ink-muted-48 hover:text-ink transition-colors"
            >
              <X className="size-4" aria-hidden="true" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Course icon options"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
        >
          {/* Current — always present at the top. */}
          <div className="px-3 py-1.5 text-xs font-medium tracking-normal text-ink-muted-48">
            Current
          </div>
          <IconOption
            id={`${menuId}-current`}
            slug={stored}
            label={stored ? selectedLabel : "None"}
            selected={true}
            tokens={[]}
            onSelect={() => selectPreset(stored)}
            onFocus={() => setActiveOptionId(`${menuId}-current`)}
          />

          {/* Recently used — persisted to localStorage. */}
          {recentsExcludingCurrent.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-xs font-medium tracking-normal text-ink-muted-48">
                Recently used
              </div>
              {recentsExcludingCurrent.map((slug) => {
                const label = getCourseIconLabel(slug);
                const optionId = `${menuId}-recent-${slug}`;
                return (
                  <IconOption
                    key={slug}
                    id={optionId}
                    slug={slug}
                    label={label}
                    selected={toCanonicalSlug(slug) === storedCanonical}
                    tokens={queryTokens}
                    onSelect={() => selectPreset(slug)}
                    onFocus={() => setActiveOptionId(optionId)}
                  />
                );
              })}
            </>
          )}

          {hasResults ? (
            <>
              <div className="px-3 py-1.5 text-xs font-medium tracking-normal text-ink-muted-48">
                {resultSummary}
              </div>
              {search.results.map((result) => {
                const label = result.label;
                const optionId = `${menuId}-result-${result.slug}`;
                const selected = toCanonicalSlug(result.slug) === storedCanonical;
                return (
                  <IconOption
                    key={result.slug}
                    id={optionId}
                    slug={result.slug}
                    label={label}
                    selected={selected}
                    tokens={queryTokens}
                    onSelect={() => selectPreset(result.slug)}
                    onFocus={() => setActiveOptionId(optionId)}
                  />
                );
              })}
              {search.total > limit && (
                <div role="presentation" className="px-3 py-1">
                  <button
                    type="button"
                    onClick={() => setLimit(search.total)}
                    className="w-full py-2 text-xs font-medium text-ink transition-colors hover:bg-muted"
                  >
                    Show all {search.total} results
                  </button>
                </div>
              )}
            </>
          ) : trimmedQuery ? (
            <>
              {/* Zero-results fallback: never leave the user stuck — offer
                  the curated suggestions as a way back in, plus a reset. */}
              <div className="px-3 py-1.5 text-xs font-medium tracking-normal text-ink-muted-48">
                No icons match
              </div>
              <SuggestedSection
                menuId={menuId}
                activeCategory={activeCategory}
                setActiveCategory={setActiveCategory}
                storedCanonical={storedCanonical}
                queryTokens={queryTokens}
                selectPreset={selectPreset}
                setActiveOptionId={setActiveOptionId}
              />
              <div role="presentation" className="px-3 py-1">
                <button
                  type="button"
                  onClick={handleClear}
                  className="w-full py-2 text-xs font-medium text-ink transition-colors hover:bg-muted"
                >
                  Reset
                </button>
              </div>
            </>
          ) : (
            <SuggestedSection
              menuId={menuId}
              activeCategory={activeCategory}
              setActiveCategory={setActiveCategory}
              storedCanonical={storedCanonical}
              queryTokens={queryTokens}
              selectPreset={selectPreset}
              setActiveOptionId={setActiveOptionId}
            />
          )}
        </div>
      </PortalMenu>
    </div>
  );
}
