import {
  AlertCircle,
  ClipboardCheck,
  CalendarClock,
  CreditCard,
  Dumbbell,
  Apple,
  HeartPulse,
  UserRoundCog,
  UserPlus,
  Users,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import type { DirectoryNextAction, DirectoryRow } from "@/lib/clients-directory.functions";

export type StatusKey =
  | "all"
  | "needs_setup"
  | "needs_review"
  | "program_ending"
  | "payment_issues"
  | "new_clients";

export const STATUS_META: Record<
  StatusKey,
  { label: string; icon: LucideIcon; tone: "neutral" | "warn" | "danger" | "ok" | "info"; hint?: string }
> = {
  all:            { label: "All Clients",     icon: Users,           tone: "neutral" },
  needs_setup:    { label: "Needs Setup",     icon: UserRoundCog,    tone: "info",   hint: "Account not yet active" },
  needs_review:   { label: "Needs Review",    icon: ClipboardCheck,  tone: "warn",   hint: "Check-in awaiting review" },
  program_ending: { label: "Program Ending",  icon: CalendarClock,   tone: "warn",   hint: "Current block ends within 14d" },
  payment_issues: { label: "Payment Issues",  icon: CreditCard,      tone: "danger", hint: "Failed or overdue payment" },
  new_clients:    { label: "New Clients",     icon: UserPlus,        tone: "ok",     hint: "Joined in last 14 days" },
};

export const TONE_CLASSES: Record<string, { bg: string; text: string; ring: string; iconBg: string }> = {
  neutral: { bg: "bg-card",           text: "text-foreground",       ring: "ring-border",           iconBg: "bg-muted text-muted-foreground" },
  info:    { bg: "bg-card",           text: "text-foreground",       ring: "ring-blue-500/30",      iconBg: "bg-blue-500/15 text-blue-400" },
  warn:    { bg: "bg-card",           text: "text-foreground",       ring: "ring-amber-500/30",     iconBg: "bg-amber-500/15 text-amber-400" },
  danger:  { bg: "bg-card",           text: "text-foreground",       ring: "ring-destructive/40",   iconBg: "bg-destructive/15 text-destructive" },
  ok:      { bg: "bg-card",           text: "text-foreground",       ring: "ring-emerald-500/30",   iconBg: "bg-emerald-500/15 text-emerald-400" },
};

export type BadgeDef = { label: string; tone: "danger" | "warn" | "info" | "ok" | "muted"; icon?: LucideIcon };

/** Up to 3 most relevant badges for a row, in priority order. */
export function rowBadges(r: DirectoryRow): BadgeDef[] {
  const out: BadgeDef[] = [];
  if (r.f_payment_issue)       out.push({ label: "Payment Issue", tone: "danger", icon: CreditCard });
  if (r.f_needs_setup)         out.push({ label: "Needs Setup",   tone: "info",   icon: UserRoundCog });
  if (r.f_needs_review)        out.push({ label: "Review Due",    tone: "warn",   icon: ClipboardCheck });
  if (r.f_program_ending)      out.push({ label: "Ending Soon",   tone: "warn",   icon: CalendarClock });
  if (r.f_missing_program)     out.push({ label: "No Program",    tone: "warn",   icon: Dumbbell });
  if (r.f_new_client && out.length < 2) out.push({ label: "New",  tone: "ok",     icon: UserPlus });
  if (r.f_missing_nutrition && out.length < 3) out.push({ label: "Nutrition Missing", tone: "muted", icon: Apple });
  if (r.f_missing_cardio && out.length < 3)    out.push({ label: "Cardio Missing",    tone: "muted", icon: HeartPulse });
  if (out.length === 0)        out.push({ label: "Active", tone: "ok", icon: CheckCircle2 });
  return out.slice(0, 3);
}

export const BADGE_TONE: Record<BadgeDef["tone"], string> = {
  danger: "bg-destructive/15 text-destructive border-destructive/30",
  warn:   "bg-amber-500/15 text-amber-400 border-amber-500/30",
  info:   "bg-blue-500/15 text-blue-400 border-blue-500/30",
  ok:     "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  muted:  "bg-muted text-muted-foreground border-border",
};

/** Next-best-action button styling — only the highest-priority one is filled. */
export function actionStyle(a: DirectoryNextAction, urgent: boolean): string {
  if (urgent && (a.kind === "payment" || a.kind === "review")) {
    return "bg-destructive text-destructive-foreground hover:bg-destructive/90";
  }
  if (a.kind === "next_phase" || a.kind === "nutrition" || a.kind === "cardio") {
    return "bg-amber-500 text-amber-950 hover:bg-amber-500/90";
  }
  if (a.kind === "open") {
    return "bg-secondary text-secondary-foreground hover:bg-secondary/80";
  }
  return "bg-primary text-primary-foreground hover:bg-primary/90";
}

export function ACTION_ICON(kind: DirectoryNextAction["kind"]): LucideIcon {
  switch (kind) {
    case "payment": return CreditCard;
    case "setup": return UserRoundCog;
    case "review": return ClipboardCheck;
    case "assign": return Dumbbell;
    case "next_phase": return CalendarClock;
    case "nutrition": return Apple;
    case "cardio": return HeartPulse;
    default: return AlertCircle;
  }
}