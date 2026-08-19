import {
  Apple,
  DollarSign,
  Dumbbell,
  FileText,
  LayoutDashboard,
  MessageSquare,
} from "lucide-react";

export type WorkspaceTab =
  | "summary"
  | "info"
  | "goals-setup"
  | "coaching"
  | "account"
  | "training"
  | "analytics"
  | "nutrition"
  | "metrics"
  | "messages"
  | "lift-videos"
  | "documents"
  | "sessions"
  | "purchases"
  | "billing"
  | "agreements"
  | "notes";

export const CLIENT_WORKSPACE_PRIMARY_TABS = [
  { value: "summary", label: "Summary", icon: LayoutDashboard },
  { value: "training", label: "Training", icon: Dumbbell },
  { value: "nutrition", label: "Nutrition", icon: Apple },
  { value: "messages", label: "Messages", icon: MessageSquare },
  { value: "documents", label: "Forms", icon: FileText },
  { value: "purchases", label: "Sales", icon: DollarSign },
] satisfies { value: WorkspaceTab; label: string; icon: typeof LayoutDashboard }[];

export const CLIENT_WORKSPACE_MORE_TABS = [
  { value: "info", label: "Client details" },
  { value: "goals-setup", label: "Goals & intake" },
  { value: "coaching", label: "Coaching setup" },
  { value: "analytics", label: "Analytics" },
  { value: "metrics", label: "Progress metrics" },
  { value: "lift-videos", label: "Lift videos" },
  { value: "sessions", label: "Sessions" },
  { value: "billing", label: "Billing" },
  { value: "agreements", label: "Agreements" },
  { value: "notes", label: "Coach notes" },
  { value: "account", label: "Login & access" },
] satisfies { value: WorkspaceTab; label: string }[];
