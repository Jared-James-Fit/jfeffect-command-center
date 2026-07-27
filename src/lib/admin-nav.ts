import {
  LayoutDashboard, Users, CreditCard, DollarSign,
  Package, Dumbbell, FolderOpen, Calendar, Layers,
  Settings, Briefcase, Apple, ClipboardCheck, UserCog, MessageCircle, Video,
  UserCheck, FileSignature, Film,
  ClipboardList, FileEdit,
  Scale, BookOpen, Activity, Archive,
  UserPlus, Library, Wrench, HelpCircle,
  ChefHat, Megaphone, Phone,
  ListChecks, LayoutGrid,
  Heart, Flame,
  Ticket,
  AlertCircle,
  Download,
} from "lucide-react";
import { Camera } from "lucide-react";
import { Sparkles } from "lucide-react";
import { ShoppingBag } from "lucide-react";
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
  { to: "/admin/popups", label: "Popups", icon: LayoutGrid, group: "Communication", keywords: ["popup", "popups", "pop up", "pop-up", "pop ups", "modal", "broadcast", "task popup", "load screen", "birthday card", "event popup"] },
  { to: "/admin/call-access", label: "Call Access", icon: Phone, group: "Communication" },
  { to: "/admin/settings/sms", label: "SMS Access", icon: MessageCircle, group: "Communication" },
  { to: "/admin/settings/chat", label: "Chat Settings", icon: MessageCircle, group: "Communication" },
  { to: "/admin/settings/notifications/coaching-applications", label: "Application Alerts", icon: MessageCircle, group: "Communication", keywords: ["application","coaching alerts","notifications","yannick","recipient"] },
  { to: "/admin/chat-gifs", label: "Chat GIF Library", icon: Sparkles, group: "Communication" },
  { to: "/admin/chat-sounds", label: "Chat Sound Library", icon: Sparkles, group: "Communication" },
  // MEMBERSHIP
  { to: "/admin/members", label: "App Members", icon: UserPlus, group: "Membership" },
  { to: "/admin/onboarding", label: "Onboarding", icon: ClipboardCheck, group: "Membership", keywords: ["install","setup","not signed in","checklist"] },
  { to: "/admin/member-plans", label: "Membership Workout Library", icon: Library, group: "Membership", keywords: ["membership library","workout library","plan library","publish program"] },
  { to: "/admin/member-resources", label: "Resources & Tools", icon: FolderOpen, group: "Membership" },
  // PROGRAMMING
  { to: "/admin/program-library", label: "Program Library", icon: BookOpen, group: "Programming" },
  { to: "/admin/exercises", label: "Exercise Library", icon: Dumbbell, group: "Programming" },
  { to: "/admin/cardio-targets", label: "Cardio Targets", icon: Heart, group: "Programming", keywords: ["card", "cardio", "targets", "conditioning", "steps", "hiit", "liss", "zone 2", "heart rate"] },
  { to: "/admin/nutrition-dashboard", label: "Nutrition Dashboard", icon: Apple, group: "Programming", keywords: ["nutrition", "macros", "calories", "due", "overdue", "submission", "check-in"] },
  { to: "/admin/warmup-protocols", label: "Warm-Up Protocols", icon: Flame, group: "Programming", keywords: ["warmup", "warm-up", "warm up", "sbd", "squat", "bench", "deadlift", "mobility"] },
  { to: "/admin/recipes", label: "Recipe Library", icon: ChefHat, group: "Programming" },
  { to: "/admin/native-forms", label: "Check-Ins & Forms", icon: FileEdit, group: "Programming" },
  { to: "/admin/fillout-submissions", label: "Fillout Submissions", icon: ClipboardList, group: "Programming" },
  { to: "/admin/faqs", label: "FAQ Manager", icon: HelpCircle, group: "Programming" },
  // BUSINESS
  { to: "/admin/sales/coaching-applications", label: "Coaching Applications", icon: ClipboardList, group: "Business" },
  { to: "/admin/crm", label: "CRM Dashboard", icon: UserCheck, group: "Business" },
  { to: "/admin/crm/contacts", label: "CRM Contacts", icon: Users, group: "Business" },
  { to: "/admin/payments", label: "Overview", icon: DollarSign, group: "Payments", keywords: ["dashboard","revenue","mrr"] },
  { to: "/admin/transactions", label: "Transactions", icon: Activity, group: "Payments", keywords: ["purchases","invoices","refunds","receipts"] },
  { to: "/admin/payment-links", label: "Products", icon: ShoppingBag, group: "Payments", keywords: ["offers","memberships","coaching","programs"] },
  { to: "/admin/discount-codes", label: "Discount Codes", icon: Ticket, group: "Payments", keywords: ["promo","coupon","referral"] },
  { to: "/admin/billing-sources", label: "Settings", icon: CreditCard, group: "Payments", keywords: ["stripe","taxes","webhooks","developer","legacy"] },
  { to: "/admin/legacy-migration", label: "Legacy Migration Board", icon: CreditCard, group: "Business", keywords: ["legacy","trainerize","migration","board","kanban"] },
  { to: "/admin/calendar", label: "Calendar", icon: Calendar, group: "Business", keywords: ["calendar", "appointments", "booking", "booking links", "pt calendar", "google calendar", "availability", "schedule"] },
  { to: "/admin/events", label: "Events", icon: Calendar, group: "Business" },
  // DOCUMENTS
  { to: "/admin/agreements", label: "Agreements", icon: FileSignature, group: "Documents" },
  { to: "/admin/agreements-native", label: "Native Agreements", icon: FileSignature, group: "Documents", keywords: ["native", "agreements", "snapshot", "sign"] },
  { to: "/admin/forms", label: "Forms", icon: FileEdit, group: "Documents" },
  { to: "/admin/resources", label: "Resources", icon: FolderOpen, group: "Documents" },
  // TEAM / OPS
  { to: "/admin/coaches", label: "Coaches", icon: UserCheck, group: "Team / Ops" },
  { to: "/admin/staff", label: "Staff & Media Managers", icon: UserPlus, group: "Team / Ops" },
  { to: "/admin/support-alerts", label: "Support Alerts", icon: AlertCircle, group: "Team / Ops" },
  { to: "/admin/approvals", label: "Approvals Queue", icon: ClipboardCheck, group: "Team / Ops" },
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

// Coaching-focused admin nav (the same as adminNav minus membership-only items).
export const coachingAdminNav: NavItem[] = [
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
  { to: "/admin/popups", label: "Popups", icon: LayoutGrid, group: "Communication", keywords: ["popup", "popups", "pop up", "pop-up", "pop ups", "modal", "broadcast", "task popup", "load screen", "birthday card", "event popup"] },
  { to: "/admin/call-access", label: "Call Access", icon: Phone, group: "Communication" },
  { to: "/admin/settings/sms", label: "SMS Access", icon: MessageCircle, group: "Communication" },
  { to: "/admin/settings/chat", label: "Chat Settings", icon: MessageCircle, group: "Communication" },
  { to: "/admin/chat-gifs", label: "Chat GIF Library", icon: Sparkles, group: "Communication" },
  { to: "/admin/chat-sounds", label: "Chat Sound Library", icon: Sparkles, group: "Communication" },
  { to: "/admin/settings/notifications/coaching-applications", label: "Application Alerts", icon: MessageCircle, group: "Communication", keywords: ["application","coaching alerts","notifications","yannick","recipient"] },
  // PROGRAMMING (coaching)
  { to: "/admin/program-library", label: "Program Library", icon: BookOpen, group: "Programming" },
  { to: "/admin/exercises", label: "Exercise Library", icon: Dumbbell, group: "Programming" },
  { to: "/admin/cardio-targets", label: "Cardio Targets", icon: Heart, group: "Programming", keywords: ["card", "cardio", "targets", "conditioning", "steps", "hiit", "liss", "zone 2", "heart rate"] },
  { to: "/admin/nutrition-dashboard", label: "Nutrition Dashboard", icon: Apple, group: "Programming", keywords: ["nutrition", "macros", "calories", "due", "overdue", "submission", "check-in"] },
  { to: "/admin/warmup-protocols", label: "Warm-Up Protocols", icon: Flame, group: "Programming", keywords: ["warmup", "warm-up", "warm up", "sbd", "squat", "bench", "deadlift", "mobility"] },
  { to: "/admin/recipes", label: "Recipe Library", icon: ChefHat, group: "Programming" },
  { to: "/admin/native-forms", label: "Check-Ins & Forms", icon: FileEdit, group: "Programming" },
  { to: "/admin/fillout-submissions", label: "Fillout Submissions", icon: ClipboardList, group: "Programming" },
  { to: "/admin/faqs", label: "FAQ Manager", icon: HelpCircle, group: "Programming" },
  // BUSINESS
  { to: "/admin/sales/coaching-applications", label: "Coaching Applications", icon: ClipboardList, group: "Business" },
  { to: "/admin/crm", label: "CRM Dashboard", icon: UserCheck, group: "Business" },
  { to: "/admin/crm/contacts", label: "CRM Contacts", icon: Users, group: "Business" },
  { to: "/admin/payments", label: "Overview", icon: DollarSign, group: "Payments", keywords: ["dashboard","revenue","mrr"] },
  { to: "/admin/transactions", label: "Transactions", icon: Activity, group: "Payments", keywords: ["purchases","invoices","refunds","receipts"] },
  { to: "/admin/payment-links", label: "Products", icon: ShoppingBag, group: "Payments", keywords: ["offers","memberships","coaching","programs"] },
  { to: "/admin/discount-codes", label: "Discount Codes", icon: Ticket, group: "Payments", keywords: ["promo","coupon","referral"] },
  { to: "/admin/billing-sources", label: "Settings", icon: CreditCard, group: "Payments", keywords: ["stripe","taxes","webhooks","developer"] },
  { to: "/admin/calendar", label: "Calendar", icon: Calendar, group: "Business", keywords: ["calendar", "appointments", "booking", "booking links", "pt calendar", "google calendar", "availability", "schedule"] },
  { to: "/admin/events", label: "Events", icon: Calendar, group: "Business" },
  // DOCUMENTS
  { to: "/admin/agreements", label: "Agreements", icon: FileSignature, group: "Documents" },
  { to: "/admin/forms", label: "Forms", icon: FileEdit, group: "Documents" },
  { to: "/admin/resources", label: "Resources", icon: FolderOpen, group: "Documents" },
  // TEAM / OPS
  { to: "/admin/coaches", label: "Coaches", icon: UserCheck, group: "Team / Ops" },
  { to: "/admin/staff", label: "Staff & Media Managers", icon: UserPlus, group: "Team / Ops" },
  { to: "/admin/support-alerts", label: "Support Alerts", icon: AlertCircle, group: "Team / Ops" },
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
  { to: "/admin/support-alerts", label: "Support Alerts", icon: AlertCircle },
  { to: "/admin/media-review", label: "Media Review Inbox", icon: Film },
  { to: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone },
  { to: "/admin/recipes", label: "Recipe Library", icon: ChefHat },
  { to: "/admin/calendar", label: "Calendar", icon: Calendar, keywords: ["calendar", "appointments", "booking", "booking links", "pt calendar", "google calendar", "availability", "schedule"] },
  { to: "/admin/exercises", label: "Exercise Library", icon: Dumbbell },
  { to: "/admin/program-library", label: "Program Library", icon: BookOpen },
  { to: "/admin/resources", label: "Resources", icon: FolderOpen },
  { to: "/admin/account", label: "My Account", icon: UserCog },
  { to: "/admin/floating-bar", label: "Floating Bar", icon: LayoutGrid },
];

export const clientNav: NavItem[] = [
  { to: "/portal", label: "Home", icon: LayoutDashboard },
  { to: "/portal/goals-setup", label: "Goals & Setup", icon: ClipboardCheck },
  { to: "/portal/messages", label: "Messages", icon: MessageCircle },
  { to: "/portal/workouts", label: "Workouts", icon: Activity },
  { to: "/portal/progress", label: "Progress", icon: Camera, keywords: ["progress","photos","videos","bodyweight","measurements","check-in","compare"] },
  { to: "/portal/lift-videos", label: "Coach Feedback", icon: Video },
  { to: "/portal/nutrition-targets", label: "Nutrition", icon: Apple, keywords: ["nutrition","macros","targets","recipes","meals"] },
  { to: "/portal/check-ins", label: "Check-Ins & Forms", icon: ClipboardCheck },
  { to: "/portal/announcements", label: "Announcements", icon: Megaphone },
  { to: "/portal/exercises", label: "Exercises", icon: Dumbbell },
  { to: "/portal/purchases", label: "My Purchases", icon: Package },
  { to: "/portal/agreements", label: "Agreements", icon: FileSignature },
  { to: "/portal/resources", label: "Resources", icon: FolderOpen },
  { to: "/portal/calendar", label: "Calendar", icon: Calendar },
  { to: "/portal/appointments", label: "Appointments", icon: Calendar },
  { to: "/portal/events", label: "Events", icon: Calendar },
  { to: "/portal/account", label: "Account Settings", icon: Settings },
];

// Mobile bottom-tab nav for the client portal. Max 5 single-word labels so
// nothing wraps and tap targets stay large. Everything else lives in the
// side drawer (clientNav) via the "More" trigger in AppShell.
export const clientBottomNav: NavItem[] = [
  { to: "/portal", label: "Home", icon: LayoutDashboard },
  { to: "/portal/workouts", label: "Workouts", icon: Activity },
  { to: "/portal/messages", label: "Messages", icon: MessageCircle },
  { to: "/portal/nutrition-targets", label: "Nutrition", icon: Apple },
];

// App Member portal navigation
export const memberNav: NavItem[] = [
  { to: "/m", label: "Home", icon: LayoutDashboard },
  { to: "/m/workouts", label: "Workouts", icon: Activity, keywords: ["plans","program","training","library"] },
  { to: "/m/nutrition", label: "Nutrition", icon: ChefHat, keywords: ["recipes","targets","meal"] },
  { to: "/m/support", label: "Support", icon: MessageCircle, keywords: ["help","messages","contact"] },
  { to: "/m/more", label: "More", icon: UserCog, keywords: ["account","billing","profile","settings","manage","receipts","agreements","announcements","tools","progress","install"] },
];

// Mobile bottom-tab nav for the App Member portal. Five short labels max.
// Coaching-style structure: Home / Workouts / Nutrition / Support.
// "More" is intentionally excluded — the shared AppShell renders a "More"
// drawer trigger as the trailing slot on mobile, which surfaces every
// remaining section (Account, Billing, Progress, Tools, etc.) without
// duplicating a bottom-bar item.
export const memberBottomNav: NavItem[] = [
  { to: "/m", label: "Home", icon: LayoutDashboard },
  { to: "/m/workouts", label: "Workouts", icon: Activity },
  { to: "/m/nutrition", label: "Nutrition", icon: ChefHat },
  { to: "/m/support", label: "Support", icon: MessageCircle },
];