"use client";

import { ChevronDown, ChevronsUpDown, Search } from "lucide-react";
import {
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
  getCourseIconLabel,
  normalizeCourseIconForStorage,
  SUGGESTED_COURSE_ICONS,
} from "@/lib/courses/icons";
import { cn } from "@/lib/utils";

type IconPickerProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  info?: string;
  /** Render a small trailing-edge control instead of a full-width field. */
  compact?: boolean;
  className?: string;
  "aria-describedby"?: string;
};

const SEARCH_LIMIT = 60;

function summarizeResults(total: number, shown: number, query: string): string {
  if (total === 0) return `No icons match "${query}"`;
  if (total > shown) return `First ${shown} of ${total} results`;
  return `${total} ${total === 1 ? "result" : "results"}`;
}

function IconPreview({ slug }: { slug: string }) {
  if (!slug) {
    return (
      <span
        aria-hidden="true"
        className="size-3 shrink-0 rounded-full border border-hairline bg-transparent"
      />
    );
  }
  return (
    <span className="inline-flex size-3 shrink-0 items-center justify-center">
      <CourseIconView slug={slug} className="size-3" />
    </span>
  );
}

function IconOption({
  slug,
  label,
  selected,
  onSelect,
}: {
  slug: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left text-[15px] text-ink transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
        selected && "bg-muted/70",
      )}
    >
      <IconPreview slug={slug} />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

export function IconPicker({
  id,
  value,
  onChange,
  info,
  compact = false,
  className,
  "aria-describedby": ariaDescribedByExternal,
}: IconPickerProps) {
  const menuId = useId();
  const helpId = useId();
  const searchId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const stored = normalizeCourseIconForStorage(value);
  const selectedLabel = getCourseIconLabel(stored);
  const ariaDescribedBy = [ariaDescribedByExternal, info ? helpId : null]
    .filter(Boolean)
    .join(" ");

  const trimmedQuery = query.trim();
  const search = searchCourseIcons(query, { limit: SEARCH_LIMIT });
  const results = trimmedQuery ? search.results : null;
  const resultSummary = trimmedQuery
    ? summarizeResults(search.total, search.results.length, trimmedQuery)
    : "";

  function closeMenu() {
    setOpen(false);
    setQuery("");
  }

  function toggleMenu() {
    if (open) {
      closeMenu();
      return;
    }
    setOpen(true);
  }

  function selectPreset(nextValue: string) {
    onChange(nextValue);
    closeMenu();
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

  return (
    <div className={cn("relative min-w-0", compact && "flex items-center justify-end")}>
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
        aria-controls={menuId}
        aria-describedby={ariaDescribedBy || undefined}
        onClick={toggleMenu}
        className={
          compact
            ? "flex h-8 min-w-10 shrink-0 items-center justify-center gap-1 rounded-md border border-hairline bg-canvas px-1.5 text-ink-muted-80 transition-colors hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            : cn("flex w-full items-center justify-end gap-2", className)
        }
      >
        <IconPreview slug={stored} />
        {!compact ? (
          <span
            className={cn(
              "min-w-0 truncate",
              !stored && "text-ink-muted-48",
            )}
          >
            {selectedLabel}
          </span>
        ) : null}
        {compact ? (
          <ChevronsUpDown
            className="size-3.5 shrink-0 text-ink-muted-80"
            aria-hidden="true"
            strokeWidth={1.75}
          />
        ) : (
          <ChevronDown
            className="size-4 shrink-0 text-ink-muted-48"
            aria-hidden="true"
            strokeWidth={1.75}
          />
        )}
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
        menuId={menuId}
        label="Course icon options"
        arrowNav
        searchRef={searchRef}
        measureOptions={{ minWidth: 280, maxHeight: 360, minSpace: 120, belowThreshold: 160 }}
      >
        <div className="flex items-center gap-2 border-b border-divider-soft px-3 py-2">
          <Search className="size-4 shrink-0 text-ink-muted-48" aria-hidden="true" />
          <input
            ref={searchRef}
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search icons"
            aria-label="Search icons"
            className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-muted-48"
          />
        </div>
        <div
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
        >
          <IconOption
            slug=""
            label="None"
            selected={stored === ""}
            onSelect={() => selectPreset("")}
          />

          {results ? (
            <div role="presentation">
              <div className="px-3 py-1.5 text-xs font-medium tracking-normal text-ink-muted-48">
                {resultSummary}
              </div>
              {results.map((result) => (
                <IconOption
                  key={result.slug}
                  slug={result.slug}
                  label={result.label}
                  selected={stored === result.slug}
                  onSelect={() => selectPreset(result.slug)}
                />
              ))}
            </div>
          ) : (
            <div role="presentation">
              <div className="px-3 py-1.5 text-xs font-medium tracking-normal text-ink-muted-48">
                Suggested
              </div>
              {SUGGESTED_COURSE_ICONS.map((option) => (
                <IconOption
                  key={option.slug}
                  slug={option.slug}
                  label={option.label}
                  selected={stored === option.slug}
                  onSelect={() => selectPreset(option.slug)}
                />
              ))}
            </div>
          )}
        </div>
      </PortalMenu>
    </div>
  );
}
