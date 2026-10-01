import { describe, expect, test } from "bun:test";

import { isNavItemActive, PRIMARY_NAV_ITEMS, type NavItem } from "./navigation";

const item = (label: string): NavItem => {
  const found = PRIMARY_NAV_ITEMS.find((i) => i.label === label);
  if (!found) throw new Error(`no primary nav item labelled ${label}`);
  return found;
};

const activeLabels = (pathname: string) =>
  PRIMARY_NAV_ITEMS.filter((i) => isNavItemActive(pathname, i)).map(
    (i) => i.label,
  );

describe("primary nav active state", () => {
  test("all three Learn-group pages light up exactly the Learn item", () => {
    // The Learn group is Courses / Tasks / Calendar. Before this, "Learn"
    // pointed at `/learn` — a route that is now only a redirect — so all three
    // pages rendered with no primary item highlighted.
    for (const pathname of ["/courses", "/tasks", "/calendar"]) {
      expect({ pathname, active: activeLabels(pathname) }).toEqual({
        pathname,
        active: ["Learn"],
      });
    }
  });

  test("exactly one primary item is active on every primary page", () => {
    for (const pathname of [
      "/summary",
      "/courses",
      "/tasks",
      "/calendar",
      "/settings",
    ]) {
      expect({ pathname, count: activeLabels(pathname).length }).toEqual({
        pathname,
        count: 1,
      });
    }
  });

  test("Summary does not match by prefix", () => {
    // Summary has no group and no subpath rule: `/summary/…` must not light it.
    expect(isNavItemActive("/summary", item("Summary"))).toBe(true);
    expect(isNavItemActive("/summary/extra", item("Summary"))).toBe(false);
  });

  test("no primary item points at the /learn redirect", () => {
    // `/learn` survives only as a redirect for old bookmarks. A nav entry
    // pointing there again would silently unhighlight the whole Learn group.
    expect(PRIMARY_NAV_ITEMS.map((i) => i.href)).not.toContain("/learn");
    expect(PRIMARY_NAV_ITEMS.flatMap((i) => i.group)).not.toContain("/learn");
  });

  test("a detail page keeps its group item active", () => {
    expect(activeLabels("/courses/course-1")).toEqual(["Learn"]);
    expect(activeLabels("/tasks/task-1")).toEqual(["Learn"]);
  });
});
