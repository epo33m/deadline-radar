import { describe, expect, test } from "bun:test";

import { withPageCount } from "./href";

describe("#141 — withPageCount", () => {
  test("adds the paging state to a bare path", () => {
    expect(withPageCount("/tasks", {}, 2)).toBe("/tasks?pages=2");
  });

  test("keeps the base path clean on the first page", () => {
    // `?pages=1` in the URL would make every default link look like paging
    // state and survive into the next navigation.
    expect(withPageCount("/tasks", {}, 1)).toBe("/tasks");
  });

  test("preserves the surface's other query state", () => {
    // The course detail keeps its task filter in `view`; dropping it while
    // paging would silently reset the user's filter.
    expect(withPageCount("/courses/abc", { view: "overdue" }, 3)).toBe(
      "/courses/abc?view=overdue&pages=3",
    );
  });

  test("drops empty and nullish params", () => {
    expect(
      withPageCount("/settings/notifications", { view: undefined, q: null }, 2),
    ).toBe("/settings/notifications?pages=2");
    expect(withPageCount("/tasks", { view: "" }, 2)).toBe("/tasks?pages=2");
  });

  test("stringifies non-string values", () => {
    expect(withPageCount("/tasks", { month: 3, flag: true }, 2)).toBe(
      "/tasks?month=3&flag=true&pages=2",
    );
  });
});
