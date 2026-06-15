/**
 * Centralized admin route registry — single source of truth for the global
 * command palette / search. Includes pages that are NOT in the sidebar so
 * admins can reach every authorized surface from search.
 *
 * Every entry MUST have an existing route. Permissions are enforced by the
 * route loaders and DB RLS — this list just controls *visibility* in
 * search results.
 */
import {
  LayoutDashboard, Users, ClipboardList, Video, Activity, ClipboardCheck,
  Dumbbell, Heart, Flame, ChefHat, BookOpen, FileEdit, HelpCircle,
  MessageCircle, Megaphone, Phone, Sparkles, MessagesSquare,
  UserCheck, CreditCard, DollarSign, Ticket, Calendar, Film, FolderOpen,
  Layers, Briefcase, Archive, UserPlus, UserCog, Settings, AlertCircle,
  FileSignature, ShoppingBag, Library, KeyRound, BarChart3, RefreshCw,
  Link as LinkIcon, Trophy, Tag, ShieldCheck, Home as HomeIcon, ListChecks,
  Star, FileText, ExternalLink, Image as ImageIcon, PowerOff, Bell, Image,
  Mail, Smartphone, ListTodo, Database, GitBranch, Globe, Package,
  Wrench, Plus, Send, Mic, Music, Eye, type LucideIcon,
} from "lucide-react";

export type AdminRole = "admin" | "coach" | "media_manager";

export type RouteCategory =
  | "Quick Actions"
  | "Clients"
  | "Coaching"
  | "Programming"
  | "Workouts"
  | "Exercises"
  | "Nutrition"
  | "Forms & Check-Ins"
  | "Communication"
  | "Calendar"
  | "Membership"
  | "Sales & Payments"
  | "Content & Media"
  | "Team"
  | "Admin Pages"
  | "Settings"
  | "Legal & Compliance";

export type AdminRouteEntry = {
  id: string;
  label: string;
  to: string;
  category: RouteCategory;
  description?: string;
  /** Breadcrumb-style location e.g. "Admin → Membership → Notifications". */
  parent?: string;
  keywords?: string[];
  /** Roles allowed to see this in search. */
  roles: AdminRole[];
  icon: LucideIcon;
  /** Mark true for quick actions (Add Client, Create Program…). */
  isAction?: boolean;
  /** Mark hidden pages that don't appear in any sidebar. */
  hidden?: boolean;
};

const ADMIN: AdminRole[] = ["admin"];
const ADMIN_COACH: AdminRole[] = ["admin", "coach"];
const ALL: AdminRole[] = ["admin", "coach", "media_manager"];

export const ADMIN_ROUTE_REGISTRY: AdminRouteEntry[] = [
  // ── QUICK ACTIONS ───────────────────────────────────────────────────
  { id: "qa-add-client", label: "Add Client", to: "/admin/clients?new=1",
    category: "Quick Actions", isAction: true, roles: ADMIN_COACH, icon: UserPlus,
    keywords: ["create client", "new client", "invite client"] },
  { id: "qa-add-coach", label: "Add Coach", to: "/admin/team?tab=coaches&new=1",
    category: "Quick Actions", isAction: true, roles: ADMIN, icon: UserPlus,
    keywords: ["create coach", "new coach", "invite coach"] },
  { id: "qa-add-member", label: "Add App Member", to: "/admin/members/new",
    category: "Quick Actions", isAction: true, roles: ADMIN, icon: UserPlus,
    keywords: ["create member", "new app member", "invite member"] },
  { id: "qa-new-program", label: "Create Program Template", to: "/admin/program-library?new=1",
    category: "Quick Actions", isAction: true, roles: ADMIN_COACH, icon: Plus,
    keywords: ["new template", "create template", "new program"] },
  { id: "qa-assign-program", label: "Assign Program", to: "/admin/program-assign",
    category: "Quick Actions", isAction: true, roles: ADMIN_COACH, icon: Send,
    keywords: ["assign", "give program", "push program"] },
  { id: "qa-new-exercise", label: "Create Exercise", to: "/admin/exercises?new=1",
    category: "Quick Actions", isAction: true, roles: ADMIN_COACH, icon: Plus,
    keywords: ["new exercise", "add exercise"] },
  { id: "qa-send-message", label: "Send Message", to: "/admin/messages",
    category: "Quick Actions", isAction: true, roles: ADMIN_COACH, icon: Send,
    keywords: ["dm", "chat", "compose"] },
  { id: "qa-new-broadcast", label: "New Broadcast", to: "/admin/broadcasts?new=1",
    category: "Quick Actions", isAction: true, roles: ADMIN_COACH, icon: Megaphone,
    keywords: ["announcement", "send broadcast"] },
  { id: "qa-new-checkin", label: "Create Check-In Form", to: "/admin/forms?tab=native&new=1",
    category: "Quick Actions", isAction: true, roles: ADMIN_COACH, icon: ClipboardCheck,
    keywords: ["new form", "new check in"] },
  { id: "qa-new-plan", label: "Create Nutrition Plan", to: "/admin/nutrition-targets?new=1",
    category: "Quick Actions", isAction: true, roles: ADMIN_COACH, icon: ChefHat,
    keywords: ["macros", "diet", "nutrition plan"] },
  { id: "qa-open-settings", label: "Open App Settings", to: "/admin/settings",
    category: "Quick Actions", isAction: true, roles: ALL, icon: Settings },
  { id: "qa-open-notifications", label: "Open Notifications", to: "/admin/membership/notifications",
    category: "Quick Actions", isAction: true, roles: ADMIN, icon: Bell },

  // ── CLIENTS ─────────────────────────────────────────────────────────
  { id: "clients", label: "Clients", to: "/admin/clients", category: "Clients",
    parent: "Admin → Clients", roles: ADMIN_COACH, icon: Users,
    keywords: ["roster", "client list", "people"] },
  { id: "leads", label: "Leads & Contacts", to: "/admin/crm/contacts", category: "Clients",
    parent: "Admin → CRM", roles: ADMIN, icon: UserCheck,
    keywords: ["crm", "lead", "prospects", "contacts"] },
  { id: "members-list", label: "App Members", to: "/admin/members", category: "Clients",
    parent: "Admin → Members", roles: ADMIN, icon: Users,
    keywords: ["membership members", "self guided members"] },
  { id: "client-pov", label: "Client POV", to: "/admin/client-pov", category: "Clients",
    parent: "Admin → Clients", roles: ADMIN_COACH, icon: Eye, hidden: true,
    keywords: ["view as client", "impersonate client", "point of view"] },
  { id: "client-requests", label: "Client Action Requests", to: "/admin/client-action-requests",
    category: "Clients", parent: "Admin → Clients", roles: ADMIN_COACH, icon: ListTodo, hidden: true,
    keywords: ["requests", "action items", "pending actions"] },

  // ── COACHING ────────────────────────────────────────────────────────
  { id: "coaching", label: "Coaching Workspace", to: "/admin/coaching", category: "Coaching",
    parent: "Admin → Coaching", roles: ADMIN_COACH, icon: ClipboardList },
  { id: "checkin-reviews", label: "Check-In Reviews", to: "/admin/check-in-reviews",
    category: "Coaching", parent: "Admin → Coaching", roles: ADMIN_COACH, icon: ClipboardCheck,
    keywords: ["weekly check in", "reviews", "client check-ins"] },
  { id: "lift-videos", label: "Lift Video Reviews", to: "/admin/lift-videos",
    category: "Coaching", parent: "Admin → Coaching", roles: ADMIN_COACH, icon: Video,
    keywords: ["vid review", "video review", "form check", "technique"] },
  { id: "training-intel", label: "Training Intelligence", to: "/admin/training-intelligence",
    category: "Coaching", parent: "Admin → Coaching", roles: ADMIN_COACH, icon: Activity,
    keywords: ["intel", "insights", "training analytics"] },
  { id: "nutrition-dashboard", label: "Nutrition Dashboard", to: "/admin/nutrition-dashboard",
    category: "Nutrition", parent: "Admin → Coaching", roles: ADMIN_COACH, icon: ChefHat,
    keywords: ["nutrition update", "nutri", "macros review"] },
  { id: "nutrition-targets", label: "Nutrition Targets", to: "/admin/nutrition-targets",
    category: "Nutrition", parent: "Admin → Coaching", roles: ADMIN_COACH, icon: Flame,
    keywords: ["macros", "calories", "nutrition plan", "diet"] },
  { id: "cardio", label: "Cardio Targets", to: "/admin/cardio-targets",
    category: "Coaching", parent: "Admin → Coaching", roles: ADMIN_COACH, icon: Heart,
    keywords: ["conditioning", "steps", "zone 2", "liss", "hiit"] },
  { id: "warmup", label: "Warmup Protocols", to: "/admin/warmup-protocols",
    category: "Coaching", parent: "Admin → Coaching", roles: ADMIN_COACH, icon: Activity,
    keywords: ["warm up", "mobility", "prep"], hidden: true },
  { id: "training-phases", label: "Training Phases", to: "/admin/training-phases",
    category: "Coaching", parent: "Admin → Coaching", roles: ADMIN_COACH, icon: Layers, hidden: true },

  // ── PROGRAMMING / WORKOUTS / EXERCISES ──────────────────────────────
  { id: "programming", label: "Programming", to: "/admin/programming", category: "Programming",
    parent: "Admin → Programming", roles: ADMIN_COACH, icon: BookOpen },
  { id: "program-library", label: "Program Library", to: "/admin/program-library",
    category: "Programming", parent: "Admin → Programming", roles: ADMIN_COACH, icon: Library,
    keywords: ["templates", "program templates"] },
  { id: "membership-library", label: "Membership Workout Library", to: "/admin/membership-library",
    category: "Workouts", parent: "Admin → Membership", roles: ADMIN, icon: Dumbbell,
    keywords: ["membership workouts", "self guided workouts", "member workouts"] },
  { id: "programs", label: "Assigned Programs", to: "/admin/programs", category: "Workouts",
    parent: "Admin → Programs", roles: ADMIN_COACH, icon: BookOpen,
    keywords: ["client programs", "assigned blocks", "active programs"] },
  { id: "exercises", label: "Exercise Library", to: "/admin/exercises",
    category: "Exercises", parent: "Admin → Programming", roles: ADMIN_COACH, icon: Dumbbell,
    keywords: ["exercises", "movements", "lift library"] },
  { id: "recipes", label: "Recipes", to: "/admin/recipes", category: "Nutrition",
    parent: "Admin → Programming", roles: ADMIN_COACH, icon: ChefHat,
    keywords: ["meal", "food", "cooking"] },

  // ── FORMS & CHECK-INS ───────────────────────────────────────────────
  { id: "forms", label: "Forms", to: "/admin/forms", category: "Forms & Check-Ins",
    parent: "Admin → Forms", roles: ADMIN_COACH, icon: FileEdit,
    keywords: ["form", "questionnaire", "intake"] },
  { id: "native-forms", label: "Native Forms", to: "/admin/native-forms",
    category: "Forms & Check-Ins", parent: "Admin → Forms", roles: ADMIN_COACH, icon: FileEdit,
    keywords: ["form builder"] },
  { id: "check-ins", label: "Check-Ins", to: "/admin/check-ins",
    category: "Forms & Check-Ins", parent: "Admin → Forms", roles: ADMIN_COACH, icon: ClipboardCheck },
  { id: "fillout-submissions", label: "Fillout Submissions", to: "/admin/fillout-submissions",
    category: "Forms & Check-Ins", parent: "Admin → Forms", roles: ADMIN_COACH, icon: FileText, hidden: true },
  { id: "program-submissions", label: "Program Submissions", to: "/admin/program-submissions",
    category: "Forms & Check-Ins", parent: "Admin → Forms", roles: ADMIN_COACH, icon: FileText, hidden: true },
  { id: "approvals", label: "Approvals", to: "/admin/approvals",
    category: "Forms & Check-Ins", parent: "Admin → Forms", roles: ADMIN_COACH, icon: ClipboardCheck, hidden: true,
    keywords: ["approve", "review queue"] },
  { id: "agreements", label: "Agreements", to: "/admin/agreements",
    category: "Legal & Compliance", parent: "Admin → Forms", roles: ADMIN, icon: FileSignature,
    keywords: ["agreement", "contract", "signed", "signnow"] },
  { id: "agreements-signed", label: "Signed Agreements", to: "/admin/agreements/signed",
    category: "Legal & Compliance", parent: "Admin → Forms → Agreements", roles: ADMIN, icon: FileSignature, hidden: true },
  { id: "agreements-native", label: "Native Agreements", to: "/admin/agreements-native",
    category: "Legal & Compliance", parent: "Admin → Forms", roles: ADMIN, icon: FileSignature, hidden: true },

  // ── COMMUNICATION ───────────────────────────────────────────────────
  { id: "communication", label: "Communication", to: "/admin/communication",
    category: "Communication", parent: "Admin → Communication", roles: ALL, icon: MessageCircle },
  { id: "messages", label: "Messages", to: "/admin/messages",
    category: "Communication", parent: "Admin → Communication", roles: ADMIN_COACH, icon: MessageCircle,
    keywords: ["inbox", "dm", "chat", "conversations"] },
  { id: "broadcasts", label: "Broadcasts", to: "/admin/broadcasts",
    category: "Communication", parent: "Admin → Communication", roles: ADMIN_COACH, icon: Megaphone,
    keywords: ["announcement", "blast", "newsletter"] },
  { id: "support", label: "Support Alerts", to: "/admin/support-alerts",
    category: "Communication", parent: "Admin → Communication", roles: ADMIN_COACH, icon: AlertCircle, hidden: true },
  { id: "call-access", label: "Call Access", to: "/admin/call-access",
    category: "Communication", parent: "Admin → Communication", roles: ADMIN, icon: Phone, hidden: true },
  { id: "sms-settings", label: "SMS Settings", to: "/admin/settings/sms",
    category: "Settings", parent: "Admin → Settings", roles: ADMIN, icon: Smartphone, hidden: true },
  { id: "chat-gifs", label: "Chat GIFs", to: "/admin/chat-gifs",
    category: "Communication", parent: "Admin → Communication", roles: ADMIN, icon: Image, hidden: true },
  { id: "chat-sounds", label: "Chat Sounds", to: "/admin/chat-sounds",
    category: "Communication", parent: "Admin → Communication", roles: ADMIN, icon: Music, hidden: true },
  { id: "popups", label: "Popups", to: "/admin/popups",
    category: "Communication", parent: "Admin → Communication", roles: ADMIN, icon: Bell, hidden: true,
    keywords: ["modal", "popup", "alert"] },

  // ── CALENDAR ────────────────────────────────────────────────────────
  { id: "calendar", label: "Calendar", to: "/admin/calendar",
    category: "Calendar", parent: "Admin → Calendar", roles: ALL, icon: Calendar,
    keywords: ["schedule", "events", "agenda"] },
  { id: "appointments", label: "Appointments", to: "/admin/appointments",
    category: "Calendar", parent: "Admin → Calendar", roles: ADMIN_COACH, icon: Calendar, hidden: true },
  { id: "booking-links", label: "Booking Links", to: "/admin/booking-links",
    category: "Calendar", parent: "Admin → Calendar", roles: ADMIN, icon: LinkIcon, hidden: true },
  { id: "pt-calendar", label: "PT Calendar", to: "/admin/pt-calendar",
    category: "Calendar", parent: "Admin → Calendar", roles: ADMIN_COACH, icon: Calendar, hidden: true,
    keywords: ["personal training"] },
  { id: "google-calendar", label: "Google Calendar", to: "/admin/google-calendar",
    category: "Calendar", parent: "Admin → Calendar", roles: ADMIN, icon: Calendar, hidden: true },
  { id: "events", label: "Events", to: "/admin/events",
    category: "Calendar", parent: "Admin → Calendar", roles: ADMIN, icon: Calendar, hidden: true },

  // ── SALES & PAYMENTS ────────────────────────────────────────────────
  { id: "sales", label: "Sales Dashboard", to: "/admin/sales", category: "Sales & Payments",
    parent: "Admin → Sales", roles: ADMIN, icon: BarChart3, keywords: ["revenue", "pipeline"] },
  { id: "payments", label: "Payments", to: "/admin/payments", category: "Sales & Payments",
    parent: "Admin → Sales", roles: ADMIN, icon: CreditCard, keywords: ["billing", "charges"] },
  { id: "purchases", label: "Purchases", to: "/admin/purchases", category: "Sales & Payments",
    parent: "Admin → Sales", roles: ADMIN, icon: ShoppingBag,
    keywords: ["orders", "transactions", "purchase records"] },
  { id: "payment-links", label: "Payment Links", to: "/admin/payment-links",
    category: "Sales & Payments", parent: "Admin → Sales", roles: ADMIN, icon: LinkIcon, hidden: true,
    keywords: ["checkout link", "billing"] },
  { id: "offers", label: "Offers / Products", to: "/admin/offers",
    category: "Sales & Payments", parent: "Admin → Sales", roles: ADMIN, icon: Tag,
    keywords: ["products", "packages", "offers"] },
  { id: "promo-codes", label: "Promo Codes", to: "/admin/promo-codes",
    category: "Sales & Payments", parent: "Admin → Sales", roles: ADMIN, icon: Ticket,
    keywords: ["discount", "coupon", "promo"] },
  { id: "sales-coaching-page", label: "Coaching Sales Page", to: "/admin/sales/coaching",
    category: "Sales & Payments", parent: "Admin → Sales", roles: ADMIN, icon: Sparkles, hidden: true },
  { id: "sales-membership-page", label: "Membership Sales Page", to: "/admin/sales/membership",
    category: "Sales & Payments", parent: "Admin → Sales", roles: ADMIN, icon: Sparkles, hidden: true },
  { id: "coaching-apps", label: "Coaching Applications", to: "/admin/sales/coaching-applications",
    category: "Sales & Payments", parent: "Admin → Sales", roles: ADMIN, icon: ClipboardList, hidden: true },

  // ── MEMBERSHIP ──────────────────────────────────────────────────────
  { id: "membership-home", label: "Membership Home", to: "/admin/membership",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: Sparkles },
  { id: "membership-billing", label: "Membership Billing", to: "/admin/membership/billing",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: CreditCard,
    keywords: ["subscriptions", "recurring billing", "stripe"] },
  { id: "billing-events", label: "Billing Events", to: "/admin/membership/billing-events",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: CreditCard, hidden: true },
  { id: "stripe-sync", label: "Stripe Sync", to: "/admin/membership/stripe-sync",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: RefreshCw, hidden: true },
  { id: "signup-stats", label: "Signup Stats", to: "/admin/membership/signup-stats",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: BarChart3, hidden: true },
  { id: "signup-link", label: "Signup Link", to: "/admin/membership/signup-link",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: LinkIcon, hidden: true },
  { id: "setup-links", label: "Setup Links", to: "/admin/membership/setup-links",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: LinkIcon, hidden: true },
  { id: "reset-links", label: "Password Reset Links", to: "/admin/membership/reset-links",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: KeyRound, hidden: true,
    keywords: ["reset password"] },
  { id: "membership-notifications", label: "Notifications Log", to: "/admin/membership/notifications",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: Bell, hidden: true },
  { id: "membership-welcome", label: "Welcome Messages", to: "/admin/membership/welcome-messages",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: Megaphone, hidden: true },
  { id: "membership-action-needed", label: "Action Needed", to: "/admin/membership/action-needed",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: AlertCircle, hidden: true },
  { id: "membership-launch", label: "Launch Readiness", to: "/admin/membership/launch-readiness",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: ShieldCheck, hidden: true },
  { id: "membership-access", label: "Access Checklist", to: "/admin/membership/access-checklist",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: ListChecks, hidden: true },
  { id: "checkout-killswitch", label: "Checkout Kill-Switch", to: "/admin/membership/checkout-settings",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: PowerOff, hidden: true,
    keywords: ["pause checkout", "disable signups"] },
  { id: "refund-policy", label: "Refund Policy", to: "/admin/membership/refund-policy",
    category: "Legal & Compliance", parent: "Admin → Membership", roles: ADMIN, icon: FileText, hidden: true },
  { id: "membership-support", label: "Membership Support", to: "/admin/membership/support",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: MessagesSquare, hidden: true },
  { id: "membership-calendar", label: "Membership Calendar", to: "/admin/membership/calendar",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: Calendar, hidden: true },
  { id: "promo-tools", label: "Promo Tools", to: "/admin/membership/promo-tools",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: Tag, hidden: true },
  { id: "challenges", label: "Challenges", to: "/admin/membership/challenges",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: Trophy, hidden: true },
  { id: "sms-email", label: "Membership SMS & Email", to: "/admin/membership/sms-email",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: Mail, hidden: true },
  { id: "onboarding-email", label: "Onboarding Email", to: "/admin/membership/onboarding-email",
    category: "Membership", parent: "Admin → Membership", roles: ADMIN, icon: Mail, hidden: true },
  { id: "member-plans", label: "Member Plans Library", to: "/admin/member-plans",
    category: "Programming", parent: "Admin → Membership", roles: ADMIN, icon: Library },
  { id: "member-plans-new", label: "New Member Plan", to: "/admin/member-plans/new",
    category: "Quick Actions", isAction: true, parent: "Admin → Membership", roles: ADMIN, icon: Plus, hidden: true },
  { id: "member-resources", label: "Member Resources", to: "/admin/member-resources",
    category: "Content & Media", parent: "Admin → Membership", roles: ADMIN, icon: FolderOpen },

  // ── CONTENT & MEDIA ─────────────────────────────────────────────────
  { id: "content", label: "Content", to: "/admin/content",
    category: "Content & Media", parent: "Admin → Content", roles: ALL, icon: Film },
  { id: "content-ideas", label: "Content Ideas", to: "/admin/content-ideas",
    category: "Content & Media", parent: "Admin → Content", roles: ALL, icon: Sparkles, hidden: true },
  { id: "media-review", label: "Media Review", to: "/admin/media-review",
    category: "Content & Media", parent: "Admin → Content", roles: ALL, icon: Video, hidden: true },
  { id: "media-archives", label: "Media Archives", to: "/admin/media-archives",
    category: "Content & Media", parent: "Admin → Content", roles: ALL, icon: Archive, hidden: true },
  { id: "testimonials", label: "Testimonials", to: "/admin/testimonials",
    category: "Content & Media", parent: "Admin → Content", roles: ADMIN, icon: Star, hidden: true },
  { id: "resources", label: "Resources", to: "/admin/resources",
    category: "Content & Media", parent: "Admin → Content", roles: ALL, icon: FolderOpen, hidden: true },
  { id: "archives", label: "Archives", to: "/admin/archives",
    category: "Content & Media", parent: "Admin → Content", roles: ALL, icon: Archive, hidden: true },

  // ── TEAM ────────────────────────────────────────────────────────────
  { id: "team", label: "Team", to: "/admin/team", category: "Team",
    parent: "Admin → Team", roles: ADMIN, icon: Users,
    keywords: ["coaches", "staff", "people"] },
  { id: "coaches", label: "Coaches", to: "/admin/coaches", category: "Team",
    parent: "Admin → Team", roles: ADMIN, icon: UserCog },
  { id: "staff", label: "Staff", to: "/admin/staff", category: "Team",
    parent: "Admin → Team", roles: ADMIN, icon: UserCog, hidden: true },
  { id: "business-systems", label: "Business Systems", to: "/admin/business-systems",
    category: "Team", parent: "Admin → Team", roles: ADMIN, icon: Briefcase, hidden: true },
  { id: "sops", label: "SOPs", to: "/admin/sops", category: "Team",
    parent: "Admin → Team", roles: ADMIN, icon: FileText, hidden: true,
    keywords: ["standard operating procedure", "playbook"] },

  // ── SETTINGS ────────────────────────────────────────────────────────
  { id: "settings", label: "Settings", to: "/admin/settings", category: "Settings",
    parent: "Admin → Settings", roles: ALL, icon: Settings },
  { id: "account", label: "My Account", to: "/admin/account", category: "Settings",
    parent: "Admin → Settings", roles: ALL, icon: UserCog },
  { id: "apps", label: "Connected Apps", to: "/admin/apps", category: "Settings",
    parent: "Admin → Settings", roles: ADMIN, icon: Package, hidden: true,
    keywords: ["integrations", "apps"] },
  { id: "automations", label: "Automations", to: "/admin/automations",
    category: "Settings", parent: "Admin → Settings", roles: ADMIN, icon: GitBranch, hidden: true },
  { id: "faqs", label: "FAQs", to: "/admin/faqs", category: "Settings",
    parent: "Admin → Settings", roles: ADMIN, icon: HelpCircle, hidden: true },
  { id: "settings-chat", label: "Chat Settings", to: "/admin/settings/chat",
    category: "Settings", parent: "Admin → Settings", roles: ADMIN, icon: MessageCircle, hidden: true },
  { id: "settings-nutrition-auto", label: "Nutrition Automation", to: "/admin/settings/nutrition-automation",
    category: "Settings", parent: "Admin → Settings", roles: ADMIN, icon: ChefHat, hidden: true },
  { id: "floating-bar", label: "Floating Bar Settings", to: "/admin/floating-bar",
    category: "Settings", parent: "Admin → Settings", roles: ADMIN, icon: Wrench, hidden: true },
  { id: "tasks", label: "Tasks", to: "/admin/tasks", category: "Admin Pages",
    parent: "Admin", roles: ADMIN_COACH, icon: ListTodo },

  // ── LEGAL & COMPLIANCE ──────────────────────────────────────────────
  { id: "legal", label: "Legal Documents", to: "/admin/legal",
    category: "Legal & Compliance", parent: "Admin → Legal", roles: ADMIN, icon: FileSignature,
    keywords: ["terms", "privacy", "policy", "tos", "legal"] },
];

/** Return the entries visible to the given role. */
export function getRegistryForRole(role: AdminRole | null | undefined): AdminRouteEntry[] {
  if (!role) return [];
  return ADMIN_ROUTE_REGISTRY.filter((e) => e.roles.includes(role));
}