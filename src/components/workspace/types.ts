import type { ComponentType, ReactNode } from "react";

export type WorkspaceTone = "default" | "primary" | "warn" | "rose" | "success";

export type WorkspaceAction = {
  /** Stable key for React and dedup. */
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Either onClick OR a router link (to + optional params). */
  onClick?: () => void | Promise<void>;
  to?: string;
  params?: Record<string, string>;
  tone?: WorkspaceTone;
  disabled?: boolean;
  /** When true the action is filtered out (convenience so caller can build one array). */
  hidden?: boolean;
  ariaLabel?: string;
};

export type WorkspaceAlert = {
  key: string;
  tone: Exclude<WorkspaceTone, "default"> | "info";
  message: ReactNode;
  description?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  action?: { label: string; onClick?: () => void; to?: string; params?: Record<string, string> };
};

export type WorkspaceIdentity = {
  avatarUrl?: string | null;
  name: string;
  /** Small pill-style badges rendered under the name. */
  badges?: { label: string; tone?: WorkspaceTone }[];
  /** Short meta chips: "Coach Jane · Package · Active 2d ago". */
  meta?: ReactNode[];
  /** Optional slot after the name (e.g. PowerlifterBadge). */
  titleAfter?: ReactNode;
};