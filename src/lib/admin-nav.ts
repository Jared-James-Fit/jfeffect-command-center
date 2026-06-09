import {
  LayoutDashboard, Users, CreditCard, DollarSign,
  Package, FileText, Dumbbell, FolderOpen, Calendar, Layers,
  Settings, Briefcase, Apple, ClipboardCheck, UserCog, MessageCircle, Video,
  UserCheck, FileSignature, Film,
  ClipboardList, FileEdit,
  Scale, BookOpen, Activity, Archive,
  UserPlus, Library, Wrench, HelpCircle,
} from "lucide-react";
import type { NavItem } from "@/components/app-shell";

export const adminNav: NavItem[] = [
  // CORE
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, group: "Core" },
  { to: "/admin/clients", label: "Coaching Clients", icon: Users, group: "Core" },
  { to: "/admin/messages", label: "Messages", icon: MessageCircle, group: "Core" },
  { to: "/admin/check-in-reviews", label: "Check-In Reviews", icon: ClipboardList, group: "Core" },
  { to: "/admin/lift-videos", label: "Lift Reviews", icon: Video, group: "Core" },
  { to: "/admin/training-intelligence", label: "Training Intel", icon: Activity, group: "Core" },
  // MEMBERSHIP
  { to: "/admin/members", label: "App Members", icon: UserPlus, group: "Membership" },
  { to: "/admin/member-plans", label: "Plan Library", icon: Library, group: "Membership" },
  { to: "/admin/member-resources", label: "Resources & Tools", icon: FolderOpen, group: "Membership" },
  // PROGRAMMING
  { to: "/admin/program-library", label: "Program Library", icon: BookOpen, group: "Programming" },
  { to: "/admin/exercises", label: "Exercise Library", icon: Dumbbell, group: "Programming" },
  { to: "/admin/native-forms", label: "Check-Ins & Forms", icon: FileEdit, group: "Programming" },
  { to: "/admin/faqs", label: "FAQ Manager", icon: HelpCircle, group: "Programming" },
  // BUSINESS
  { to: "/admin/payment-links", label: "Products", icon: CreditCard, group: "Business" },
  { to: "/admin/payments", label: "Payments", icon: DollarSign, group: "Business" },
  { to: "/admin/purchases", label: "Purchases", icon: ClipboardCheck, group: "Business" },
  { to: "/admin/calendar", label: "Calendar", icon: Calendar, group: "Business" },
  // DOCUMENTS
  { to: "/admin/agreements", label: "Agreements", icon: FileSignature, group: "Documents" },
  { to: "/admin/forms", label: "Forms", icon: FileEdit, group: "Documents" },
  { to: "/admin/resources", label: "Resources", icon: FolderOpen, group: "Documents" },
  // TEAM / OPS
  { to: "/admin/coaches", label: "Coaches", icon: UserCheck, group: "Team / Ops" },
  { to: "/admin/media-review", label: "Media Inbox", icon: Film, group: "Team / Ops" },
  { to: "/admin/media-archives", label: "Media Archives", icon: FolderOpen, group: "Team / Ops" },
  { to: "/admin/apps", label: "Integrations", icon: Layers, group: "Team / Ops" },
  { to: "/admin/business-systems", label: "Operations", icon: Briefcase, group: "Team / Ops" },
  { to: "/admin/archives", label: "Archive Manager", icon: Archive, group: "Team / Ops" },
  // ACCOUNT
  { to: "/admin/account", label: "Account", icon: UserCog, group: "Account" },
  { to: "/admin/settings", label: "Settings", icon: Settings, group: "Account" },
];

// Coach navigation: same client-coaching tools as admin, without business/admin sections.
export const coachNav: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/clients", label: "My Clients", icon: Users },
  { to: "/admin/training-intelligence", label: "Training Intelligence", icon: Activity },
  { to: "/admin/messages", label: "Messages", icon: MessageCircle },
  { to: "/admin/lift-videos", label: "Lift Reviews", icon: Video },
  { to: "/admin/check-in-reviews", label: "Check-In Reviews", icon: ClipboardList },
  { to: "/admin/media-review", label: "Media Review Inbox", icon: Film },
  { to: "/admin/calendar", label: "Calendar", icon: Calendar },
  { to: "/admin/exercises", label: "Exercise Library", icon: Dumbbell },
  { to: "/admin/program-library", label: "Program Library", icon: BookOpen },
  { to: "/admin/resources", label: "Resources", icon: FolderOpen },
  { to: "/admin/account", label: "My Account", icon: UserCog },
];

export const clientNav: NavItem[] = [
  { to: "/portal", label: "Dashboard", icon: LayoutDashboard },
  { to: "/portal/messages", label: "Messages", icon: MessageCircle },
  { to: "/portal/workouts", label: "Workouts", icon: Activity },
  { to: "/portal/lift-videos", label: "Lift Review Upload", icon: Video },
  { to: "/portal/nutrition-targets", label: "Nutrition", icon: Apple },
  { to: "/portal/check-ins", label: "Check-Ins & Forms", icon: ClipboardCheck },
  { to: "/portal/progress-metrics", label: "Progress Metrics", icon: Scale },
  { to: "/portal/exercises", label: "Exercises", icon: Dumbbell },
  { to: "/portal/purchases", label: "My Purchases", icon: Package },
  { to: "/portal/agreements", label: "Agreements", icon: FileSignature },
  { to: "/portal/resources", label: "Resources", icon: FolderOpen },
  { to: "/portal/calendar", label: "Calendar", icon: Calendar },
  { to: "/portal/documents", label: "Documents", icon: FileText },
  { to: "/portal/account", label: "Account Settings", icon: Settings },
];

// App Member portal navigation
export const memberNav: NavItem[] = [
  { to: "/m", label: "Dashboard", icon: LayoutDashboard },
  { to: "/m/my-plans", label: "My Plans", icon: ClipboardCheck },
  { to: "/m/plans", label: "Program Library", icon: BookOpen },
  { to: "/m/resources", label: "Resources", icon: FolderOpen },
  { to: "/m/tools", label: "Tools", icon: Wrench },
  { to: "/m/account", label: "My Account", icon: UserCog },
];