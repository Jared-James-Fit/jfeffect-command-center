import {
  LayoutDashboard, Users, CreditCard,
  Package, FileText, Dumbbell, FolderOpen, Calendar, Layers,
  Settings, Briefcase, Apple, ClipboardCheck, UserCog, MessageCircle, Video,
  UserCheck, FileSignature, Film,
  Link2,
} from "lucide-react";
import type { NavItem } from "@/components/app-shell";

export const adminNav: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/clients", label: "Clients", icon: Users },
  { to: "/admin/coaches", label: "Coaches", icon: UserCheck },
  { to: "/admin/messages", label: "Messages", icon: MessageCircle },
  { to: "/admin/lift-videos", label: "Lift Videos", icon: Video },
  { to: "/admin/media-review", label: "Media Review", icon: Film },
  { to: "/admin/calendar", label: "Calendar", icon: Calendar },
  { to: "/admin/payments", label: "Payments", icon: CreditCard },
  { to: "/admin/payment-links", label: "Payment Links", icon: Link2 },
  { to: "/admin/offers", label: "Offers / Products", icon: Package },
  { to: "/admin/purchases", label: "Purchase Records", icon: ClipboardCheck },
  { to: "/admin/agreements", label: "Agreements", icon: FileSignature },
  { to: "/admin/exercises", label: "Exercise Library", icon: Dumbbell },
  { to: "/admin/resources", label: "Resources", icon: FolderOpen },
  { to: "/admin/apps", label: "Apps & Tools", icon: Layers },
  { to: "/admin/business-systems", label: "Business Systems", icon: Briefcase },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

// Coach navigation: same client-coaching tools as admin, without business/admin sections.
export const coachNav: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/clients", label: "My Clients", icon: Users },
  { to: "/admin/messages", label: "Messages", icon: MessageCircle },
  { to: "/admin/lift-videos", label: "Lift Videos", icon: Video },
  { to: "/admin/media-review", label: "Media Review", icon: Film },
  { to: "/admin/calendar", label: "Calendar", icon: Calendar },
  { to: "/admin/exercises", label: "Exercise Library", icon: Dumbbell },
  { to: "/admin/resources", label: "Resources", icon: FolderOpen },
];

export const clientNav: NavItem[] = [
  { to: "/portal", label: "Dashboard", icon: LayoutDashboard },
  { to: "/portal/messages", label: "Messages", icon: MessageCircle },
  { to: "/portal/program", label: "My Program", icon: FileText },
  { to: "/portal/lift-videos", label: "Lift Videos", icon: Video },
  { to: "/portal/media", label: "Media", icon: Film },
  { to: "/portal/nutrition-targets", label: "Nutrition Targets", icon: Apple },
  { to: "/portal/check-in", label: "Check-In", icon: ClipboardCheck },
  { to: "/portal/exercises", label: "Exercises", icon: Dumbbell },
  { to: "/portal/payments", label: "Payments", icon: CreditCard },
  { to: "/portal/purchases", label: "My Purchases", icon: Package },
  { to: "/portal/agreements", label: "Agreements", icon: FileSignature },
  { to: "/portal/resources", label: "Resources", icon: FolderOpen },
  { to: "/portal/calendar", label: "Calendar", icon: Calendar },
  { to: "/portal/documents", label: "Documents", icon: FileText },
  { to: "/portal/account", label: "Account Settings", icon: UserCog },
];