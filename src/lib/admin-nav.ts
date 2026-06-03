import {
  LayoutDashboard, Users, UserPlus, PhoneCall, ClipboardCheck, CreditCard,
  Package, FileText, Dumbbell, FolderOpen, Calendar, Layers, Star,
  Lightbulb, BookOpen, Workflow, Settings, Timer,
} from "lucide-react";
import type { NavItem } from "@/components/app-shell";

export const adminNav: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/clients", label: "Clients", icon: Users },
  { to: "/admin/leads", label: "Leads", icon: UserPlus },
  { to: "/admin/sales-calls", label: "Sales Calls", icon: PhoneCall },
  { to: "/admin/check-ins", label: "Check-Ins", icon: ClipboardCheck },
  { to: "/admin/training-phases", label: "Training Phases", icon: Timer },
  { to: "/admin/payments", label: "Payments", icon: CreditCard },
  { to: "/admin/offers", label: "Offers / Products", icon: Package },
  { to: "/admin/programs", label: "Programs", icon: FileText },
  { to: "/admin/exercises", label: "Exercise Library", icon: Dumbbell },
  { to: "/admin/resources", label: "Resources", icon: FolderOpen },
  { to: "/admin/calendar", label: "Calendar", icon: Calendar },
  { to: "/admin/apps", label: "Apps & Tools", icon: Layers },
  { to: "/admin/testimonials", label: "Testimonials", icon: Star },
  { to: "/admin/content-ideas", label: "Content Ideas", icon: Lightbulb },
  { to: "/admin/sops", label: "SOPs", icon: BookOpen },
  { to: "/admin/automations", label: "Automations", icon: Workflow },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

export const clientNav: NavItem[] = [
  { to: "/portal", label: "Dashboard", icon: LayoutDashboard },
  { to: "/portal/program", label: "My Program", icon: FileText },
  { to: "/portal/check-in", label: "Check-In", icon: ClipboardCheck },
  { to: "/portal/exercises", label: "Exercises", icon: Dumbbell },
  { to: "/portal/payments", label: "Payments", icon: CreditCard },
  { to: "/portal/resources", label: "Resources", icon: FolderOpen },
  { to: "/portal/calendar", label: "Calendar", icon: Calendar },
  { to: "/portal/documents", label: "Documents", icon: FileText },
];