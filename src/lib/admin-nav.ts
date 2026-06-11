import {
  LayoutDashboard, Users, CreditCard, DollarSign,
  Package, FileText, Dumbbell, FolderOpen, Calendar, Layers,
  Settings, Briefcase, Apple, ClipboardCheck, UserCog, MessageCircle, Video,
  UserCheck, FileSignature, Film,
  ClipboardList, FileEdit,
  Scale, BookOpen, Activity, Archive,
  UserPlus, Library, Wrench, HelpCircle,
  ChefHat, Megaphone, Phone, Link2 as LinkIcon,
  ListChecks, LayoutGrid,
  Heart, Flame,
} from "lucide-react";
import { Sparkles } from "lucide-react";
import type { NavItem } from "@/components/app-shell";

export const adminNav: NavItem[] = [
  // CORE
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, group: "Core" },
  { to: "/admin/clients", label: "Coaching Clients", icon: Users, group: "Core" },
  { to: "/admin/tasks", label: "Tasks", icon: ListChecks, group: "Core" },
  { to: "/admin/messages", label: "Messages", icon: MessageCircle, group: "Core" },
  { to: "/admin/check-in-reviews", label: "Check-In Reviews", icon: ClipboardList, group: "Core" },
  { to: "/admin/lift-videos", label: "Lift Reviews", icon: Video, group: "Core" },
  { to: "/admin/training-intelligence", label: "Training Intel", icon: Activity, group: "Core" },
  { to: "/admin/client-action-requests", label: "Action Requests", icon: ClipboardCheck, group: "Core" },
  // COMMUNICATION
  { to: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone, group: "Communication" },
  { to: "/admin/call-access", label: "Call Access", icon: Phone, group: "Communication" },
  { to: "/admin/settings/sms", label: "SMS Access", icon: MessageCircle, group: "Communication" },
  { to: "/admin/settings/chat", label: "Chat Settings", icon: MessageCircle, group: "Communication" },
  { to: "/admin/chat-gifs", label: "Chat GIF Library", icon: Sparkles, group: "Communication" },
  { to: "/admin/chat-sounds", label: "Chat Sound Library", icon: Sparkles, group: "Communication" },
  // MEMBERSHIP
  { to: "/admin/members", label: "App Members", icon: UserPlus, group: "Membership" },
  { to: "/admin/member-plans", label: "Plan Library", icon: Library, group: "Membership" },
  { to: "/admin/member-resources", label: "Resources & Tools", icon: FolderOpen, group: "Membership" },
  // PROGRAMMING
  { to: "/admin/program-library", label: "Program Library", icon: BookOpen, group: "Programming" },
  { to: "/admin/exercises", label: "Exercise Library", icon: Dumbbell, group: "Programming" },
  { to: "/admin/cardio-targets", label: "Cardio Targets", icon: Heart, group: "Programming", keywords: ["card", "cardio", "targets", "conditioning", "steps", "hiit", "liss", "zone 2", "heart rate"] },
  { to: "/admin/warmup-protocols", label: "Warm-Up Protocols", icon: Flame, group: "Programming", keywords: ["warmup", "warm-up", "warm up", "sbd", "squat", "bench", "deadlift", "mobility"] },
  { to: "/admin/recipes", label: "Recipe Library", icon: ChefHat, group: "Programming" },
  { to: "/admin/native-forms", label: "Check-Ins & Forms", icon: FileEdit, group: "Programming" },
  { to: "/admin/fillout-submissions", label: "Fillout Submissions", icon: ClipboardList, group: "Programming" },
  { to: "/admin/faqs", label: "FAQ Manager", icon: HelpCircle, group: "Programming" },
  // BUSINESS
  { to: "/admin/sales/membership", label: "Membership Sales Page", icon: Sparkles, group: "Business" },
  { to: "/admin/sales/coaching", label: "Coaching Sales Page", icon: Sparkles, group: "Business" },
  { to: "/admin/sales/coaching-applications", label: "Coaching Applications", icon: ClipboardList, group: "Business" },
  { to: "/admin/payment-links", label: "Products", icon: CreditCard, group: "Business" },
  { to: "/admin/payments", label: "Payments", icon: DollarSign, group: "Business" },
  { to: "/admin/purchases", label: "Purchases", icon: ClipboardCheck, group: "Business" },
  { to: "/admin/calendar", label: "PT Calendar", icon: Calendar, group: "Business" },
  { to: "/admin/appointments", label: "Appointments", icon: Calendar, group: "Business" },
  { to: "/admin/booking-links", label: "Booking Links", icon: LinkIcon, group: "Business" },
  { to: "/admin/google-calendar", label: "Google Calendar", icon: Calendar, group: "Business" },
  { to: "/admin/events", label: "Events", icon: Calendar, group: "Business" },
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
  { to: "/admin/floating-bar", label: "Floating Bar", icon: LayoutGrid, group: "Account" },
];

// Coaching-focused admin nav (the same as adminNav minus membership-only items,
// with a single shortcut to the Membership Admin Dashboard at the top).
export const coachingAdminNav: NavItem[] = [
  // SHORTCUT to membership mode
  { to: "/admin/membership", label: "JF Membership Dashboard", icon: Sparkles, group: "Core" },
  // CORE
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, group: "Core" },
  { to: "/admin/clients", label: "Coaching Clients", icon: Users, group: "Core" },
  { to: "/admin/tasks", label: "Tasks", icon: ListChecks, group: "Core" },
  { to: "/admin/messages", label: "Messages", icon: MessageCircle, group: "Core" },
  { to: "/admin/check-in-reviews", label: "Check-In Reviews", icon: ClipboardList, group: "Core" },
  { to: "/admin/lift-videos", label: "Lift Reviews", icon: Video, group: "Core" },
  { to: "/admin/training-intelligence", label: "Training Intel", icon: Activity, group: "Core" },
  { to: "/admin/client-action-requests", label: "Action Requests", icon: ClipboardCheck, group: "Core" },
  // COMMUNICATION
  { to: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone, group: "Communication" },
  { to: "/admin/call-access", label: "Call Access", icon: Phone, group: "Communication" },
  { to: "/admin/settings/sms", label: "SMS Access", icon: MessageCircle, group: "Communication" },
  { to: "/admin/settings/chat", label: "Chat Settings", icon: MessageCircle, group: "Communication" },
  { to: "/admin/chat-gifs", label: "Chat GIF Library", icon: Sparkles, group: "Communication" },
  { to: "/admin/chat-sounds", label: "Chat Sound Library", icon: Sparkles, group: "Communication" },
  // PROGRAMMING (coaching)
  { to: "/admin/program-library", label: "Program Library", icon: BookOpen, group: "Programming" },
  { to: "/admin/exercises", label: "Exercise Library", icon: Dumbbell, group: "Programming" },
  { to: "/admin/cardio-targets", label: "Cardio Targets", icon: Heart, group: "Programming", keywords: ["card", "cardio", "targets", "conditioning", "steps", "hiit", "liss", "zone 2", "heart rate"] },
  { to: "/admin/recipes", label: "Recipe Library", icon: ChefHat, group: "Programming" },
  { to: "/admin/native-forms", label: "Check-Ins & Forms", icon: FileEdit, group: "Programming" },
  { to: "/admin/fillout-submissions", label: "Fillout Submissions", icon: ClipboardList, group: "Programming" },
  { to: "/admin/faqs", label: "FAQ Manager", icon: HelpCircle, group: "Programming" },
  // BUSINESS
  { to: "/admin/sales/coaching", label: "Coaching Sales Page", icon: Sparkles, group: "Business" },
  { to: "/admin/sales/coaching-applications", label: "Coaching Applications", icon: ClipboardList, group: "Business" },
  { to: "/admin/payment-links", label: "Products", icon: CreditCard, group: "Business" },
  { to: "/admin/payments", label: "Payments", icon: DollarSign, group: "Business" },
  { to: "/admin/purchases", label: "Purchases", icon: ClipboardCheck, group: "Business" },
  { to: "/admin/calendar", label: "PT Calendar", icon: Calendar, group: "Business" },
  { to: "/admin/appointments", label: "Appointments", icon: Calendar, group: "Business" },
  { to: "/admin/booking-links", label: "Booking Links", icon: LinkIcon, group: "Business" },
  { to: "/admin/google-calendar", label: "Google Calendar", icon: Calendar, group: "Business" },
  { to: "/admin/events", label: "Events", icon: Calendar, group: "Business" },
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
  { to: "/admin/floating-bar", label: "Floating Bar", icon: LayoutGrid, group: "Account" },
];

// Coach navigation: same client-coaching tools as admin, without business/admin sections.
export const coachNav: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/clients", label: "My Clients", icon: Users },
  { to: "/admin/tasks", label: "Tasks", icon: ListChecks },
  { to: "/admin/training-intelligence", label: "Training Intelligence", icon: Activity },
  { to: "/admin/messages", label: "Messages", icon: MessageCircle },
  { to: "/admin/lift-videos", label: "Lift Reviews", icon: Video },
  { to: "/admin/check-in-reviews", label: "Check-In Reviews", icon: ClipboardList },
  { to: "/admin/client-action-requests", label: "Action Requests", icon: ClipboardCheck },
  { to: "/admin/media-review", label: "Media Review Inbox", icon: Film },
  { to: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone },
  { to: "/admin/recipes", label: "Recipe Library", icon: ChefHat },
  { to: "/admin/calendar", label: "PT Calendar", icon: Calendar },
  { to: "/admin/appointments", label: "Appointments", icon: Calendar },
  { to: "/admin/booking-links", label: "Booking Links", icon: LinkIcon },
  { to: "/admin/google-calendar", label: "Google Calendar", icon: Calendar },
  { to: "/admin/exercises", label: "Exercise Library", icon: Dumbbell },
  { to: "/admin/program-library", label: "Program Library", icon: BookOpen },
  { to: "/admin/resources", label: "Resources", icon: FolderOpen },
  { to: "/admin/account", label: "My Account", icon: UserCog },
  { to: "/admin/floating-bar", label: "Floating Bar", icon: LayoutGrid },
];

export const clientNav: NavItem[] = [
  { to: "/portal", label: "Dashboard", icon: LayoutDashboard },
  { to: "/portal/messages", label: "Messages", icon: MessageCircle },
  { to: "/portal/workouts", label: "Workouts", icon: Activity },
  { to: "/portal/lift-videos", label: "Lift Review Upload", icon: Video },
  { to: "/portal/nutrition-targets", label: "Nutrition", icon: Apple },
  { to: "/portal/recipes", label: "Recipes", icon: ChefHat },
  { to: "/portal/check-ins", label: "Check-Ins & Forms", icon: ClipboardCheck },
  { to: "/portal/announcements", label: "Announcements", icon: Megaphone },
  { to: "/portal/progress-metrics", label: "Progress Metrics", icon: Scale },
  { to: "/portal/exercises", label: "Exercises", icon: Dumbbell },
  { to: "/portal/purchases", label: "My Purchases", icon: Package },
  { to: "/portal/agreements", label: "Agreements", icon: FileSignature },
  { to: "/portal/resources", label: "Resources", icon: FolderOpen },
  { to: "/portal/calendar", label: "Calendar", icon: Calendar },
  { to: "/portal/appointments", label: "Appointments", icon: Calendar },
  { to: "/portal/events", label: "Events", icon: Calendar },
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
  { to: "/m/announcements", label: "Announcements", icon: Megaphone },
  { to: "/m/billing", label: "Billing", icon: CreditCard },
  { to: "/m/account", label: "My Account", icon: UserCog },
];