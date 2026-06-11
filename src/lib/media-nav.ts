import {
  LayoutDashboard, ListChecks, Calendar, Megaphone, Image as ImageIcon,
  Folder, Sparkles, FileText, ExternalLink, Upload, Star, UserCog,
} from "lucide-react";
import type { NavItem } from "@/components/app-shell";

export const mediaNav: NavItem[] = [
  // Overview
  { to: "/media", label: "Media Dashboard", icon: LayoutDashboard, group: "Overview" },
  { to: "/media/action-items", label: "Action Items", icon: ListChecks, group: "Overview" },
  // Planning
  { to: "/media/calendar", label: "Content Calendar", icon: Calendar, group: "Planning" },
  { to: "/media/campaigns", label: "Campaigns / Promos", icon: Sparkles, group: "Planning" },
  { to: "/media/events", label: "Events", icon: Calendar, group: "Planning" },
  // Media
  { to: "/media/inbox", label: "Media Inbox", icon: ImageIcon, group: "Media" },
  { to: "/media/archives", label: "Media Archives", icon: Folder, group: "Media" },
  { to: "/media/uploads", label: "Uploads", icon: Upload, group: "Media" },
  { to: "/media/testimonials", label: "Testimonials / Proof", icon: Star, group: "Media" },
  // Public pages
  { to: "/media/sales/membership", label: "JF Membership Page", icon: ExternalLink, group: "Public Pages" },
  { to: "/media/sales/coaching", label: "Coaching Page", icon: ExternalLink, group: "Public Pages" },
  { to: "/media/promo-links", label: "Promo Links", icon: ExternalLink, group: "Public Pages" },
  // Drafts
  { to: "/media/broadcasts", label: "Broadcast Drafts", icon: Megaphone, group: "Drafts" },
  { to: "/media/announcements", label: "Announcement Drafts", icon: FileText, group: "Drafts" },
  // Account
  { to: "/media/account", label: "Account", icon: UserCog, group: "Account" },
];