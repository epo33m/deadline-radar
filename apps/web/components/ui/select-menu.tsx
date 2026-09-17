"use client";

import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";

import { PortalMenu } from "@/components/ui/portal-menu";
import { dialogSelectClassName } from "@/components/ui/dialog-form";
import { cn } from "@/lib/utils";

export type SelectMenuOption = {
  value: string;
  label: string;
  description?: string;
  group?: string;
};

type SelectMenuProps = {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectMenuOption[];
  placeholder?: string;
  ariaLabel: string;
  triggerClassName?: string;
  menuClassName?: string;
  searchable?: boolean;
  minSearchableOptions?: number;
  /** Render a small trailing-edge chip instead of the full-width borderless field. */
  compact?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  disabled?: boolean;
};

const MIN_SEARCH_THRESHOLD = 8;

const compactTriggerClassName =
  "flex h-7 w-fit max-w-full shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md border border-hairline bg-canvas px-1.5 text-ink-muted-80 transition-colors hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export function SelectMenu({
  id,
  name,
  value,
  onChange,
  options,
  placeholder = "Select…",
  ariaLabel,
  triggerClassName,
  menuClassName,
  searchable = false,
  minSearchableOptions = MIN_SEARCH_THRESHOLD,
  compact = false,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  disabled = false,
}: SelectMenuProps) {
  const menuId = useId();
  const searchId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const showSearch = searchable || options.length > minSearchableOptions;

  const filteredOptions = useMemo(() => {
    if (!showSearch || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(q) ||
        (option.description ?? "").toLowerCase().includes(q),
    );
  }, [options, query, showSearch]);

  const groups = useMemo(() => {
    const map = new Map<string, SelectMenuOption[]>();
    for (const option of filteredOptions) {
      const key = option.group ?? "";
      const list = map.get(key);
      if (list) list.push(option);
      else map.set(key, [option]);
    }
    return Array.from(map.entries());
  }, [filteredOptions]);

  const selected = options.find((option) => option.value === value);

  function closeMenu() {
    setOpen(false);
    setQuery("");
  }

  function selectOption(optionValue: string) {
    onChange(optionValue);
    closeMenu();
  }

  return (
    <>
      <input type="hidden" name={name} value={value} />
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          dialogSelectClassName,
          "flex items-center justify-end gap-1.5",
          compact && compactTriggerClassName,
          !selected && "text-ink-muted-48",
          triggerClassName,
        )}
      >
        <span className={cn("min-w-0 truncate", compact && "text-[13px] text-ink")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronsUpDown
          className={cn("shrink-0 text-ink-muted-48", compact ? "size-3" : "size-4")}
          aria-hidden="true"
          strokeWidth={1.75}
        />
      </button>

      <PortalMenu
        open={open}
        onClose={closeMenu}
        triggerRef={triggerRef}
        menuId={menuId}
        label={ariaLabel}
        arrowNav
        searchRef={showSearch ? searchRef : undefined}
        className={menuClassName}
      >
        {showSearch ? (
          <div className="border-b border-hairline px-3 py-2.5">
            <label htmlFor={searchId} className="sr-only">
              Search {ariaLabel.toLowerCase()}
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted-48"
                aria-hidden="true"
                strokeWidth={1.75}
              />
              <input
                ref={searchRef}
                id={searchId}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search…"
                autoComplete="off"
                className="h-10 w-full rounded-lg border border-hairline bg-canvas pr-3 pl-9 text-[15px] text-ink outline-none placeholder:text-ink-muted-48 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          {groups.length === 0 ? (
            <p className="px-3 py-4 text-[14px] text-ink-muted-48">
              No options match “{query.trim()}”.
            </p>
          ) : (
            groups.map(([group, groupOptions]) => (
              <div key={group || "__root"}>
                {group ? (
                  <div className="px-3 py-1.5 text-xs font-medium tracking-normal text-ink-muted-48">
                    {group}
                  </div>
                ) : null}
                {groupOptions.map((option) => {
                  const isSelected = option.value === value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => selectOption(option.value)}
                      className={cn(
                        "flex min-h-11 w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                        isSelected && "bg-muted/70",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium text-ink">
                          {option.label}
                        </span>
                        {option.description ? (
                          <span className="mt-0.5 block text-[13px] text-ink-muted-48">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                      {isSelected ? (
                        <Check
                          className="mt-0.5 size-4 shrink-0 text-primary"
                          aria-hidden="true"
                          strokeWidth={2.25}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </PortalMenu>
    </>
  );
}
