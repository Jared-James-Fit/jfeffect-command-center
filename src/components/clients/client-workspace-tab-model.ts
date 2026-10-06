import {
  Apple,
  CalendarCheck,
  DollarSign,
  Dumbbell,
  FileText,
  LayoutDashboard,
  TrendingUp,
  UserRound,
} from "lucide-react";

export type WorkspaceTab =
  | "summary"
  | "training"
  | "nutrition"
  | "metrics"
  | "documents"
  | "sessions"
  | "purchases"
  | "info"
  | "goals-setup"
  | "coaching"
  | "notes"
  | "account";

/**
 * Primary bar = the work you do with a client, in the order you do it.
 * Training also holds program setup; Progress holds metrics, lift
 * analytics and lift videos; Forms holds agreements; Billing holds sales
 * and billing. Account (setup link, password reset, app access) is last on
 * the bar: it's the first thing you need when onboarding someone, and it
 * shows a dot until they're set up. Profile pages live under More.
 */
export const CLIENT_WORKSPACE_PRIMARY_TABS = [
  { value: "summary", label: "Summary", icon: LayoutDashboard },
  { value: "training", label: "Training", icon: Dumbbell },
  { value: "nutrition", label: "Nutrition", icon: Apple },
  { value: "metrics", label: "Progress", icon: TrendingUp },
  { value: "documents", label: "Forms", icon: FileText },
  { value: "sessions", label: "Sessions", icon: CalendarCheck },
  { value: "purchases", label: "Billing", icon: DollarSign },
  { value: "account", label: "Account", icon: UserRound },
] satisfies { value: WorkspaceTab; label: string; icon: typeof LayoutDashboard }[];

export const CLIENT_WORKSPACE_MORE_TABS = [
  { value: "info", label: "Client details" },
  { value: "goals-setup", label: "Goals & intake" },
  { value: "coaching", label: "Coaching setup" },
  { value: "notes", label: "Coach notes" },
] satisfies { value: WorkspaceTab; label: string }[];

/** Old tab ids → where that content lives now (links, notifications, bookmarks). */
export const LEGACY_WORKSPACE_TABS: Record<string, WorkspaceTab> = {
  "program-setup": "training",
  analytics: "metrics",
  "lift-videos": "metrics",
  agreements: "documents",
  billing: "purchases",
  profile: "info",
  cardio: "nutrition",
  messages: "summary",
};
