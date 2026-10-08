/**
 * #141: the list surfaces used to fetch page 1 only, so anyone past the API's
 * 50-row default hit a silent ceiling. `loadPaged` is the single cursor walk
 * that makes the rest of the list reachable — and the part most likely to break
 * quietly is the walk's *end state*, because a wrong `complete`/`truncated`
 * turns a partial list into a convincing lie.
 */
import { describe, expect, test } from "bun:test";

import { LIST_MAX_PAGES } from "./limit";
import { loadPaged, type PageResult } from "./load-pages";

type Row = { id: string };

/** `pages` describes the rows each request returns; the walk stops when a page
 *  hands back no cursor. */
function pagedSource(pages: Row[][], cursorOf?: (index: number) => string) {
  const calls: Array<string | null> = [];
  const fetchPage = async (cursor: string | null): Promise<PageResult<Row>> => {
    calls.push(cursor);
    const index = cursor == null ? 0 : Number(cursor.replace("cursor-", ""));
    const items = pages[index] ?? [];
    const next = index + 1 < pages.length ? (cursorOf?.(index) ?? `cursor-${index + 1}`) : null;
    return { items, nextCursor: next };
  };
  return { fetchPage, calls };
}

const rows = (ids: string[]): Row[] => ids.map((id) => ({ id }));

describe("#141 — loadPaged cursor walk", () => {
  test("accumulates every page until the API stops handing out a cursor", async () => {
    const { fetchPage, calls } = pagedSource([
      rows(["a", "b"]),
      rows(["c", "d"]),
      rows(["e"]),
    ]);

    const result = await loadPaged(fetchPage);

    expect(result.items.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.pagesFetched).toBe(3);
    expect(result.complete).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.error).toBeNull();
    // The first request has no cursor; each later one continues from the last.
    expect(calls).toEqual([null, "cursor-1", "cursor-2"]);
  });

  test("stops after one request when the first page is the whole set", async () => {
    const { fetchPage, calls } = pagedSource([rows(["a"])]);

    const result = await loadPaged(fetchPage);

    expect(result.items).toHaveLength(1);
    expect(result.complete).toBe(true);
    expect(result.nextCursor).toBeNull();
    expect(calls).toEqual([null]);
  });

  test("reports the outstanding cursor so the caller can offer the next page", async () => {
    const { fetchPage } = pagedSource([rows(["a"]), rows(["b"])]);

    const result = await loadPaged(fetchPage, { maxPages: 1 });

    // This is the whole point of the fix: a first page with more behind it is
    // no longer indistinguishable from a complete list.
    expect(result.complete).toBe(false);
    expect(result.nextCursor).toBe("cursor-1");
    // Not truncated: the walk stopped where the user asked it to, and the live
    // cursor still drives "Load more". Truncation would be a lie here.
    expect(result.truncated).toBe(false);
  });

  test("clamps a requested depth to the hard cap", async () => {
    // An endless source: without the clamp, a caller-supplied 99 would walk 99
    // pages of a collection that never ends.
    const endless = pagedSource(
      Array.from({ length: LIST_MAX_PAGES + 5 }, (_, i) => rows([`r${i}`])),
    );

    const result = await loadPaged(endless.fetchPage, { maxPages: 99 });

    expect(endless.calls).toHaveLength(LIST_MAX_PAGES);
    expect(result.complete).toBe(false);
    expect(result.truncated).toBe(true);
  });

  test("caps the walk and flags truncation instead of walking forever", async () => {
    const endless = pagedSource(
      Array.from({ length: LIST_MAX_PAGES + 5 }, (_, i) => rows([`r${i}`])),
    );

    const result = await loadPaged(endless.fetchPage);

    expect(result.pagesFetched).toBe(LIST_MAX_PAGES);
    expect(result.complete).toBe(false);
    expect(result.truncated).toBe(true);
    expect(endless.calls).toHaveLength(LIST_MAX_PAGES);
  });

  test("drops rows repeated across a keyset boundary", async () => {
    // A row inserted or re-sorted between two requests can be returned twice.
    // Duplicate ids would break React keys and inflate the "Showing N" count.
    const { fetchPage } = pagedSource([rows(["a", "b"]), rows(["b", "c"])]);

    const result = await loadPaged(fetchPage);

    expect(result.items.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  test("keeps already-fetched rows when a later page fails", async () => {
    let call = 0;
    const fetchPage = async (): Promise<PageResult<Row>> => {
      call += 1;
      if (call === 1) return { items: rows(["a", "b"]), nextCursor: "cursor-1" };
      throw new Error("upstream 502");
    };

    const result = await loadPaged(fetchPage);

    // A failure on page 2 must not throw away page 1…
    expect(result.items.map((r) => r.id)).toEqual(["a", "b"]);
    // …and must never be reported as the whole set.
    expect(result.complete).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });

  test("a first-page failure yields no rows and a non-null error", async () => {
    // The caller renders a load error from this; an empty list would read as
    // "you have nothing".
    const fetchPage = async (): Promise<PageResult<Row>> => {
      throw new Error("upstream 502");
    };

    const result = await loadPaged(fetchPage);

    expect(result.items).toEqual([]);
    expect(result.pagesFetched).toBe(0);
    expect(result.complete).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });
});
