import {
  LayoutDashboard, Users, CreditCard, DollarSign,
  Package, FileText, Dumbbell, FolderOpen, Calendar, Layers,
  Settings, Briefcase, Apple, ClipboardCheck, UserCog, MessageCircle, Video,
  UserCheck, FileSignature, Film,
  ClipboardList, FileEdit,
} from "lucide-react";
import type { NavItem } from "@/components/app-shell";

export const adminNav: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, group: "Command Center" },
  { to: "/admin/clients", label: "Clients", icon: Users, group: "Coaching" },
  { to: "/admin/coaches", label: "Coaches", icon: UserCheck, group: "Coaching" },
  { to: "/admin/messages", label: "Messages", icon: MessageCircle, group: "Coaching" },
  { to: "/admin/check-ins", label: "Check-Ins", icon: ClipboardList, group: "Coaching" },
  { to: "/admin/lift-videos", label: "Lift Video Review", icon: Video, group: "Coaching" },
  { to: "/admin/media-review", label: "Media Review Inbox", icon: Film, group: "Coaching" },
  { to: "/admin/exercises", label: "Exercise Library", icon: Dumbbell, group: "Coaching" },
  { to: "/admin/calendar", label: "Calendar", icon: Calendar, group: "Scheduling" },
  { to: "/admin/payment-links", label: "Stripe Payment Links", icon: CreditCard, group: "Sales & Payments" },
  { to: "/admin/payments", label: "Payments", icon: DollarSign, group: "Sales & Payments" },
  { to: "/admin/purchases", label: "Purchase Records", icon: ClipboardCheck, group: "Sales & Payments" },
  { to: "/admin/agreements", label: "Agreements", icon: FileSignature, group: "Agreements & Documents" },
  { to: "/admin/forms", label: "Forms", icon: FileEdit, group: "Agreements & Documents" },
  { to: "/admin/resources", label: "Resources", icon: FolderOpen, group: "Agreements & Documents" },
  { to: "/admin/apps", label: "Integrations & Tools", icon: Layers, group: "Business Tools" },
  { to: "/admin/business-systems", label: "Business Systems", icon: Briefcase, group: "Business Tools" },
  { to: "/admin/settings", label: "Settings", icon: Settings, group: "Settings" },
];

// Coach navigation: same client-coaching tools as admin, without business/admin sections.
export const coachNav: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/clients", label: "My Clients", icon: Users },
  { to: "/admin/messages", label: "Messages", icon: MessageCircle },
  { to: "/admin/check-ins", label: "Check-Ins", icon: ClipboardList },
  { to: "/admin/lift-videos", label: "Lift Video Review", icon: Video },
  { to: "/admin/media-review", label: "Media Review Inbox", icon: Film },
  { to: "/admin/calendar", label: "Calendar", icon: Calendar },
  { to: "/admin/exercises", label: "Exercise Library", icon: Dumbbell },
  { to: "/admin/resources", label: "Resources", icon: FolderOpen },
];

export const clientNav: NavItem[] = [
  { to: "/portal", label: "Dashboard", icon: LayoutDashboard },
  { to: "/portal/messages", label: "Messages", icon: MessageCircle },
  { to: "/portal/program", label: "My Program", icon: FileText },
  { to: "/portal/lift-videos", label: "Lift Videos", icon: Video },
  { to: "/portal/check-in", label: "Weekly Check-In", icon: ClipboardCheck },
  { to: "/portal/nutrition-targets", label: "Nutrition Targets", icon: Apple },
  { to: "/portal/exercises", label: "Exercises", icon: Dumbbell },
  { to: "/portal/purchases", label: "My Purchases", icon: Package },
  { to: "/portal/agreements", label: "Agreements", icon: FileSignature },
  { to: "/portal/resources", label: "Resources", icon: FolderOpen },
  { to: "/portal/calendar", label: "Calendar", icon: Calendar },
  { to: "/portal/documents", label: "Documents", icon: FileText },
  { to: "/portal/account", label: "Account Settings", icon: UserCog },
];