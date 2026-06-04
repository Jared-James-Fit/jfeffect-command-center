import {
  LayoutDashboard, Users, CreditCard,
  Package, FileText, Dumbbell, FolderOpen, Calendar, Layers,
  Settings, Briefcase, Apple, ClipboardCheck, UserCog,
} from "lucide-react";
import type { NavItem } from "@/components/app-shell";

export const adminNav: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/clients", label: "Clients", icon: Users },
  { to: "/admin/calendar", label: "Calendar", icon: Calendar },
  { to: "/admin/payments", label: "Payments", icon: CreditCard },
  { to: "/admin/offers", label: "Offers / Products", icon: Package },
  { to: "/admin/exercises", label: "Exercise Library", icon: Dumbbell },
  { to: "/admin/resources", label: "Resources", icon: FolderOpen },
  { to: "/admin/apps", label: "Apps & Tools", icon: Layers },
  { to: "/admin/business-systems", label: "Business Systems", icon: Briefcase },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

export const clientNav: NavItem[] = [
  { to: "/portal", label: "Dashboard", icon: LayoutDashboard },
  { to: "/portal/program", label: "My Program", icon: FileText },
  { to: "/portal/nutrition-targets", label: "Nutrition Targets", icon: Apple },
  { to: "/portal/check-in", label: "Check-In", icon: ClipboardCheck },
  { to: "/portal/exercises", label: "Exercises", icon: Dumbbell },
  { to: "/portal/payments", label: "Payments", icon: CreditCard },
  { to: "/portal/resources", label: "Resources", icon: FolderOpen },
  { to: "/portal/calendar", label: "Calendar", icon: Calendar },
  { to: "/portal/documents", label: "Documents", icon: FileText },
  { to: "/portal/account", label: "Account Settings", icon: UserCog },
];