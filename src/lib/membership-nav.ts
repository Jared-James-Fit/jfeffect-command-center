import {
  LayoutDashboard, Users, CreditCard, AlertCircle, FolderOpen, Calendar, Megaphone,
  UserPlus, Library, HelpCircle, ChefHat, BookOpen, Settings, ListChecks, Camera, Phone, MessageCircle, KeyRound,
  Link2 as LinkIcon, BarChart3, RefreshCw, ShoppingBag, Tag, MessagesSquare, Trophy, ShieldCheck,
} from "lucide-react";
import type { NavItem } from "@/components/app-shell";

export const membershipNav: NavItem[] = [
  // OVERVIEW
  { to: "/admin/membership", label: "Membership Dashboard", icon: LayoutDashboard, group: "Overview" },
  { to: "/admin/membership/signup-stats", label: "Signup Stats", icon: BarChart3, group: "Overview" },
  { to: "/admin/membership/action-needed", label: "Action Needed", icon: AlertCircle, group: "Overview" },
  // SALES
  { to: "/admin/membership/sales-page", label: "Sales Page", icon: ShoppingBag, group: "Sales" },
  { to: "/admin/membership/signup-link", label: "Signup Link", icon: LinkIcon, group: "Sales" },
  { to: "/admin/membership/promo-tools", label: "Promo Tools", icon: Tag, group: "Sales" },
  // MEMBERS
  { to: "/admin/members", label: "Members", icon: Users, group: "Members" },
  { to: "/admin/members?filter=incomplete", label: "Incomplete Setup", icon: ListChecks, group: "Members" },
  { to: "/admin/members?filter=no_pfp", label: "Missing Profile Pictures", icon: Camera, group: "Members" },
  { to: "/admin/members?filter=no_phone", label: "Missing Phone Numbers", icon: Phone, group: "Members" },
  { to: "/admin/members?filter=no_sms", label: "SMS Consent Missing", icon: MessageCircle, group: "Members" },
  // BILLING
  { to: "/admin/members?filter=subscriptions", label: "Subscriptions", icon: CreditCard, group: "Billing" },
  { to: "/admin/members?filter=trial", label: "Trials", icon: ListChecks, group: "Billing" },
  { to: "/admin/members?filter=past_due", label: "Past Due", icon: AlertCircle, group: "Billing" },
  { to: "/admin/members?filter=hold", label: "Hold Plan", icon: ListChecks, group: "Billing" },
  { to: "/admin/members?filter=paused", label: "Paused Members", icon: ListChecks, group: "Billing" },
  { to: "/admin/members?filter=cancelled", label: "Cancelled Members", icon: ListChecks, group: "Billing" },
  { to: "/admin/membership/stripe-sync", label: "Stripe Sync", icon: RefreshCw, group: "Billing" },
  // SETUP TOOLS
  { to: "/admin/membership/setup-links", label: "Setup Links", icon: LinkIcon, group: "Setup Tools" },
  { to: "/admin/membership/reset-links", label: "Password Reset Links", icon: KeyRound, group: "Setup Tools" },
  { to: "/admin/membership/sms-email", label: "SMS / Email Tools", icon: MessagesSquare, group: "Setup Tools" },
  { to: "/admin/membership/welcome-messages", label: "Welcome Messages", icon: Megaphone, group: "Setup Tools" },
  // CONTENT
  { to: "/admin/member-plans", label: "Member Programs", icon: BookOpen, group: "Content" },
  { to: "/admin/member-resources", label: "Member Resources", icon: FolderOpen, group: "Content" },
  { to: "/admin/recipes", label: "Member Recipes", icon: ChefHat, group: "Content" },
  { to: "/admin/events", label: "Member Events", icon: Calendar, group: "Content" },
  { to: "/admin/broadcasts", label: "Member Announcements", icon: Megaphone, group: "Content" },
  { to: "/admin/faqs", label: "Member FAQs", icon: HelpCircle, group: "Content" },
  // COMMUNITY
  { to: "/admin/messages", label: "Member Group Chats", icon: MessagesSquare, group: "Community" },
  { to: "/admin/membership/challenges", label: "Challenges", icon: Trophy, group: "Community" },
  // SETTINGS
  { to: "/admin/settings", label: "Membership Settings", icon: Settings, group: "Settings" },
  { to: "/admin/membership/access-checklist", label: "Access Checklist", icon: ShieldCheck, group: "Settings" },
  { to: "/admin/membership/refund-policy", label: "Refund / Cancellation Policy", icon: HelpCircle, group: "Settings" },
];