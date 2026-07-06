/**
 * Shared, role-aware internal navigation registry.
 *
 * Trainerize-style IA: a clean primary menu with subpages that expand into a
 * secondary panel. Top-level groups:
 *
 *   MAIN: Overview · Messages · Clients · Payments · Programming ·
 *         Scheduling · Business · Team
 *   OTHER: Add-ons · Settings
 *
 * No URLs are deleted here — every entry points at an existing route so old
 * bookmarks keep working. The `AppShell` groups by the `group` field on each
 * `NavItem` and renders each group as a collapsible section.
 *
 * Role visibility is enforced at the NAV level (what's shown in the sidebar)
 * only. Route-level access continues to be enforced by `_authenticated/route`
 * and per-route loaders / RLS. Hiding a link is not security; see the route
 * guards and database RLS policies for the security boundary.
 */
import {
  LayoutDashboard, Users, ClipboardList, Video, Activity, ClipboardCheck,
  Dumbbell, Heart, Flame, ChefHat, BookOpen, FileEdit, HelpCircle,
  MessageCircle, Megaphone, LayoutGrid, Phone, Sparkles, MessagesSquare,
  UserCheck, CreditCard, DollarSign, Ticket, Calendar, Film, FolderOpen,
  Layers, Briefcase, Archive, UserPlus, UserCog, Settings, AlertCircle,
  FileSignature, ShoppingBag, Library, KeyRound, BarChart3, RefreshCw,
  Link as LinkIcon, Trophy, Tag, ShieldCheck,
  Home as HomeIcon,
  ListChecks, Upload, Star, FileText, ExternalLink, Image as ImageIcon,
  PowerOff,
} from "lucide-react";
import type { NavItem } from "@/components/app-shell";

/** Internal staff role tags used for nav visibility.
 *
 *  `admin`, `coach`, `media_manager` already exist in the `app_role` enum.
 *  The other tags (`assistant_coach`, `sales`, `support`, `operations`,
 *  `staff`) are nav-only tags today — the database role enum does NOT yet
 *  include them. When/if those roles are added to the enum + RLS, the
 *  `resolveStaffRoleTag` helper below should be extended to map them. */
export type StaffRoleTag =
  | "admin"
  | "coach"
  | "assistant_coach"
  | "media_manager"
  | "sales"
  | "support"
  | "operations"
  | "staff";

/** Workspace identifier — drives the sidebar group label and ordering. */
export type WorkspaceKey =
  | "Overview"
  | "Messages"
  | "Clients"
  | "Payments"
  | "Programming"
  | "Scheduling"
  | "Business"
  | "Team"
  | "Add-ons"
  | "Settings";

export const WORKSPACE_ORDER: WorkspaceKey[] = [
  "Overview", "Messages", "Clients", "Payments", "Programming",
  "Scheduling", "Business", "Team", "Add-ons", "Settings",
];

type Entry = NavItem & { visibleTo: StaffRoleTag[] };

/** All workspace items. `group` MUST be a WorkspaceKey so the shell groups it. */
const REGISTRY: Entry[] = [
  // ── OVERVIEW ─────────────────────────────────────────────────────────
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, group: "Overview",
    visibleTo: ["admin", "coach", "assistant_coach", "media_manager", "sales", "support", "operations", "staff"] },
  { to: "/admin/tasks", label: "Tasks", icon: ListChecks, group: "Overview",
    visibleTo: ["admin", "coach", "assistant_coach", "sales", "support", "operations"] },
  { to: "/admin/support-alerts", label: "Support Alerts", icon: AlertCircle, group: "Overview",
    visibleTo: ["admin", "coach", "support"] },

  // ── MESSAGES ─────────────────────────────────────────────────────────
  { to: "/admin/messages", label: "Messages", icon: MessageCircle, group: "Messages",
    visibleTo: ["admin", "coach", "assistant_coach", "sales", "support"] },
  { to: "/admin/communication", label: "Communication Hub", icon: MessagesSquare, group: "Messages",
    visibleTo: ["admin", "coach", "assistant_coach", "media_manager", "sales", "support"],
    keywords: ["inbox", "chat", "direct messages", "group chat", "support inbox"] },
  { to: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone, group: "Messages",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/popups", label: "Popups", icon: LayoutGrid, group: "Messages",
    visibleTo: ["admin"], keywords: ["popup", "modal", "birthday cards", "task popup", "load screen"] },
  { to: "/admin/chat-gifs", label: "Chat GIF Library", icon: Sparkles, group: "Messages",
    visibleTo: ["admin"] },
  { to: "/admin/chat-sounds", label: "Chat Sound Library", icon: Sparkles, group: "Messages",
    visibleTo: ["admin"] },

  // ── CLIENTS ──────────────────────────────────────────────────────────
  { to: "/admin/clients", label: "Clients", icon: Users, group: "Clients",
    visibleTo: ["admin", "coach", "assistant_coach", "sales", "support"] },
  { to: "/admin/coaching", label: "Coaching Hub", icon: ClipboardList, group: "Clients",
    visibleTo: ["admin", "coach", "assistant_coach"],
    keywords: ["coaching", "check-ins", "lift reviews", "training intelligence", "action requests"] },
  { to: "/admin/check-in-reviews", label: "Check-In Reviews", icon: ClipboardCheck, group: "Clients",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/lift-videos", label: "Lift Reviews", icon: Video, group: "Clients",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/client-action-requests", label: "Action Requests", icon: ClipboardCheck, group: "Clients",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/training-intelligence", label: "Training Intel", icon: Activity, group: "Clients",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/agreements", label: "Client Agreements", icon: FileSignature, group: "Clients",
    visibleTo: ["admin", "coach"] },
  { to: "/admin/members", label: "App Members", icon: UserPlus, group: "Clients",
    visibleTo: ["admin"] },

  // ── PAYMENTS ─────────────────────────────────────────────────────────
  { to: "/admin/transactions", label: "Transactions", icon: Activity, group: "Payments",
    visibleTo: ["admin", "sales"],
    keywords: ["transactions", "payments", "history", "stripe", "purchases", "receipts", "refunds"] },
  { to: "/admin/products-history", label: "Product Sales", icon: BarChart3, group: "Payments",
    visibleTo: ["admin", "sales"],
    keywords: ["product history", "product sales", "offer history", "sales by product"] },
  { to: "/admin/payment-links", label: "Products / Offers", icon: ShoppingBag, group: "Payments",
    visibleTo: ["admin", "sales"],
    keywords: ["products", "offers", "checkout links", "payment links", "stripe"] },
  { to: "/admin/sales", label: "Sales", icon: DollarSign, group: "Payments",
    visibleTo: ["admin", "sales", "media_manager", "support"],
    keywords: ["sales", "revenue", "orders"] },
  { to: "/admin/purchases", label: "Invoices", icon: FileText, group: "Payments",
    visibleTo: ["admin", "sales", "support"], keywords: ["invoices", "purchases", "receipts"] },
  { to: "/admin/membership/billing-events", label: "Stripe Webhook Events", icon: Activity, group: "Payments",
    visibleTo: ["admin"], keywords: ["stripe events", "webhooks", "billing events"] },
  { to: "/admin/promo-codes", label: "Discount Codes", icon: Ticket, group: "Payments",
    visibleTo: ["admin", "sales"], keywords: ["promo", "discount", "coupon"] },
  { to: "/admin/discount-codes", label: "Stripe Discount Codes", icon: Tag, group: "Payments",
    visibleTo: ["admin"], keywords: ["stripe coupon", "discount"] },
  { to: "/admin/sales/coaching", label: "Coaching Sales Page", icon: Sparkles, group: "Payments",
    visibleTo: ["admin", "sales"], keywords: ["sales channels", "coaching page"] },
  { to: "/admin/sales/membership", label: "Membership Sales Page", icon: Sparkles, group: "Payments",
    visibleTo: ["admin", "sales"], keywords: ["sales channels", "membership page"] },
  { to: "/admin/billing-sources", label: "Setup", icon: CreditCard, group: "Payments",
    visibleTo: ["admin"], keywords: ["stripe setup", "billing sources", "payment setup", "tax", "checkout settings"] },

  // ── PROGRAMMING ──────────────────────────────────────────────────────
  { to: "/admin/programming", label: "Programs", icon: BookOpen, group: "Programming",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/program-library", label: "Program Library", icon: Library, group: "Programming",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/exercises", label: "Exercise Library", icon: Dumbbell, group: "Programming",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/cardio-targets", label: "Cardio Targets", icon: Heart, group: "Programming",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/warmup-protocols", label: "Warm-Up Protocols", icon: Flame, group: "Programming",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/nutrition-dashboard", label: "Nutrition", icon: ChefHat, group: "Programming",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/recipes", label: "Recipe Library", icon: ChefHat, group: "Programming",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/native-forms", label: "Check-Ins & Forms", icon: FileEdit, group: "Programming",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/forms", label: "Form Builder", icon: FileEdit, group: "Programming",
    visibleTo: ["admin", "coach"] },
  { to: "/admin/fillout-submissions", label: "Fillout Submissions", icon: ClipboardList, group: "Programming",
    visibleTo: ["admin", "coach"] },

  // ── SCHEDULING ───────────────────────────────────────────────────────
  { to: "/admin/calendar", label: "Calendar", icon: Calendar, group: "Scheduling",
    visibleTo: ["admin", "coach", "assistant_coach", "sales", "support", "operations", "media_manager"] },
  { to: "/admin/appointments", label: "Appointments", icon: Calendar, group: "Scheduling",
    visibleTo: ["admin", "coach", "sales"] },
  { to: "/admin/booking-links", label: "Booking Links", icon: LinkIcon, group: "Scheduling",
    visibleTo: ["admin", "coach", "sales"] },
  { to: "/admin/events", label: "Events", icon: Calendar, group: "Scheduling",
    visibleTo: ["admin", "coach"] },
  { to: "/admin/google-calendar", label: "Google Calendar", icon: Calendar, group: "Scheduling",
    visibleTo: ["admin", "coach"] },

  // ── BUSINESS ─────────────────────────────────────────────────────────
  { to: "/admin/crm", label: "CRM Dashboard", icon: UserCheck, group: "Business",
    visibleTo: ["admin", "sales"] },
  { to: "/admin/crm/contacts", label: "Leads & Contacts", icon: Users, group: "Business",
    visibleTo: ["admin", "sales"] },
  { to: "/admin/sales/coaching-applications", label: "Coaching Applications", icon: ClipboardList, group: "Business",
    visibleTo: ["admin", "sales", "coach"] },
  { to: "/admin/content", label: "Website & Content", icon: Film, group: "Business",
    visibleTo: ["admin", "media_manager", "operations"],
    keywords: ["website", "landing pages", "content", "marketing"] },
  { to: "/admin/content-ideas", label: "Content Ideas", icon: Sparkles, group: "Business",
    visibleTo: ["admin", "media_manager"] },
  { to: "/admin/testimonials", label: "Testimonials", icon: Star, group: "Business",
    visibleTo: ["admin", "media_manager"], keywords: ["transformations", "reviews", "proof"] },
  { to: "/admin/business-systems", label: "Operations", icon: Briefcase, group: "Business",
    visibleTo: ["admin", "operations"] },
  { to: "/admin/legal", label: "Legal", icon: FileSignature, group: "Business",
    visibleTo: ["admin"] },

  // ── TEAM ─────────────────────────────────────────────────────────────
  { to: "/admin/team", label: "Team", icon: Users, group: "Team",
    visibleTo: ["admin", "operations"] },
  { to: "/admin/coaches", label: "Coaches", icon: UserCheck, group: "Team",
    visibleTo: ["admin", "operations"] },
  { to: "/admin/staff", label: "Staff & Media Managers", icon: UserPlus, group: "Team",
    visibleTo: ["admin", "operations"] },
  { to: "/admin/approvals", label: "Approvals Queue", icon: ClipboardCheck, group: "Team",
    visibleTo: ["admin", "operations"] },
  { to: "/admin/media-review", label: "Media Inbox", icon: Film, group: "Team",
    visibleTo: ["admin", "media_manager", "operations"] },
  { to: "/admin/media-archives", label: "Media Archives", icon: FolderOpen, group: "Team",
    visibleTo: ["admin", "media_manager", "operations"] },

  // ── ADD-ONS ──────────────────────────────────────────────────────────
  { to: "/admin/apps", label: "Integrations", icon: Layers, group: "Add-ons",
    visibleTo: ["admin"] },
  { to: "/admin/call-access", label: "Call Access", icon: Phone, group: "Add-ons",
    visibleTo: ["admin"] },
  { to: "/admin/settings/sms", label: "SMS Access", icon: MessageCircle, group: "Add-ons",
    visibleTo: ["admin"] },

  // ── SETTINGS ─────────────────────────────────────────────────────────
  { to: "/admin/settings", label: "App Settings", icon: Settings, group: "Settings",
    visibleTo: ["admin", "coach", "assistant_coach", "sales", "support", "operations", "staff"] },
  { to: "/admin/account", label: "Account", icon: UserCog, group: "Settings",
    visibleTo: ["admin", "coach", "assistant_coach", "media_manager", "sales", "support", "operations", "staff"] },
  { to: "/admin/faqs", label: "FAQ Manager", icon: HelpCircle, group: "Settings",
    visibleTo: ["admin", "coach"] },
  { to: "/admin/onboarding", label: "Onboarding", icon: ClipboardCheck, group: "Settings",
    visibleTo: ["admin"] },
  { to: "/admin/archives", label: "Archive Manager", icon: Archive, group: "Settings",
    visibleTo: ["admin"] },
  { to: "/admin/automations", label: "Automations", icon: RefreshCw, group: "Settings",
    visibleTo: ["admin"] },
  { to: "/admin/sops", label: "SOPs", icon: FileText, group: "Settings",
    visibleTo: ["admin", "operations"] },
  { to: "/admin/feature-flags", label: "Feature Flags", icon: ShieldCheck, group: "Settings",
    visibleTo: ["admin"] },
  { to: "/admin/settings/chat", label: "Chat Settings", icon: MessageCircle, group: "Settings",
    visibleTo: ["admin"] },
  { to: "/admin/settings/notifications/coaching-applications", label: "Application Alerts", icon: AlertCircle, group: "Settings",
    visibleTo: ["admin"] },
  { to: "/admin/floating-bar", label: "Floating Bar", icon: LayoutGrid, group: "Settings",
    visibleTo: ["admin", "coach"] },
];

/** Membership-mode overrides (admin viewing the JF Membership workspace).
 *  Adds member-ops entries that don't belong in default coaching mode. */
const MEMBERSHIP_OVERLAY: Entry[] = [
  { to: "/admin/membership", label: "Membership Home", icon: LayoutDashboard, group: "Overview",
    visibleTo: ["admin"] },
  { to: "/admin/membership/action-needed", label: "Action Needed", icon: AlertCircle, group: "Clients",
    visibleTo: ["admin"] },
  { to: "/admin/membership/signup-stats", label: "Signup Stats", icon: BarChart3, group: "Payments",
    visibleTo: ["admin"] },
  { to: "/admin/membership/signup-link", label: "Signup Link", icon: LinkIcon, group: "Payments",
    visibleTo: ["admin"] },
  { to: "/admin/membership/billing", label: "Subscriptions", icon: CreditCard, group: "Payments",
    visibleTo: ["admin"] },
  { to: "/admin/membership/stripe-sync", label: "Stripe Sync", icon: RefreshCw, group: "Payments",
    visibleTo: ["admin"] },
  { to: "/admin/membership/calendar", label: "Membership Calendar", icon: Calendar, group: "Scheduling",
    visibleTo: ["admin"],
    keywords: ["calendar", "renewals", "trial ends", "enrollments", "billing events", "membership calendar"] },
  { to: "/admin/member-plans", label: "Plan Library", icon: Library, group: "Programming",
    visibleTo: ["admin"] },
  { to: "/admin/membership/setup-links", label: "Setup Links", icon: LinkIcon, group: "Settings",
    visibleTo: ["admin"] },
  { to: "/admin/membership/reset-links", label: "Reset Links", icon: KeyRound, group: "Settings",
    visibleTo: ["admin"] },
  { to: "/admin/membership/welcome-messages", label: "Welcome Messages", icon: Megaphone, group: "Messages",
    visibleTo: ["admin"] },
  { to: "/admin/membership/sms-email", label: "SMS & Email", icon: MessageCircle, group: "Messages",
    visibleTo: ["admin"] },
  // ── Launch / safety / compliance ──
  { to: "/admin/membership/launch-readiness", label: "Launch Readiness", icon: ShieldCheck, group: "Business",
    visibleTo: ["admin"], keywords: ["launch", "readiness", "checklist", "go live", "promote"] },
  { to: "/admin/membership/notifications", label: "Notifications Log", icon: AlertCircle, group: "Business",
    visibleTo: ["admin"], keywords: ["notifications", "dry run", "allowlist", "live", "attempts"] },
  { to: "/admin/membership/access-checklist", label: "Access Checklist", icon: ListChecks, group: "Business",
    visibleTo: ["admin"] },
  { to: "/admin/membership/refund-policy", label: "Refund Policy", icon: FileText, group: "Business",
    visibleTo: ["admin"] },
  { to: "/admin/membership/checkout-settings", label: "Checkout Kill-Switch", icon: PowerOff, group: "Payments",
    visibleTo: ["admin"], keywords: ["kill switch", "pause", "checkout", "disable signups", "join page"] },
  { to: "/admin/membership/support", label: "Membership Support", icon: MessagesSquare, group: "Messages",
    visibleTo: ["admin"] },
  { to: "/admin/membership/promo-tools", label: "Promo Tools", icon: Tag, group: "Payments",
    visibleTo: ["admin"] },
  { to: "/admin/membership/challenges", label: "Challenges", icon: Trophy, group: "Programming",
    visibleTo: ["admin"] },
];

/**
 * Media Manager registry — all `/media/*` routes grouped into the same 11
 * workspaces. Media Manager has its own physical route tree (`/media`) with
 * its own narrow permissions, so we cannot point a media-manager sidebar at
 * `/admin/*` URLs (those routes redirect non-admins away). This registry
 * mirrors the IA without changing any route or permission boundary.
 */
const MEDIA_REGISTRY: NavItem[] = [
  // ── HOME ──────────────────────────────────────────────────────────
  { to: "/media", label: "Media Home", icon: HomeIcon, group: "Home" },

  // ── DAILY WORK ────────────────────────────────────────────────────
  { to: "/media/work", label: "My Work", icon: ListChecks, group: "Daily Work",
    keywords: ["my work", "tasks", "assigned", "today"] },
  { to: "/media/inbox", label: "Inbox & Approvals", icon: MessageCircle, group: "Daily Work",
    keywords: ["inbox", "approvals", "review", "comments"] },
  { to: "/media/pipeline", label: "Content Pipeline", icon: Layers, group: "Daily Work",
    keywords: ["pipeline", "kanban", "production", "in progress"] },
  { to: "/media/calendar", label: "Content Calendar", icon: Calendar, group: "Daily Work",
    keywords: ["calendar", "content calendar", "schedule", "events"] },
  { to: "/media/publishing", label: "Publishing Queue", icon: Upload, group: "Daily Work",
    keywords: ["publishing", "queue", "scheduled", "ready"] },

  // ── CONTENT ───────────────────────────────────────────────────────
  { to: "/media/drafts", label: "Drafts", icon: FileEdit, group: "Content",
    keywords: ["drafts", "broadcasts", "announcements"] },
  { to: "/media/content", label: "Content Library", icon: Film, group: "Content",
    keywords: ["content", "library", "posts", "videos", "records"] },
  { to: "/media/assets", label: "Asset Library", icon: FolderOpen, group: "Content",
    keywords: ["assets", "files", "uploads", "media files"] },
  { to: "/media/testimonials", label: "Testimonials", icon: Star, group: "Content",
    keywords: ["testimonials", "reviews", "proof"] },
  { to: "/media/templates", label: "Templates & Brand Kit", icon: Sparkles, group: "Content",
    keywords: ["templates", "brand", "kit", "logos", "colors", "fonts"] },

  // ── GROWTH ────────────────────────────────────────────────────────
  { to: "/media/campaigns", label: "Campaigns", icon: Megaphone, group: "Growth",
    keywords: ["campaigns", "launches", "promos"] },
  { to: "/media/pages", label: "Pages & Promo Links", icon: LinkIcon, group: "Growth",
    keywords: ["pages", "promo", "links", "landing"] },
  { to: "/media/performance", label: "Performance", icon: BarChart3, group: "Growth",
    keywords: ["performance", "analytics", "metrics", "reach"] },

  // ── SYSTEM ────────────────────────────────────────────────────────
  { to: "/media/archive", label: "Archive", icon: Archive, group: "System",
    keywords: ["archive", "archived", "trash"] },
  { to: "/media/team", label: "Team", icon: Users, group: "System",
    keywords: ["team", "people", "members", "roles"] },
  { to: "/media/settings", label: "Media Settings", icon: Settings, group: "System",
    keywords: ["settings", "account", "preferences"] },
];

/**
 * Build the sidebar for a given staff role tag and dashboard mode.
 * Returns `NavItem[]` (already filtered, already grouped via NavItem.group).
 */
export function buildInternalNav(
  roleTag: StaffRoleTag,
  opts: { mode?: "coaching" | "membership" } = {},
): NavItem[] {
  // Media Manager has its own physical /media route tree with its own
  // narrower permissions — return the /media-scoped registry directly so
  // the sidebar does not point at /admin/* routes that the role cannot
  // access. Admin viewing in Media Manager mode also uses this set.
  if (roleTag === "media_manager") {
    return MEDIA_REGISTRY.map((i) => ({ ...i }));
  }
  const base = REGISTRY.filter((e) => e.visibleTo.includes(roleTag));
  const overlay =
    opts.mode === "membership" && roleTag === "admin" ? MEMBERSHIP_OVERLAY : [];
  // Merge base + overlay, dedupe by `to` (last wins so overlay can rename
  // shared destinations), and strip `visibleTo` before handing to the shell.
  const merged = new Map<string, NavItem>();
  for (const { visibleTo: _v, ...item } of [...base, ...overlay]) {
    merged.set(item.to, item as NavItem);
  }
  return Array.from(merged.values());
}

/**
 * Resolve the staff role tag from the real `app_role` value. Right now the
 * database only stores `admin | coach | media_manager | client | member`.
 * Until `assistant_coach`, `sales`, `support`, `operations`, and `staff` are
 * added to the `app_role` enum (with matching RLS), this helper just passes
 * through the three real internal roles.
 */
export function resolveStaffRoleTag(role: string | null | undefined): StaffRoleTag | null {
  if (role === "admin") return "admin";
  if (role === "coach") return "coach";
  if (role === "media_manager") return "media_manager";
  return null;
}