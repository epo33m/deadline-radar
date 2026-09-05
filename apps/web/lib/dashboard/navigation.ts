import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Calendar,
  CheckSquare,
  Home,
  SlidersHorizontal,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const APP_NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/dashboard", label: "Overview", icon: Home }],
  },
  {
    label: "Learn",
    items: [
      { href: "/courses", label: "Courses", icon: BookOpen },
      { href: "/tasks", label: "Tasks", icon: CheckSquare },
    ],
  },
  {
    label: "Plan",
    items: [{ href: "/calendar", label: "Calendar", icon: Calendar }],
  },
  {
    label: "System",
    items: [
      { href: "/preferences", label: "Preferences", icon: SlidersHorizontal },
    ],
  },
];

export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
