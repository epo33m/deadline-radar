import { describe, expect, test } from "bun:test";

import { urgencyLabel } from "./urgency";

describe("urgencyLabel", () => {
  test("formats H-N for days before deadline", () => {
    expect(urgencyLabel(7)).toBe("H-7");
    expect(urgencyLabel(3)).toBe("H-3");
    expect(urgencyLabel(1)).toBe("H-1");
  });

  test("labels deadline day as H-0 — today!", () => {
    expect(urgencyLabel(0)).toBe("H-0 — today!");
  });
});
