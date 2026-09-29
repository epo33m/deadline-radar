export type NavItem = {
  href: string;
  label: string;
  /**
   * Sibling pages that belong to this item's group. Any of them lighting up
   * this item is what keeps a multi-page group coherent in the primary nav.
   */
  group: readonly string[];
  /**
   * When `true`, only an exact pathname match counts — no subpath matching.
   * For single-page items with no children, so a future `/summary/…` route
   * cannot silently light Summary up.
   */
  exact?: boolean;
};

export const PRIMARY_NAV_ITEMS: NavItem[] = [
  { href: "/summary", label: "Summary", group: [], exact: true },
  // The Learn group is Courses / Tasks / Calendar, each of which has detail
  // routes (`/courses/[id]`, `/tasks/[id]`). `href` is the group's first page
  // and `group` lists the rest, so all of them light this item.
  //
  // None of them may point at `/learn`: that route is now only a redirect kept
  // for old bookmarks, and matching is done against `href`/`group`, so a nav
  // entry pointing there would leave the whole Learn group unhighlighted.
  { href: "/courses", label: "Learn", group: ["/tasks", "/calendar"] },
  { href: "/settings", label: "Settings", group: [] },
];

function matches(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function isNavItemActive(pathname: string, item: NavItem): boolean {
  const self = item.exact ? pathname === item.href : matches(pathname, item.href);
  if (self) return true;
  return item.group.some((base) => matches(pathname, base));
}
