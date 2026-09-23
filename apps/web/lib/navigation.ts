export type NavItem = {
  href: string;
  label: string;
};

export const PRIMARY_NAV_ITEMS: NavItem[] = [
  { href: "/summary", label: "Summary" },
  { href: "/learn", label: "Learn" },
  { href: "/settings", label: "Settings" },
];

export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/summary") {
    return pathname === "/summary";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
