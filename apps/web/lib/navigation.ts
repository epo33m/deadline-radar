import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Calendar,
  CheckSquare,
  Home,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const PRIMARY_NAV_ITEMS: NavItem[] = [
  { href: "/overview", label: "Overview", icon: Home },
  { href: "/courses", label: "Courses", icon: BookOpen },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/calendar", label: "Calendar", icon: Calendar },
];

export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/overview") {
    return pathname === "/overview";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
