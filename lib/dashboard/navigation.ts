export type NavItem = {
  href: string;
  label: string;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const APP_NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/dashboard", label: "Overview" }],
  },
  {
    label: "Learn",
    items: [
      { href: "/courses", label: "Courses" },
      { href: "/tasks", label: "Tasks" },
    ],
  },
  {
    label: "Plan",
    items: [{ href: "/calendar", label: "Calendar" }],
  },
  {
    label: "System",
    items: [{ href: "/notifications", label: "Notifications" }],
  },
  {
    label: "Settings",
    items: [{ href: "/settings", label: "Settings" }],
  },
];

export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
