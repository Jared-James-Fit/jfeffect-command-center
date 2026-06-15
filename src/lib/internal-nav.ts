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

  // ── COACHING (consolidated workspace) ───────────────────────────────
  { to: "/admin/coaching", label: "Coaching", icon: ClipboardList, group: "Coaching",
    visibleTo: ["admin", "coach", "assistant_coach"],
    keywords: ["coaching", "check-ins", "check in reviews", "lift videos", "lift reviews", "training intelligence", "training intel", "action requests", "client requests"] },

  // ── PROGRAMMING (consolidated workspace) ────────────────────────────
  { to: "/admin/programming", label: "Programming", icon: BookOpen, group: "Programming",
    visibleTo: ["admin", "coach", "assistant_coach"],
    keywords: [
      "programming", "programs", "program library", "templates",
      "exercises", "exercise library",
      "cardio", "targets", "conditioning", "steps", "hiit", "liss", "zone 2",
      "warmup", "warm-up", "warm up", "sbd", "squat", "bench", "deadlift", "mobility",
      "recipes",
    ] },

  // ── FORMS (one consolidated workspace; tabs handle the sub-views) ───
  { to: "/admin/forms", label: "Forms", icon: FileEdit, group: "Forms",
    visibleTo: ["admin", "coach", "assistant_coach", "sales"],
    keywords: [
      "forms", "native forms", "check-ins", "check ins", "form builder",
      "document forms", "fillout", "fillout submissions", "submissions",
      "coaching applications", "applications", "agreements", "signnow",
      "reviews", "review queue", "submission reviews", "ai", "ai settings",
      "ai instructions", "ai coach", "ai review", "draft", "playground",
      "integrations",
    ] },

  // ── COMMUNICATION ────────────────────────────────────────────────────
  { to: "/admin/communication", label: "Communication", icon: MessageCircle, group: "Communication",
    visibleTo: ["admin", "coach", "assistant_coach", "media_manager", "sales", "support"],
    keywords: [
      "communication", "messages", "inbox", "chat", "direct messages",
      "group chat", "broadcasts", "announcements",
      "support", "support inbox", "support alerts", "member support",
      "gif", "gifs", "sound", "sounds", "media library",
      "popups", "popup", "modal", "birthday cards", "task popup", "load screen",
    ] },
  { to: "/admin/call-access", label: "Call Access", icon: Phone, group: "Communication",
    visibleTo: ["admin"] },
  { to: "/admin/settings/sms", label: "SMS Access", icon: MessageCircle, group: "Communication",
    visibleTo: ["admin"] },

  // ── SALES (consolidated workspace; tabs handle sub-views) ───────────
  { to: "/admin/sales", label: "Sales", icon: BarChart3, group: "Sales",
    visibleTo: ["admin", "sales", "media_manager", "support"],
    keywords: [
      "sales", "pipeline", "crm", "leads", "prospects",
      "products", "payments", "checkout", "stripe price id", "payment links",
      "purchases", "purchase records",
      "sales pages", "offers", "coaching page", "membership page", "join page",
      "promotions", "promo codes", "redemptions", "ambassadors", "referrals",
      "revenue",
    ] },

  // ── CALENDAR (consolidated workspace) ───────────────────────────────
  { to: "/admin/calendar", label: "Calendar", icon: Calendar, group: "Calendar",
    visibleTo: ["admin", "coach", "assistant_coach", "sales", "support", "operations", "media_manager"],
    keywords: [
      "calendar", "events", "appointments", "booking", "booking links",
      "pt calendar", "google calendar", "availability", "schedule",
    ] },

  // ── CONTENT (consolidated workspace) ────────────────────────────────
  { to: "/admin/content", label: "Content", icon: Film, group: "Content",
    visibleTo: ["admin", "coach", "media_manager", "assistant_coach", "operations"],
    keywords: [
      "content", "media", "media inbox", "media review",
      "approvals", "tasks",
      "member resources", "resources", "resource library",
      "archive", "media archives",
    ] },

  // ── TEAM (consolidated workspace) ───────────────────────────────────
  { to: "/admin/team", label: "Team", icon: Users, group: "Team",
    visibleTo: ["admin", "operations"],
    keywords: ["team", "people", "coaches", "staff", "media manager invites", "operations", "business systems"] },

  // ── SETTINGS (consolidated; tabs handle sub-views) ──────────────────
  { to: "/admin/settings", label: "Settings", icon: Settings, group: "Settings",
    visibleTo: ["admin", "coach", "assistant_coach", "sales", "support", "operations", "staff"],
    keywords: [
      "settings", "account", "workspace", "integrations", "apps", "floating bar",
      "faq", "faqs", "archive", "archives", "automations", "sops", "branding",
      "notifications", "roles", "permissions", "navigation",
    ] },
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
  { to: "/admin/membership/calendar", label: "Membership Calendar", icon: Calendar, group: "Sales",
    visibleTo: ["admin"],
    keywords: ["calendar", "renewals", "trial ends", "enrollments", "billing events", "membership calendar"] },
  { to: "/admin/member-plans", label: "Plan Library", icon: Library, group: "Programming",
    visibleTo: ["admin"] },
  { to: "/admin/membership/setup-links", label: "Setup Links", icon: LinkIcon, group: "Settings",
    visibleTo: ["admin"] },
  { to: "/admin/membership/reset-links", label: "Reset Links", icon: KeyRound, group: "Settings",
    visibleTo: ["admin"] },
  { to: "/admin/membership/welcome-messages", label: "Welcome Messages", icon: Megaphone, group: "Communication",
    visibleTo: ["admin"] },
  { to: "/admin/membership/sms-email", label: "SMS & Email", icon: MessageCircle, group: "Communication",
    visibleTo: ["admin"] },
  // ── Launch / safety / compliance (previously reachable only by typing the URL) ──
  { to: "/admin/membership/launch-readiness", label: "Launch Readiness", icon: ShieldCheck, group: "Launch",
    visibleTo: ["admin"], keywords: ["launch", "readiness", "checklist", "go live", "promote"] },
  { to: "/admin/membership/notifications", label: "Notifications Log", icon: AlertCircle, group: "Launch",
    visibleTo: ["admin"], keywords: ["notifications", "dry run", "allowlist", "live", "attempts"] },
  { to: "/admin/membership/billing-events", label: "Billing Events", icon: CreditCard, group: "Launch",
    visibleTo: ["admin"], keywords: ["stripe", "webhook", "events", "billing events"] },
  { to: "/admin/membership/access-checklist", label: "Access Checklist", icon: ListChecks, group: "Launch",
    visibleTo: ["admin"] },
  { to: "/admin/legal", label: "Legal Documents", icon: FileSignature, group: "Launch",
    visibleTo: ["admin"], keywords: ["legal", "terms", "privacy", "agreement", "disclosure", "cancellation"] },
  { to: "/admin/membership/refund-policy", label: "Refund Policy", icon: FileText, group: "Launch",
    visibleTo: ["admin"] },
  { to: "/admin/membership/checkout-settings", label: "Checkout Kill-Switch", icon: PowerOff, group: "Launch",
    visibleTo: ["admin"], keywords: ["kill switch", "pause", "checkout", "disable signups", "join page"] },
  { to: "/admin/membership/support", label: "Membership Support", icon: MessagesSquare, group: "Launch",
    visibleTo: ["admin"] },
  { to: "/admin/sales/membership", label: "Sales Page", icon: Sparkles, group: "Sales",
    visibleTo: ["admin"] },
  { to: "/admin/membership/promo-tools", label: "Promo Tools", icon: Tag, group: "Sales",
    visibleTo: ["admin"] },
  { to: "/admin/membership/challenges", label: "Challenges", icon: Trophy, group: "Programming",
    visibleTo: ["admin"] },
  { to: "/admin/settings", label: "Workspace Settings", icon: Settings, group: "Settings",
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
  { to: "/media", label: "Home", icon: HomeIcon, group: "Home" },
  { to: "/media/content", label: "Content", icon: Film, group: "Content",
    keywords: [
      "content", "media", "inbox", "tasks", "action items", "campaigns",
      "promo links", "pages", "library", "uploads", "resources", "resource library",
      "testimonials", "proof", "archive", "archives",
    ] },
  { to: "/media/communication", label: "Communication", icon: MessageCircle, group: "Communication",
    keywords: ["communication", "broadcasts", "broadcast drafts", "announcements", "drafts"] },
  { to: "/media/calendar", label: "Calendar", icon: Calendar, group: "Calendar",
    keywords: ["calendar", "content calendar", "events"] },
  { to: "/media/settings", label: "Settings", icon: Settings, group: "Settings",
    keywords: ["settings", "account", "my account", "preferences"] },
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