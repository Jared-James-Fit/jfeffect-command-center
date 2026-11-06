/**
 * Shared, role-aware internal navigation registry.
 *
 * One menu row per page. The rows, in order:
 *
 *   Dashboard · Tasks
 *   Messages · Clients · Crew · Calendar · Coaching · Sales · Membership · Team
 *   Settings
 *
 * A row with several pages opens a flyout (desktop) or a submenu (phone More).
 * An old address that only redirects to a tab of a page the menu already
 * lists stays here as `searchOnly`: out of the menu, still found by More's
 * search, the sitemap and the floating-bar picker, and it lights its row.
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
  LayoutDashboard, Users, ClipboardList, Activity, ClipboardCheck,
  Dumbbell, Heart, Flame, ChefHat, BookOpen, FileEdit, HelpCircle,
  MessageCircle, Megaphone, LayoutGrid, Phone, Sparkles, MessagesSquare,
  UserCheck, CreditCard, Ticket, Calendar,
  Layers, Briefcase, Archive, UserPlus, UserCog, Settings, AlertCircle,
  FileSignature, ShoppingBag, Library, KeyRound, BarChart3, RefreshCw,
  Link as LinkIcon, Trophy, ShieldCheck, UsersRound, Contact,
  ListChecks, FileText, PowerOff, Landmark, Wallet, BadgeCheck, Image as ImageIcon, Swords,
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
  | "Crew"
  | "Calendar"
  | "Coaching"
  | "Sales"
  | "Membership"
  | "Team"
  | "Settings";

export const WORKSPACE_ORDER: WorkspaceKey[] = [
  "Overview", "Messages", "Clients", "Crew", "Calendar", "Coaching", "Sales",
  "Membership", "Team", "Settings",
];

type Entry = NavItem & { visibleTo: StaffRoleTag[] };

const COACHING_STAFF: StaffRoleTag[] = ["admin", "coach", "assistant_coach"];

/** All workspace items. `group` MUST be a WorkspaceKey so the shell groups it.
 *  The first entry a role can see in a group is that row's page. */
const REGISTRY: Entry[] = [
  // ── OVERVIEW ─────────────────────────────────────────────────────────
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, group: "Overview",
    visibleTo: ["admin", "coach", "assistant_coach", "media_manager", "sales", "support", "operations", "staff"] },
  { to: "/admin/tasks", label: "Tasks", icon: ListChecks, group: "Overview",
    visibleTo: ["admin", "coach", "assistant_coach", "sales", "support", "operations"] },

  // ── MESSAGES ─────────────────────────────────────────────────────────
  // One page (Communication): 1:1 Chats · Groups · Support · Broadcasts tabs.
  { to: "/admin/messages", label: "Messages", icon: MessageCircle, group: "Messages",
    visibleTo: ["admin", "coach", "assistant_coach", "sales", "support"],
    keywords: ["inbox", "chat", "chats", "direct messages", "groups", "group chat"] },
  { to: "/admin/communication", label: "Communication Hub", icon: MessagesSquare, group: "Messages", searchOnly: true,
    visibleTo: ["admin", "coach", "assistant_coach", "media_manager", "sales", "support"],
    keywords: ["inbox", "chat", "direct messages", "group chat", "support inbox"] },
  { to: "/admin/support-alerts", label: "Support", icon: AlertCircle, group: "Messages", searchOnly: true,
    visibleTo: ["admin", "coach", "support"], keywords: ["support inbox", "help", "alerts", "tickets"] },
  // New coaching applications with the AI's read and a text to send (pinned in Messages, on Home).
  { to: "/admin/leads", label: "Coaching leads", icon: UserPlus, group: "Messages", searchOnly: true,
    visibleTo: ["admin"], keywords: ["leads", "applications", "prospects", "new clients", "sales", "follow up"] },

  // ── CLIENTS ──────────────────────────────────────────────────────────
  { to: "/admin/clients", label: "Clients", icon: Contact, group: "Clients",
    visibleTo: ["admin", "coach", "assistant_coach", "sales", "support"] },
  { to: "/admin/coaching-agreements", label: "Coaching Agreements", icon: FileSignature, group: "Clients",
    visibleTo: ["admin"],
    keywords: ["agreement", "contract", "waiver", "liability", "signed", "unsigned", "e-sign", "sign", "remind", "resend"] },

  // ── CREW ─────────────────────────────────────────────────────────────
  { to: "/admin/community", label: "Crew", icon: UsersRound, group: "Crew",
    visibleTo: ["admin", "coach"],
    keywords: ["crew", "community", "shared workouts", "feed", "photos", "reactions", "coach recognition", "post scores", "insights", "lessons", "birthday posts"] },
  { to: "/admin/league", label: "League", icon: Trophy, group: "Crew",
    visibleTo: ["admin", "coach"],
    keywords: ["league", "leaderboard", "standings", "crew goal", "hall of strength", "final-week boost"] },
  { to: "/admin/athlete-records", label: "Athlete Records", icon: Trophy, group: "Crew",
    visibleTo: ["admin", "coach"], keywords: ["rankings", "leaderboard", "powerlifting", "dots", "gl points", "squat", "bench", "deadlift", "records", "competition level", "meet results", "athlete profiles"] },
  { to: "/admin/challenges", label: "Challenges", icon: Swords, group: "Crew",
    visibleTo: ["admin"], keywords: ["challenge", "competition", "event", "bench 225", "winnipeg 225", "leaderboard", "judge", "registration", "prizes", "sponsors", "live event"] },

  // ── CALENDAR ─────────────────────────────────────────────────────────
  // One Calendar page with tabs; the old paths redirect into it.
  { to: "/admin/calendar", label: "Calendar", icon: Calendar, group: "Calendar",
    visibleTo: ["admin", "coach", "assistant_coach", "sales", "support", "operations", "media_manager"],
    keywords: ["calendar", "schedule", "appointments", "upcoming", "book", "booking"] },
  { to: "/admin/pt-calendar", label: "Sessions", icon: Calendar, group: "Calendar", searchOnly: true,
    visibleTo: ["admin", "coach"], keywords: ["pt", "personal training", "1:1", "sessions", "pt calendar"] },
  { to: "/admin/google-calendar", label: "Calendar Setup", icon: LinkIcon, group: "Calendar", searchOnly: true,
    visibleTo: ["admin", "coach", "sales"], keywords: ["google calendar", "booking links", "sync", "availability"] },

  // ── COACHING ─────────────────────────────────────────────────────────
  // Three pages: the Coaching hub (Training Intel · Progress · Requests ·
  // Schedules · Management), Forms (Submissions · Requests · Forms ·
  // Applications · Agreements) and Programs (Programs · Exercises · Cardio ·
  // Warm-Ups · Recipes). Every older address lands on one of their tabs.
  { to: "/admin/coaching", label: "Coaching Hub", icon: ClipboardList, group: "Coaching",
    visibleTo: COACHING_STAFF,
    keywords: ["coaching", "training intelligence", "progress", "action requests", "schedules", "management"] },
  { to: "/admin/forms", label: "Forms", icon: FileEdit, group: "Coaching",
    visibleTo: ["admin", "coach"],
    keywords: ["submissions", "check-ins", "check-in reviews", "requests", "form builder", "applications", "agreements"] },
  { to: "/admin/programming", label: "Programs", icon: BookOpen, group: "Coaching",
    visibleTo: COACHING_STAFF,
    keywords: ["programming", "program library", "templates", "exercises", "cardio", "warm-ups", "recipes"] },
  { to: "/admin/check-in-reviews", label: "Check-In Reviews", icon: ClipboardCheck, group: "Coaching", searchOnly: true,
    visibleTo: COACHING_STAFF, keywords: ["weekly check in", "submissions", "reviews"] },
  { to: "/admin/training-intelligence", label: "Training Intel", icon: Activity, group: "Coaching", searchOnly: true,
    visibleTo: COACHING_STAFF },
  { to: "/admin/native-forms", label: "Check-Ins & Forms", icon: FileEdit, group: "Coaching", searchOnly: true,
    visibleTo: COACHING_STAFF },
  { to: "/admin/fillout-submissions", label: "Fillout Submissions", icon: ClipboardList, group: "Coaching", searchOnly: true,
    visibleTo: ["admin", "coach"] },
  { to: "/admin/agreements", label: "SignNow Agreements (old)", icon: FileSignature, group: "Coaching", searchOnly: true,
    visibleTo: ["admin", "coach"] },
  // A coach finds applications under Forms → Applications; admins also have them under Sales.
  { to: "/admin/sales/coaching-applications", label: "Coaching Applications", icon: ClipboardList, group: "Coaching", searchOnly: true,
    visibleTo: ["coach"] },
  { to: "/admin/program-library", label: "Program Library", icon: Library, group: "Coaching", searchOnly: true,
    visibleTo: COACHING_STAFF },
  { to: "/admin/exercises", label: "Exercise Library", icon: Dumbbell, group: "Coaching", searchOnly: true,
    visibleTo: COACHING_STAFF },
  { to: "/admin/cardio-targets", label: "Cardio Targets", icon: Heart, group: "Coaching", searchOnly: true,
    visibleTo: COACHING_STAFF },
  { to: "/admin/warmup-protocols", label: "Warm-Up Protocols", icon: Flame, group: "Coaching", searchOnly: true,
    visibleTo: COACHING_STAFF },
  { to: "/admin/recipes", label: "Recipe Library", icon: ChefHat, group: "Coaching", searchOnly: true,
    visibleTo: COACHING_STAFF },

  // ── SALES ────────────────────────────────────────────────────────────
  // The Sales page holds Products · Transactions · Taxes & Books · Discount
  // Codes · Settings; their older addresses stay findable. CRM and
  // applications are pages of their own.
  { to: "/admin/sales", label: "Sales", icon: BarChart3, group: "Sales",
    visibleTo: ["admin", "sales"],
    keywords: ["payments", "money", "revenue", "products", "transactions", "discount codes", "checkout settings"] },
  // The CRM pages predate Coaching leads (Messages → Leads), which is where a
  // new application is worked now: findable, not listed.
  { to: "/admin/crm", label: "CRM Dashboard", icon: UserCheck, group: "Sales", searchOnly: true,
    visibleTo: ["admin", "sales"] },
  { to: "/admin/crm/contacts", label: "Leads & Contacts", icon: Users, group: "Sales", searchOnly: true,
    visibleTo: ["admin", "sales"] },
  { to: "/admin/sales/coaching-applications", label: "Coaching Applications", icon: ClipboardList, group: "Sales",
    visibleTo: ["admin", "sales"] },
  { to: "/admin/payments", label: "Overview", icon: BarChart3, group: "Sales", searchOnly: true,
    visibleTo: ["admin", "sales"],
    keywords: ["overview", "dashboard", "revenue", "mrr", "gross", "net", "sales"] },
  { to: "/admin/transactions", label: "Transactions", icon: Activity, group: "Sales", searchOnly: true,
    visibleTo: ["admin", "sales", "support"],
    keywords: ["transactions", "payments", "purchases", "invoices", "receipts", "refunds", "history", "stripe", "product sales"] },
  { to: "/admin/sales?tab=taxes", label: "Taxes & Books", icon: Landmark, group: "Sales", searchOnly: true,
    visibleTo: ["admin"],
    keywords: ["taxes", "tax", "gst", "hst", "cra", "books", "bookkeeping", "expenses", "receipts", "accountant", "t2125", "year end", "cleo", "assistant"] },
  { to: "/admin/payment-links", label: "Products", icon: ShoppingBag, group: "Sales", searchOnly: true,
    visibleTo: ["admin", "sales"],
    keywords: ["products", "offers", "memberships", "coaching", "programs", "digital products", "merchandise", "checkout links", "payment links", "stripe"] },
  { to: "/admin/discount-codes", label: "Discount Codes", icon: Ticket, group: "Sales", searchOnly: true,
    visibleTo: ["admin", "sales"],
    keywords: ["promo", "discount", "coupon", "codes", "referral", "stripe"] },
  { to: "/admin/billing-sources", label: "Payment Settings", icon: CreditCard, group: "Sales", searchOnly: true,
    visibleTo: ["admin"],
    keywords: ["settings", "stripe", "business", "taxes", "branding", "notifications", "advanced", "developer", "webhooks", "billing events"] },

  // ── MEMBERSHIP ───────────────────────────────────────────────────────
  // The JF Membership business, in the same menu as everything else: there
  // is no separate membership mode to switch into (or get stuck in).
  { to: "/admin/membership", label: "Membership Home", icon: BadgeCheck, group: "Membership",
    visibleTo: ["admin"], keywords: ["membership", "jf membership", "app members", "member ops"] },
  { to: "/admin/members", label: "Members", icon: Users, group: "Membership",
    visibleTo: ["admin"],
    keywords: ["members", "app members", "trialing", "past due", "paused", "cancelled", "complimentary", "access overrides", "test member"] },
  { to: "/admin/membership/action-needed", label: "Action Needed", icon: AlertCircle, group: "Membership",
    visibleTo: ["admin"],
    keywords: ["failed payments", "expired trials", "expired access", "incomplete setup", "missing profile", "membership alerts"] },
  { to: "/admin/membership/billing", label: "Subscriptions", icon: CreditCard, group: "Membership",
    visibleTo: ["admin"], keywords: ["subscriptions", "billing", "renewals", "membership payments"] },
  { to: "/admin/member-plans", label: "Plan Library", icon: Library, group: "Membership",
    visibleTo: ["admin"], keywords: ["plans", "pricing", "membership content"] },
  { to: "/admin/membership/programs", label: "Membership Programs", icon: BookOpen, group: "Membership",
    visibleTo: ["admin"] },
  { to: "/admin/membership/sms-email", label: "SMS & Email", icon: MessageCircle, group: "Membership",
    visibleTo: ["admin"] },
  // Members write in on Messages → Support.
  { to: "/admin/membership/support", label: "Member Support", icon: MessagesSquare, group: "Membership", searchOnly: true,
    visibleTo: ["admin"], keywords: ["support inbox", "member messages", "help"] },
  // Pages that only say "coming soon" (Content Ideas, Testimonials, Challenges,
  // Welcome Messages, Promo Tools) are in no menu or search: a dead end isn't
  // worth finding. Their addresses still open.
  { to: "/admin/membership/sales-page", label: "Sales Page", icon: Sparkles, group: "Membership",
    visibleTo: ["admin"], section: "Sales", keywords: ["sales page", "join page", "landing"] },
  { to: "/admin/membership/signup-link", label: "Signup Link", icon: LinkIcon, group: "Membership", searchOnly: true,
    visibleTo: ["admin"], section: "Sales" },
  { to: "/admin/membership/signup-stats", label: "Signup Stats", icon: BarChart3, group: "Membership",
    visibleTo: ["admin"], section: "Sales", keywords: ["membership analytics", "signups", "conversion"] },
  { to: "/admin/membership/checkout-settings", label: "Checkout Kill-Switch", icon: PowerOff, group: "Membership",
    visibleTo: ["admin"], section: "Sales", keywords: ["kill switch", "pause", "checkout", "disable signups", "join page", "trial settings"] },
  { to: "/admin/membership/billing-events", label: "Billing Events", icon: Activity, group: "Membership", searchOnly: true,
    visibleTo: ["admin"], section: "Setup" },
  { to: "/admin/membership/calendar", label: "Membership Calendar", icon: Calendar, group: "Membership", searchOnly: true,
    visibleTo: ["admin"], section: "Setup",
    keywords: ["calendar", "renewals", "trial ends", "enrollments", "billing events", "membership calendar"] },
  { to: "/admin/membership/setup-links", label: "Setup Links", icon: LinkIcon, group: "Membership", searchOnly: true,
    visibleTo: ["admin"], section: "Setup" },
  { to: "/admin/membership/reset-links", label: "Reset Links", icon: KeyRound, group: "Membership", searchOnly: true,
    visibleTo: ["admin"], section: "Setup" },
  { to: "/admin/membership/onboarding-email", label: "Onboarding Email", icon: Megaphone, group: "Membership", searchOnly: true,
    visibleTo: ["admin"], section: "Setup" },
  { to: "/admin/membership/notifications", label: "Notifications Log", icon: AlertCircle, group: "Membership", searchOnly: true,
    visibleTo: ["admin"], section: "Setup", keywords: ["notifications", "dry run", "allowlist", "live", "attempts", "push notifications"] },
  { to: "/admin/membership/access-checklist", label: "Access Checklist", icon: ListChecks, group: "Membership", searchOnly: true,
    visibleTo: ["admin"], section: "Setup", keywords: ["access rules", "access setup"] },

  // ── TEAM ─────────────────────────────────────────────────────────────
  // One Team page: People · Staff access · Operations tabs.
  { to: "/admin/team", label: "Team", icon: Users, group: "Team",
    visibleTo: ["admin", "operations"], keywords: ["people", "coaches", "staff", "operations"] },
  { to: "/admin/coaches", label: "Coaches", icon: UserCheck, group: "Team", searchOnly: true,
    visibleTo: ["admin", "operations"] },
  { to: "/admin/staff", label: "Staff access", icon: UserPlus, group: "Team", searchOnly: true,
    visibleTo: ["admin", "operations"] },

  // ── SETTINGS ─────────────────────────────────────────────────────────
  // Everything you set once lives here (the old Add-ons and the chat media
  // libraries included), opening on Account, the first tab of the Settings
  // tab row that holds most of it.
  { to: "/admin/account", label: "Account", icon: UserCog, group: "Settings",
    visibleTo: ["admin", "coach", "assistant_coach", "media_manager", "sales", "support", "operations", "staff"] },
  { to: "/admin/settings", label: "Workspace", icon: Settings, group: "Settings",
    visibleTo: ["admin", "coach", "assistant_coach", "sales", "support", "operations", "staff"],
    keywords: ["app settings", "email sender", "drive", "archive", "signnow"] },
  { to: "/admin/voice", label: "My Voice", icon: Sparkles, group: "Settings",
    visibleTo: ["admin", "coach"] },
  { to: "/admin/automations", label: "Automations", icon: RefreshCw, group: "Settings",
    visibleTo: ["admin", "coach"] },
  { to: "/admin/apps", label: "Integrations", icon: Layers, group: "Settings",
    visibleTo: ["admin"], keywords: ["add-ons", "apps", "gmail", "google", "stripe"] },
  { to: "/admin/faqs", label: "FAQ Manager", icon: HelpCircle, group: "Settings",
    visibleTo: ["admin", "coach"] },
  { to: "/admin/floating-bar", label: "Floating Bar", icon: LayoutGrid, group: "Settings",
    visibleTo: ["admin", "coach"] },
  { to: "/admin/settings/chat", label: "Chat Settings", icon: MessageCircle, group: "Settings",
    visibleTo: ["admin"], section: "Messaging" },
  { to: "/admin/chat-gifs", label: "Chat Media", icon: ImageIcon, group: "Settings",
    visibleTo: ["admin"], section: "Messaging", keywords: ["gif", "gifs", "chat gif library"] },
  { to: "/admin/chat-sounds", label: "Chat Sound Library", icon: Sparkles, group: "Settings", searchOnly: true,
    visibleTo: ["admin"], keywords: ["sounds", "chat media"] },
  { to: "/admin/call-access", label: "Call Access", icon: Phone, group: "Settings",
    visibleTo: ["admin"], section: "Messaging", keywords: ["add-ons", "calls"] },
  { to: "/admin/settings/sms", label: "SMS Access", icon: MessageCircle, group: "Settings",
    visibleTo: ["admin"], section: "Messaging", keywords: ["add-ons", "texts"] },
  { to: "/admin/popups", label: "Popups", icon: LayoutGrid, group: "Settings", searchOnly: true,
    visibleTo: ["admin"], section: "Messaging", keywords: ["popup", "modal", "birthday cards", "task popup", "load screen"] },
  { to: "/admin/legal", label: "Legal", icon: FileSignature, group: "Settings",
    visibleTo: ["admin"], section: "Business", keywords: ["terms", "privacy", "policy", "disclaimers"] },
  { to: "/admin/settings/notifications/coaching-applications", label: "Application Alerts", icon: AlertCircle, group: "Settings",
    visibleTo: ["admin"], section: "Business" },
  // Set-once and technical pages: out of the menu (not touched since setup),
  // still found by More's search and the ⌘K palette.
  { to: "/admin/onboarding", label: "Onboarding", icon: ClipboardCheck, group: "Settings", searchOnly: true,
    visibleTo: ["admin"], section: "Advanced" },
  { to: "/admin/feature-flags", label: "Feature Flags", icon: ShieldCheck, group: "Settings", searchOnly: true,
    visibleTo: ["admin"], section: "Advanced" },
  { to: "/admin/archives", label: "Archive Manager", icon: Archive, group: "Settings", searchOnly: true,
    visibleTo: ["admin"], section: "Advanced" },
];

/**
 * Every staff account's phone bar (admin, coach), laid out like the client
 * app: plain tabs with Crew as the raised centre button, named the same as the
 * clients' (the feed, the posts that go out on their own, insights), and the
 * League on its trophy. More opens from the header.
 */
export const STAFF_BAR: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/clients", label: "Clients", icon: Contact },
  { to: "/admin/community", label: "Crew", icon: UsersRound, featured: true,
    // the satellite on Crew's button: the League, its own page
    shortcut: { to: "/admin/league", hash: "", label: "League", icon: Trophy } },
  { to: "/admin/messages", label: "Messages", icon: MessageCircle },
  { to: "/admin/tasks", label: "Tasks", icon: ListChecks },
];

/**
 * The finance login's own section, first in its sidebar: its home and the
 * money pages it works in every day, from the same registry entries as the
 * admin's Sales menu (labels tuned for a bookkeeper). The rest of the admin
 * nav follows.
 */
export const FINANCE_HOME: NavItem = { to: "/admin/finance", label: "Home", icon: Wallet, group: "Finance" };
/** Real paths (no query string) so the sidebar and phone bar can show them as selected. */
export const FINANCE_BOOKS: NavItem = { to: "/admin/finance/books", label: "Books", icon: Landmark, group: "Finance" };
export const FINANCE_PAYMENTS: NavItem = { to: "/admin/finance/payments", label: "Payments", icon: CreditCard, group: "Finance" };

/**
 * The finance login's phone bar, laid out like every staff bar: its home,
 * Money (Books and Payments, switched at the top of the page), Crew as the
 * raised centre button, Clients and Tasks. More opens from the header.
 */
export const FINANCE_BAR: NavItem[] = [
  { to: FINANCE_HOME.to, label: "Home", icon: Wallet },
  { to: FINANCE_BOOKS.to, label: "Money", icon: Landmark, activeOn: [FINANCE_PAYMENTS.to] },
  ...STAFF_BAR.filter((i) => i.to === "/admin/community"),
  ...STAFF_BAR.filter((i) => i.to === "/admin/clients" || i.to === "/admin/tasks"),
];
const FINANCE_PAGES: Array<{ to: string; label?: string }> = [
  { to: "/admin/transactions", label: "Stripe activity" },
  { to: "/admin/payments", label: "Revenue" },
  { to: "/admin/membership/billing", label: "Subscriptions" },
  { to: "/admin/discount-codes" },
  { to: "/admin/payment-links" },
];

export function buildFinanceNav(): NavItem[] {
  const all = REGISTRY;
  return [
    FINANCE_HOME,
    FINANCE_BOOKS,
    FINANCE_PAYMENTS,
    ...FINANCE_PAGES.flatMap(({ to, label }) => {
      const entry = all.find((e) => e.to === to);
      if (!entry) return [];
      // its own section shows them all, wherever the admin menu keeps them
      const { visibleTo: _v, section: _s, searchOnly: _o, ...item } = entry;
      return [{ ...item, label: label ?? item.label, group: "Finance" } as NavItem];
    }),
  ];
}

/**
 * Every page a staff role tag can reach, flat (`searchOnly` ones included):
 * the sitemap, the floating-bar picker and the menu below read it.
 * Returns `NavItem[]` (already filtered, already grouped via NavItem.group).
 */
export function buildInternalNav(roleTag: StaffRoleTag): NavItem[] {
  return REGISTRY.filter((e) => e.visibleTo.includes(roleTag)).map(({ visibleTo: _v, ...item }) => item as NavItem);
}

/** Each workspace row's label (and icon, where its first page's doesn't fit the row). */
const WORKSPACE_ROWS: Partial<Record<WorkspaceKey, { label: string; icon?: NavItem["icon"] }>> = {
  Messages: { label: "Messages" },
  Clients: { label: "Clients" },
  Crew: { label: "Crew" },
  Calendar: { label: "Calendar" },
  Coaching: { label: "Coaching" },
  Sales: { label: "Sales" },
  Membership: { label: "Membership" },
  Team: { label: "Team" },
  // opens on Account (the tab row's first), drawn as Settings
  Settings: { label: "Settings", icon: Settings },
};

/**
 * The menu: one row per page. Overview items stay flat; every other
 * workspace is ONE top-level `NavItem` whose `to` is the first page the role
 * can see in that group and whose `children` are its other pages, shown as a
 * hover flyout on desktop and a submenu on phones. A workspace with a single
 * page is a plain row. `searchOnly` children ride along (More's search finds
 * them, they light the row, their badges count on it) but are never listed.
 */
export function buildInternalNavCollapsed(roleTag: StaffRoleTag): NavItem[] {
  const flat = buildInternalNav(roleTag);
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
    const items = byGroup.get(key) ?? [];
    const primary = items.find((i) => !i.searchOnly);
    if (!primary) continue;
    // Keep primary at top; among the rest, preserve REGISTRY order but push
    // any child tagged with a `section` to the bottom so the flyout shows
    // frequent / high-priority pages first and setup / diagnostic / advanced
    // pages under a labelled divider.
    const others = items.filter((i) => i !== primary);
    const listed = others
      .filter((i) => !i.searchOnly)
      .sort((a, b) => Number(!!a.section) - Number(!!b.section));
    const unlisted = others.filter((i) => i.searchOnly);
    const label = WORKSPACE_ROWS[key]?.label ?? primary.label;
    const children = [
      // the row's own page leads its flyout, under a name that isn't the row's again
      ...(listed.length > 0 ? [{ ...primary, label: primaryChildLabel(key, label, primary.label) }] : []),
      ...listed,
      ...unlisted,
    ];
    out.push({
      to: primary.to,
      label,
      icon: WORKSPACE_ROWS[key]?.icon ?? primary.icon,
      group: key === "Settings" ? "Other" : "Main Menu",
      keywords: primary.keywords,
      children: children.length > 0 ? children : undefined,
    });
  }
  return out;
}

/**
 * The name of a row's own page at the top of its flyout: its page's label,
 * unless that only repeats the row's ("Clients → Clients").
 */
function primaryChildLabel(workspace: WorkspaceKey, rowLabel: string, pageLabel: string): string {
  if (pageLabel !== rowLabel) return pageLabel;
  switch (workspace) {
    case "Clients": return "All Clients";
    case "Crew": return "Feed";
    case "Sales": return "Sales & payments";
    default: return "Overview";
  }
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
