/**
 * Shared, role-aware internal navigation registry.
 *
 * Single source of truth for which staff role sees which workspace, grouped
 * into the 11 top-level workspaces of the consolidated IA:
 *
 *   Home · Clients · Coaching · Programming · Forms · Communication ·
 *   Sales · Calendar · Content · Team · Settings
 *
 * No URLs are deleted or moved here — every entry points at an existing route
 * (some with `?tab=` query params), so old bookmarks keep working. The
 * `AppShell` already groups by the `group` field on each `NavItem`; we set
 * `group` to the workspace name and let the shell render it.
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
  | "Home"
  | "Clients"
  | "Coaching"
  | "Programming"
  | "Forms"
  | "Communication"
  | "Sales"
  | "Calendar"
  | "Content"
  | "Team"
  | "Settings";

export const WORKSPACE_ORDER: WorkspaceKey[] = [
  "Home", "Clients", "Coaching", "Programming", "Forms", "Communication",
  "Sales", "Calendar", "Content", "Team", "Settings",
];

type Entry = NavItem & { visibleTo: StaffRoleTag[] };

/** All workspace items. `group` MUST be a WorkspaceKey so the shell groups it. */
const REGISTRY: Entry[] = [
  // ── HOME ─────────────────────────────────────────────────────────────
  { to: "/admin", label: "Home", icon: HomeIcon, group: "Home",
    visibleTo: ["admin", "coach", "assistant_coach", "media_manager", "sales", "support", "operations", "staff"] },

  // ── CLIENTS ──────────────────────────────────────────────────────────
  { to: "/admin/clients", label: "Clients", icon: Users, group: "Clients",
    visibleTo: ["admin", "coach", "assistant_coach", "sales", "support"] },
  { to: "/admin/crm/contacts", label: "Leads & Contacts", icon: UserCheck, group: "Clients",
    visibleTo: ["admin", "sales"] },

  // ── COACHING (review queues consolidated) ───────────────────────────
  { to: "/admin/check-in-reviews", label: "Check-In Reviews", icon: ClipboardList, group: "Coaching",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/lift-videos", label: "Lift Reviews", icon: Video, group: "Coaching",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/training-intelligence", label: "Training Intel", icon: Activity, group: "Coaching",
    visibleTo: ["admin", "coach"] },
  { to: "/admin/client-action-requests", label: "Action Requests", icon: ClipboardCheck, group: "Coaching",
    visibleTo: ["admin", "coach", "assistant_coach"] },

  // ── PROGRAMMING ─────────────────────────────────────────────────────
  { to: "/admin/program-library", label: "Programs", icon: BookOpen, group: "Programming",
    visibleTo: ["admin", "coach"] },
  { to: "/admin/exercises", label: "Exercises", icon: Dumbbell, group: "Programming",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/cardio-targets", label: "Cardio", icon: Heart, group: "Programming",
    visibleTo: ["admin", "coach"],
    keywords: ["card", "cardio", "targets", "conditioning", "steps", "hiit", "liss", "zone 2"] },
  { to: "/admin/warmup-protocols", label: "Warm-Ups", icon: Flame, group: "Programming",
    visibleTo: ["admin", "coach"],
    keywords: ["warmup", "warm-up", "warm up", "sbd", "squat", "bench", "deadlift", "mobility"] },
  { to: "/admin/recipes", label: "Recipes", icon: ChefHat, group: "Programming",
    visibleTo: ["admin", "coach"] },

  // ── FORMS (one consolidated workspace; tabs handle the sub-views) ───
  { to: "/admin/forms", label: "Forms", icon: FileEdit, group: "Forms",
    visibleTo: ["admin", "coach", "assistant_coach", "sales"],
    keywords: [
      "forms", "native forms", "check-ins", "check ins", "form builder",
      "document forms", "fillout", "fillout submissions", "submissions",
      "coaching applications", "applications", "agreements", "signnow",
    ] },

  // ── COMMUNICATION ────────────────────────────────────────────────────
  { to: "/admin/messages", label: "Inbox", icon: MessageCircle, group: "Communication",
    visibleTo: ["admin", "coach", "assistant_coach", "media_manager", "sales", "support"] },
  { to: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone, group: "Communication",
    visibleTo: ["admin", "coach", "media_manager"] },
  { to: "/admin/popups", label: "Popups", icon: LayoutGrid, group: "Communication",
    visibleTo: ["admin", "media_manager"],
    keywords: ["popup", "popups", "pop up", "pop-up", "modal", "task popup", "load screen", "birthday card", "event popup"] },
  { to: "/admin/membership/support", label: "Member Support Inbox", icon: MessagesSquare, group: "Communication",
    visibleTo: ["admin", "support"] },
  { to: "/admin/call-access", label: "Call Access", icon: Phone, group: "Communication",
    visibleTo: ["admin"] },
  { to: "/admin/settings/sms", label: "SMS Access", icon: MessageCircle, group: "Communication",
    visibleTo: ["admin"] },
  { to: "/admin/chat-gifs", label: "GIF Library", icon: Sparkles, group: "Communication",
    visibleTo: ["admin", "media_manager"] },
  { to: "/admin/chat-sounds", label: "Sound Library", icon: Sparkles, group: "Communication",
    visibleTo: ["admin", "media_manager"] },

  // ── SALES (CRM + offers + financial) ────────────────────────────────
  { to: "/admin/crm", label: "Pipeline", icon: BarChart3, group: "Sales",
    visibleTo: ["admin", "sales"] },
  { to: "/admin/sales/coaching", label: "Coaching Page", icon: ShoppingBag, group: "Sales",
    visibleTo: ["admin", "sales", "media_manager"] },
  { to: "/admin/sales/membership", label: "Membership Page", icon: ShoppingBag, group: "Sales",
    visibleTo: ["admin", "sales", "media_manager"] },
  { to: "/admin/payment-links", label: "Products", icon: CreditCard, group: "Sales",
    visibleTo: ["admin", "sales"] },
  { to: "/admin/payments", label: "Payments", icon: DollarSign, group: "Sales",
    visibleTo: ["admin", "sales"] },
  { to: "/admin/purchases", label: "Purchases", icon: ClipboardCheck, group: "Sales",
    visibleTo: ["admin", "sales", "support"] },
  { to: "/admin/promo-codes", label: "Promo Codes", icon: Ticket, group: "Sales",
    visibleTo: ["admin", "sales"] },

  // ── CALENDAR (calendar + events + bookings) ─────────────────────────
  { to: "/admin/calendar", label: "Calendar", icon: Calendar, group: "Calendar",
    visibleTo: ["admin", "coach", "assistant_coach", "sales", "support", "operations", "media_manager"],
    keywords: ["calendar", "appointments", "booking", "booking links", "pt calendar", "google calendar", "availability", "schedule"] },
  { to: "/admin/events", label: "Events", icon: Calendar, group: "Calendar",
    visibleTo: ["admin", "coach", "media_manager", "operations"] },
  { to: "/admin/booking-links", label: "Booking Links", icon: LinkIcon, group: "Calendar",
    visibleTo: ["admin", "sales", "coach"] },
  { to: "/admin/google-calendar", label: "Google Calendar", icon: Calendar, group: "Calendar",
    visibleTo: ["admin"] },

  // ── CONTENT (media workflows) ───────────────────────────────────────
  { to: "/admin/media-review", label: "Media Inbox", icon: Film, group: "Content",
    visibleTo: ["admin", "coach", "media_manager"] },
  { to: "/admin/approvals", label: "Approvals", icon: ClipboardCheck, group: "Content",
    visibleTo: ["admin", "media_manager"] },
  { to: "/admin/tasks", label: "Tasks", icon: ClipboardList, group: "Content",
    visibleTo: ["admin", "coach", "media_manager", "assistant_coach", "operations"] },
  { to: "/admin/member-resources", label: "Member Resources", icon: FolderOpen, group: "Content",
    visibleTo: ["admin", "media_manager"] },
  { to: "/admin/resources", label: "Resources Library", icon: FolderOpen, group: "Content",
    visibleTo: ["admin", "coach", "media_manager"] },
  { to: "/admin/media-archives", label: "Archive", icon: FolderOpen, group: "Content",
    visibleTo: ["admin", "media_manager"] },

  // ── TEAM (people + ops + support alerts) ────────────────────────────
  { to: "/admin/coaches", label: "People", icon: Users, group: "Team",
    visibleTo: ["admin"] },
  { to: "/admin/staff", label: "Staff & Media", icon: UserPlus, group: "Team",
    visibleTo: ["admin"] },
  { to: "/admin/support-alerts", label: "Support Alerts", icon: AlertCircle, group: "Team",
    visibleTo: ["admin", "support", "operations"] },
  { to: "/admin/business-systems", label: "Operations", icon: Briefcase, group: "Team",
    visibleTo: ["admin", "operations"] },

  // ── SETTINGS ────────────────────────────────────────────────────────
  { to: "/admin/settings", label: "Workspace Settings", icon: Settings, group: "Settings",
    visibleTo: ["admin"] },
  { to: "/admin/apps", label: "Integrations", icon: Layers, group: "Settings",
    visibleTo: ["admin"] },
  { to: "/admin/floating-bar", label: "Floating Bar", icon: LayoutGrid, group: "Settings",
    visibleTo: ["admin", "coach", "media_manager"] },
  { to: "/admin/faqs", label: "FAQ Manager", icon: HelpCircle, group: "Settings",
    visibleTo: ["admin", "coach"] },
  { to: "/admin/archives", label: "Archive Manager", icon: Archive, group: "Settings",
    visibleTo: ["admin", "operations"] },
  { to: "/admin/account", label: "My Account", icon: UserCog, group: "Settings",
    visibleTo: ["admin", "coach", "assistant_coach", "media_manager", "sales", "support", "operations", "staff"] },
];

/** Membership-mode overrides (admin viewing the JF Membership workspace).
 *  Adds member-ops entries that don't belong in default coaching mode. */
const MEMBERSHIP_OVERLAY: Entry[] = [
  { to: "/admin/membership", label: "Membership Home", icon: LayoutDashboard, group: "Home",
    visibleTo: ["admin"] },
  { to: "/admin/members", label: "App Members", icon: Users, group: "Clients",
    visibleTo: ["admin"] },
  { to: "/admin/membership/action-needed", label: "Action Needed", icon: AlertCircle, group: "Clients",
    visibleTo: ["admin"] },
  { to: "/admin/membership/signup-stats", label: "Signup Stats", icon: BarChart3, group: "Sales",
    visibleTo: ["admin"] },
  { to: "/admin/membership/signup-link", label: "Signup Link", icon: LinkIcon, group: "Sales",
    visibleTo: ["admin"] },
  { to: "/admin/membership/billing", label: "Subscriptions", icon: CreditCard, group: "Sales",
    visibleTo: ["admin"] },
  { to: "/admin/membership/stripe-sync", label: "Stripe Sync", icon: RefreshCw, group: "Sales",
    visibleTo: ["admin"] },
  { to: "/admin/member-plans", label: "Plan Library", icon: Library, group: "Programming",
    visibleTo: ["admin"] },
  { to: "/admin/membership/setup-links", label: "Setup Links", icon: LinkIcon, group: "Settings",
    visibleTo: ["admin"] },
  { to: "/admin/membership/reset-links", label: "Reset Links", icon: KeyRound, group: "Settings",
    visibleTo: ["admin"] },
  { to: "/admin/membership/welcome-messages", label: "Welcome Messages", icon: Megaphone, group: "Communication",
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
  // Home
  { to: "/media", label: "Media Dashboard", icon: LayoutDashboard, group: "Home" },
  { to: "/media/action-items", label: "Action Items", icon: ListChecks, group: "Home" },
  // Communication
  { to: "/media/broadcasts", label: "Broadcast Drafts", icon: Megaphone, group: "Communication" },
  { to: "/media/announcements", label: "Announcement Drafts", icon: FileText, group: "Communication" },
  // Sales
  { to: "/media/sales/coaching", label: "Coaching Page", icon: ExternalLink, group: "Sales" },
  { to: "/media/sales/membership", label: "JF Membership Page", icon: ExternalLink, group: "Sales" },
  { to: "/media/campaigns", label: "Campaigns / Promos", icon: Sparkles, group: "Sales" },
  { to: "/media/promo-links", label: "Promo Links", icon: LinkIcon, group: "Sales" },
  // Calendar
  { to: "/media/calendar", label: "Content Calendar", icon: Calendar, group: "Calendar" },
  { to: "/media/events", label: "Events", icon: Calendar, group: "Calendar" },
  // Content
  { to: "/media/inbox", label: "Media Inbox", icon: ImageIcon, group: "Content" },
  { to: "/media/archives", label: "Media Archives", icon: FolderOpen, group: "Content" },
  { to: "/media/uploads", label: "Uploads", icon: Upload, group: "Content" },
  { to: "/media/resources", label: "Resource Library", icon: FolderOpen, group: "Content" },
  { to: "/media/testimonials", label: "Testimonials / Proof", icon: Star, group: "Content" },
  // Settings
  { to: "/media/account", label: "My Account", icon: UserCog, group: "Settings" },
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
  // Strip `visibleTo` before handing to the shell (extra fields are harmless
  // but the type is `NavItem`, not `Entry`).
  return [...base, ...overlay].map(({ visibleTo: _v, ...item }) => item as NavItem);
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