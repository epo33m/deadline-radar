import { expect, test } from "bun:test";

import { EMPTY_TASKS } from "./month";

// F-11b: the empty-cell fallback must be referentially stable so
// `CalendarDayCell`'s memo keeps empty cells from re-rendering.
test("EMPTY_TASKS is a single frozen, shared reference", () => {
  expect(Array.isArray(EMPTY_TASKS)).toBe(true);
  expect(EMPTY_TASKS.length).toBe(0);
  expect(Object.isFrozen(EMPTY_TASKS)).toBe(true);
});
