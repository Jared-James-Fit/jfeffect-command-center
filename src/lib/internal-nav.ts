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
  { to: "/admin/chat-gifs", label: "Chat GIF Library", icon: Sparkles, group: "Messages",
    visibleTo: ["admin"], section: "Chat Assets" },
  { to: "/admin/chat-sounds", label: "Chat Sound Library", icon: Sparkles, group: "Messages",
    visibleTo: ["admin"], section: "Chat Assets" },

  // ── CLIENTS ──────────────────────────────────────────────────────────
  { to: "/admin/clients", label: "Clients", icon: Users, group: "Clients",
    visibleTo: ["admin", "coach", "assistant_coach", "sales", "support"] },
  { to: "/admin/check-in-reviews", label: "Check-In Reviews", icon: ClipboardCheck, group: "Clients",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/lift-videos", label: "Lift Reviews", icon: Video, group: "Clients",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/client-action-requests", label: "Action Requests", icon: ClipboardCheck, group: "Clients",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/training-intelligence", label: "Training Intel", icon: Activity, group: "Clients",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/coaching", label: "Coaching Hub", icon: ClipboardList, group: "Clients",
    visibleTo: ["admin", "coach", "assistant_coach"], section: "Legacy Hubs",
    keywords: ["coaching", "check-ins", "lift reviews", "training intelligence", "action requests"] },
  { to: "/admin/agreements", label: "Client Agreements", icon: FileSignature, group: "Clients",
    visibleTo: ["admin", "coach"], section: "Setup" },
  { to: "/admin/members", label: "App Members", icon: UserPlus, group: "Clients",
    visibleTo: ["admin"], section: "Setup" },

  // ── PAYMENTS ─────────────────────────────────────────────────────────
  { to: "/admin/transactions", label: "Transactions", icon: Activity, group: "Payments",
    visibleTo: ["admin", "sales"],
    keywords: ["transactions", "payments", "history", "stripe", "purchases", "receipts", "refunds"] },
  { to: "/admin/sales", label: "Sales", icon: DollarSign, group: "Payments",
    visibleTo: ["admin", "sales", "media_manager", "support"],
    keywords: ["sales", "revenue", "orders"] },
  { to: "/admin/products-history", label: "Product Sales", icon: BarChart3, group: "Payments",
    visibleTo: ["admin", "sales"],
    keywords: ["product history", "product sales", "offer history", "sales by product"] },
  { to: "/admin/payment-links", label: "Products / Offers", icon: ShoppingBag, group: "Payments",
    visibleTo: ["admin", "sales"],
    keywords: ["products", "offers", "checkout links", "payment links", "stripe"] },
  { to: "/admin/promo-codes", label: "Discount Codes", icon: Ticket, group: "Payments",
    visibleTo: ["admin", "sales"], keywords: ["promo", "discount", "coupon"] },
  { to: "/admin/purchases", label: "Invoices", icon: FileText, group: "Payments",
    visibleTo: ["admin", "sales", "support"], keywords: ["invoices", "purchases", "receipts"] },
  { to: "/admin/sales/coaching", label: "Coaching Sales Page", icon: Sparkles, group: "Payments",
    visibleTo: ["admin", "sales"], keywords: ["sales channels", "coaching page"] },
  { to: "/admin/sales/membership", label: "Membership Sales Page", icon: Sparkles, group: "Payments",
    visibleTo: ["admin", "sales"], keywords: ["sales channels", "membership page"] },
  { to: "/admin/billing-sources", label: "Setup", icon: CreditCard, group: "Payments",
    visibleTo: ["admin"], section: "Setup & Diagnostics",
    keywords: ["stripe setup", "billing sources", "payment setup", "tax", "checkout settings"] },
  { to: "/admin/discount-codes", label: "Stripe Discount Codes", icon: Tag, group: "Payments",
    visibleTo: ["admin"], section: "Setup & Diagnostics", keywords: ["stripe coupon", "discount"] },
  { to: "/admin/membership/billing-events", label: "Stripe Webhook Events", icon: Activity, group: "Payments",
    visibleTo: ["admin"], section: "Setup & Diagnostics", keywords: ["stripe events", "webhooks", "billing events"] },

  // ── PROGRAMMING ──────────────────────────────────────────────────────
  { to: "/admin/programming", label: "Programs", icon: BookOpen, group: "Programming",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/program-library", label: "Program Library", icon: Library, group: "Programming",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/exercises", label: "Exercise Library", icon: Dumbbell, group: "Programming",
    visibleTo: ["admin", "coach", "assistant_coach"] },
  { to: "/admin/cardio-targets", label: "Cardio Targets", icon: Heart, group: "Programming",
    visibleTo: ["admin", "coach", "assistant_coach"], section: "Training Tools" },
  { to: "/admin/warmup-protocols", label: "Warm-Up Protocols", icon: Flame, group: "Programming",
    visibleTo: ["admin", "coach", "assistant_coach"], section: "Training Tools" },
  { to: "/admin/nutrition-dashboard", label: "Nutrition", icon: ChefHat, group: "Programming",
    visibleTo: ["admin", "coach", "assistant_coach"], section: "Nutrition" },
  { to: "/admin/recipes", label: "Recipe Library", icon: ChefHat, group: "Programming",
    visibleTo: ["admin", "coach", "assistant_coach"], section: "Nutrition" },
  { to: "/admin/native-forms", label: "Check-Ins & Forms", icon: FileEdit, group: "Programming",
    visibleTo: ["admin", "coach", "assistant_coach"], section: "Forms & Check-Ins" },
  { to: "/admin/forms", label: "Form Builder", icon: FileEdit, group: "Programming",
    visibleTo: ["admin", "coach"], section: "Forms & Check-Ins" },
  { to: "/admin/fillout-submissions", label: "Fillout Submissions", icon: ClipboardList, group: "Programming",
    visibleTo: ["admin", "coach"], section: "Forms & Check-Ins" },

  // ── SCHEDULING ───────────────────────────────────────────────────────
  { to: "/admin/calendar", label: "Calendar", icon: Calendar, group: "Scheduling",
    visibleTo: ["admin", "coach", "assistant_coach", "sales", "support", "operations", "media_manager"] },
  { to: "/admin/pt-calendar", label: "PT Calendar", icon: Calendar, group: "Scheduling",
    visibleTo: ["admin", "coach"] },
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
  { to: "/admin/popups", label: "Popups", icon: LayoutGrid, group: "Business",
    visibleTo: ["admin"], keywords: ["popup", "modal", "birthday cards", "task popup", "load screen"] },
  { to: "/admin/business-systems", label: "Operations", icon: Briefcase, group: "Business",
    visibleTo: ["admin", "operations"], section: "Setup" },
  { to: "/admin/legal", label: "Legal", icon: FileSignature, group: "Business",
    visibleTo: ["admin"], section: "Setup" },

  // ── TEAM ─────────────────────────────────────────────────────────────
  { to: "/admin/team", label: "Team", icon: Users, group: "Team",
    visibleTo: ["admin", "operations"] },
  { to: "/admin/coaches", label: "Coaches", icon: UserCheck, group: "Team",
    visibleTo: ["admin", "operations"] },
  { to: "/admin/staff", label: "Staff & Media Managers", icon: UserPlus, group: "Team",
    visibleTo: ["admin", "operations"] },
  { to: "/admin/approvals", label: "Approvals Queue", icon: ClipboardCheck, group: "Team",
    visibleTo: ["admin", "operations"], section: "Media & Approvals" },
  { to: "/admin/media-review", label: "Media Inbox", icon: Film, group: "Team",
    visibleTo: ["admin", "media_manager", "operations"], section: "Media & Approvals" },
  { to: "/admin/media-archives", label: "Media Archives", icon: FolderOpen, group: "Team",
    visibleTo: ["admin", "media_manager", "operations"], section: "Media & Approvals" },

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
  { to: "/admin/automations", label: "Automations", icon: RefreshCw, group: "Settings",
    visibleTo: ["admin"] },
  { to: "/admin/sops", label: "SOPs", icon: FileText, group: "Settings",
    visibleTo: ["admin", "operations"] },
  { to: "/admin/settings/chat", label: "Chat Settings", icon: MessageCircle, group: "Settings",
    visibleTo: ["admin"] },
  { to: "/admin/settings/notifications/coaching-applications", label: "Application Alerts", icon: AlertCircle, group: "Settings",
    visibleTo: ["admin"] },
  { to: "/admin/floating-bar", label: "Floating Bar", icon: LayoutGrid, group: "Settings",
    visibleTo: ["admin", "coach"] },
  // Advanced / technical utilities — surfaced last inside the Settings flyout.
  { to: "/admin/feature-flags", label: "Feature Flags", icon: ShieldCheck, group: "Settings",
    visibleTo: ["admin"], section: "Advanced" },
  { to: "/admin/archives", label: "Archive Manager", icon: Archive, group: "Settings",
    visibleTo: ["admin"], section: "Advanced" },
];

/** Membership-mode overrides (admin viewing the JF Membership workspace).
 *  Adds member-ops entries that don't belong in default coaching mode. */
const MEMBERSHIP_OVERLAY: Entry[] = [
  { to: "/admin", label: "← Exit to Coaching", icon: LayoutDashboard, group: "Overview",
    visibleTo: ["admin"] },
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
 * Trainerize-style collapsed nav. Overview items stay flat; every other
 * workspace is folded into ONE top-level `NavItem` whose `to` is the
 * first (primary) route in that group and whose `children` are the
 * remaining pages, rendered as a hover flyout on desktop and a subpanel
 * on mobile.
 *
 * The primary label is generic ("Messages", "Clients", …) so the sidebar
 * matches the requested IA — the actual first entry's label becomes the
 * first flyout child so nothing is lost.
 */
const WORKSPACE_LABELS: Partial<Record<WorkspaceKey, { label: string }>> = {
  Messages: { label: "Messages" },
  Clients: { label: "Clients" },
  Payments: { label: "Payments" },
  Programming: { label: "Programs" },
  Scheduling: { label: "Scheduling" },
  Business: { label: "Business" },
  Team: { label: "Team" },
  "Add-ons": { label: "Add-ons" },
  Settings: { label: "Settings" },
};

export function buildInternalNavCollapsed(
  roleTag: StaffRoleTag,
  opts: { mode?: "coaching" | "membership" } = {},
): NavItem[] {
  const flat = buildInternalNav(roleTag, opts);
  const byGroup = new Map<string, NavItem[]>();
  for (const item of flat) {
    const g = (item.group ?? "Overview") as string;
    const arr = byGroup.get(g) ?? [];
    arr.push(item);
    byGroup.set(g, arr);
  }
  const out: NavItem[] = [];
  // Overview — stay flat
  for (const it of byGroup.get("Overview") ?? []) {
    out.push({ ...it, group: "Overview" });
  }
  byGroup.delete("Overview");
  // Remaining workspaces — fold into one row per workspace
  for (const key of WORKSPACE_ORDER) {
    if (key === "Overview") continue;
    const items = byGroup.get(key);
    if (!items || items.length === 0) continue;
    const primary = items[0];
    // Keep primary at top; among the rest, preserve REGISTRY order but push
    // any child tagged with a `section` to the bottom so the flyout shows
    // frequent / high-priority pages first and setup / diagnostic / advanced
    // pages under a labelled divider.
    const rest = items
      .slice(1)
      .slice()
      .sort((a, b) => Number(!!a.section) - Number(!!b.section));
    const groupBucket: "Main Menu" | "Other" =
      key === "Add-ons" || key === "Settings" ? "Other" : "Main Menu";
    out.push({
      to: primary.to,
      label: WORKSPACE_LABELS[key]?.label ?? primary.label,
      icon: primary.icon,
      group: groupBucket,
      keywords: primary.keywords,
      children: rest.length > 0 ? [primary, ...rest] : undefined,
    });
  }
  return out;
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

/**
 * Dedicated Membership Admin sidebar.
 *
 * Not derived from the coaching registry — it is a separate information
 * architecture with its own top-level groups (Members / Payments / Content /
 * Sales / Communication / Onboarding) and its own labels ("Members" rather
 * than "Clients", "Membership Payments" rather than "Payments", …).
 *
 * Only Overview items are flat. Every MAIN MENU / OTHER entry is a single
 * top-level row whose `to` is the primary destination and whose `children`
 * become the desktop hover flyout / mobile submenu. All URLs point at
 * existing routes so old bookmarks keep working; a few children use query
 * params (`?status=…`, `?scope=membership`) that pages can adopt over time
 * without breaking navigation.
 */
export function buildMembershipAdminNav(): NavItem[] {
  return [
    // ── OVERVIEW (flat) ──────────────────────────────────────────────
    { to: "/admin", label: "← Back to Coaching", icon: HomeIcon, group: "Overview",
      keywords: ["exit membership", "coaching admin", "switch workspace"] },
    { to: "/admin/membership", label: "Membership Home", icon: LayoutDashboard, group: "Overview" },
    { to: "/admin/tasks", label: "Tasks", icon: ListChecks, group: "Overview" },
    { to: "/admin/membership/action-needed", label: "Membership Alerts", icon: AlertCircle, group: "Overview",
      keywords: ["failed payments", "expired trials", "expired access", "incomplete setup", "missing profile", "stripe sync"] },

    // ── MAIN MENU ────────────────────────────────────────────────────
    { to: "/admin/members", label: "Members", icon: Users, group: "Main Menu",
      keywords: ["members", "trialing", "active", "past due", "paused", "cancelled", "complimentary", "access overrides"],
      children: [
        { to: "/admin/members", label: "All Members", icon: Users },
        { to: "/admin/members?status=trialing", label: "Trialing", icon: Users },
        { to: "/admin/members?status=active", label: "Active", icon: Users },
        { to: "/admin/members?status=past_due", label: "Past Due", icon: AlertCircle },
        { to: "/admin/members?status=paused", label: "Paused", icon: Users },
        { to: "/admin/members?status=cancelled", label: "Cancelled", icon: Users },
        { to: "/admin/members?status=complimentary", label: "Complimentary Access", icon: ShieldCheck },
        { to: "/admin/members?status=override", label: "Access Overrides", icon: KeyRound },
      ],
    },

    { to: "/admin/membership/billing", label: "Membership Payments", icon: CreditCard, group: "Main Menu",
      keywords: ["subscriptions", "billing", "stripe", "invoices", "refunds", "failed payments"],
      children: [
        { to: "/admin/transactions?scope=membership", label: "Membership Transactions", icon: Activity },
        { to: "/admin/membership/billing", label: "Subscriptions", icon: CreditCard },
        { to: "/admin/membership/action-needed?tab=failed", label: "Failed Payments", icon: AlertCircle },
        { to: "/admin/purchases?type=refunds", label: "Refunds", icon: RefreshCw },
        { to: "/admin/purchases", label: "Invoices & Receipts", icon: FileText },
        { to: "/admin/membership/stripe-sync", label: "Stripe Sync", icon: RefreshCw },
        { to: "/admin/membership/action-needed", label: "Payment Issues", icon: AlertCircle },
      ],
    },

    { to: "/admin/member-plans", label: "Membership Content", icon: Library, group: "Main Menu",
      keywords: ["programs", "workouts", "exercises", "meal plans", "recipes", "resources", "challenges"],
      children: [
        { to: "/admin/programming", label: "Membership Programs", icon: BookOpen },
        { to: "/admin/program-library", label: "Workout Library", icon: Library },
        { to: "/admin/exercises", label: "Exercise Library", icon: Dumbbell },
        { to: "/admin/nutrition-dashboard", label: "Meal Plans", icon: ChefHat },
        { to: "/admin/recipes", label: "Recipes", icon: ChefHat },
        { to: "/admin/member-resources", label: "Resources", icon: FolderOpen },
        { to: "/admin/membership/challenges", label: "Challenges", icon: Trophy },
      ],
    },

    { to: "/admin/sales/membership", label: "Membership Sales", icon: ShoppingBag, group: "Main Menu",
      keywords: ["plans", "pricing", "offers", "promotions", "referral codes", "sales page", "checkout", "analytics"],
      children: [
        { to: "/admin/member-plans", label: "Plans & Pricing", icon: Library },
        { to: "/admin/payment-links", label: "Products & Offers", icon: ShoppingBag },
        { to: "/admin/membership/promo-tools", label: "Promotions", icon: Tag },
        { to: "/admin/promo-codes", label: "Referral Codes", icon: Ticket },
        { to: "/admin/sales/membership", label: "Sales Page", icon: Sparkles },
        { to: "/admin/membership/checkout-settings", label: "Checkout", icon: PowerOff },
        { to: "/admin/membership/signup-stats", label: "Membership Analytics", icon: BarChart3 },
      ],
    },

    { to: "/admin/messages", label: "Member Messages", icon: MessagesSquare, group: "Main Menu",
      keywords: ["inbox", "groups", "broadcasts", "announcements", "push notifications"],
      children: [
        { to: "/admin/membership/support", label: "Inbox", icon: MessageCircle },
        { to: "/admin/messages", label: "Groups", icon: MessagesSquare },
        { to: "/admin/broadcasts", label: "Broadcasts", icon: Megaphone },
        { to: "/admin/membership/welcome-messages", label: "Announcements", icon: Megaphone },
        { to: "/admin/membership/notifications", label: "Push Notifications", icon: AlertCircle },
      ],
    },

    { to: "/admin/onboarding", label: "Member Onboarding", icon: ClipboardCheck, group: "Main Menu",
      keywords: ["welcome email", "incomplete setup", "missing profiles", "sms consent", "access setup"],
      children: [
        { to: "/admin/onboarding", label: "Onboarding Status", icon: ClipboardCheck },
        { to: "/admin/membership/welcome-messages", label: "Welcome Email", icon: Megaphone },
        { to: "/admin/membership/action-needed?tab=incomplete", label: "Incomplete Setup", icon: AlertCircle },
        { to: "/admin/members?status=missing_profile", label: "Missing Profiles", icon: Users },
        { to: "/admin/settings/sms", label: "SMS Consent", icon: MessageCircle },
        { to: "/admin/membership/access-checklist", label: "Access Setup", icon: ShieldCheck },
      ],
    },

    // ── OTHER ────────────────────────────────────────────────────────
    { to: "/admin/apps", label: "Membership Add-ons", icon: Layers, group: "Other" },
    { to: "/admin/settings", label: "Membership Settings", icon: Settings, group: "Other",
      keywords: ["general", "branding", "access rules", "trial settings", "notifications", "billing", "stripe", "integrations"],
      children: [
        { to: "/admin/settings", label: "General", icon: Settings },
        { to: "/admin/content", label: "Branding", icon: Sparkles },
        { to: "/admin/membership/access-checklist", label: "Access Rules", icon: ShieldCheck },
        { to: "/admin/membership/checkout-settings", label: "Trial Settings", icon: PowerOff },
        { to: "/admin/membership/notifications", label: "Notifications", icon: AlertCircle },
        { to: "/admin/membership/billing", label: "Billing", icon: CreditCard },
        { to: "/admin/membership/stripe-sync", label: "Stripe", icon: RefreshCw },
        { to: "/admin/apps", label: "Integrations", icon: Layers },
      ],
    },
  ];
}