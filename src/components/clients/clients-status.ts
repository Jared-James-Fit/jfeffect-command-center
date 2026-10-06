import {
  AlertCircle,
  ClipboardCheck,
  CalendarClock,
  CreditCard,
  Wallet,
  Dumbbell,
  Apple,
  HeartPulse,
  UserRoundCog,
  UserPlus,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import type { DirectoryNextAction, DirectoryRow } from "@/lib/clients-directory.functions";

export type StatusKey =
  | "all"
  | "needs_setup"
  | "needs_review"
  | "program_ending"
  | "payment_issues"
  | "no_payment"
  | "new_clients"
  | "missed_workouts"
  | "inactive";

export const STATUS_META: Record<
  StatusKey,
  { label: string; icon: LucideIcon; tone: "neutral" | "warn" | "danger" | "ok" | "info"; hint?: string }
> = {
  all:              { label: "All Clients",       icon: Users,           tone: "neutral" },
  needs_setup:      { label: "Needs Setup",       icon: UserRoundCog,    tone: "info",   hint: "Clients who haven't signed in to their account yet (invite or password reset still pending)." },
  needs_review:     { label: "Needs Review",      icon: ClipboardCheck,  tone: "warn",   hint: "Clients who submitted a check-in that's waiting for you to review it." },
  program_ending:   { label: "Program Ending",    icon: CalendarClock,   tone: "warn",   hint: "Their current training block ends within 14 days and no next block is queued yet." },
  payment_issues:   { label: "Missed Payment",    icon: CreditCard,      tone: "danger", hint: "A payment failed or is overdue. Follow up so they don't lose access." },
  no_payment:       { label: "No Payment",        icon: Wallet,          tone: "danger", hint: "No active subscription or paid purchase on file. Send a payment link, or mark them 'no payment needed' from their ⋯ menu." },
  new_clients:      { label: "New Clients",       icon: UserPlus,        tone: "ok",     hint: "Clients who joined in the last 7 days." },
  missed_workouts:  { label: "Missed Workouts",   icon: XCircle,         tone: "warn",   hint: "Clients who skipped 2 or more scheduled workouts in the last 14 days." },
  inactive:         { label: "Inactive",          icon: Clock,           tone: "warn",   hint: "Clients on an active program who haven't opened the app in 7+ days." },
};

export const TONE_CLASSES: Record<string, { bg: string; text: string; ring: string; iconBg: string }> = {
  neutral: { bg: "bg-card",           text: "text-foreground",       ring: "ring-border",           iconBg: "bg-muted text-muted-foreground" },
  info:    { bg: "bg-card",           text: "text-foreground",       ring: "ring-blue-500/30",      iconBg: "bg-blue-500/15 text-blue-400" },
  warn:    { bg: "bg-card",           text: "text-foreground",       ring: "ring-amber-500/30",     iconBg: "bg-amber-500/15 text-amber-400" },
  danger:  { bg: "bg-card",           text: "text-foreground",       ring: "ring-destructive/40",   iconBg: "bg-destructive/15 text-destructive" },
  ok:      { bg: "bg-card",           text: "text-foreground",       ring: "ring-emerald-500/30",   iconBg: "bg-emerald-500/15 text-emerald-400" },
};

export type BadgeDef = { label: string; tone: "danger" | "warn" | "info" | "ok" | "muted"; icon?: LucideIcon; hint: string };

/** Up to 4 most relevant badges for a row, in priority order. Each carries a plain-English hint for hover. */
export function rowBadges(r: DirectoryRow): BadgeDef[] {
  const out: BadgeDef[] = [];
  if (r.f_payment_issue)
    out.push({ label: "Payment Issue", tone: "danger", icon: CreditCard,
      hint: "A payment failed or is overdue. Open their billing to fix it before their access is affected." });
  // Only surface "Needs Setup" when the account itself isn't activated yet
  // (invite pending, agreement pending, reset sent). Otherwise a missing
  // optional field like `preferred_training_days` would flag every client.
  const accountActivated = r.account_status === "Account Created" || r.account_status === "Active";
  if (r.f_needs_setup && !accountActivated)
    out.push({ label: "Needs Setup", tone: "info", icon: UserRoundCog,
      hint: "They haven't signed in to their account yet: the invite, agreement or password reset is still pending." });
  if (r.payment_state === "not_set_up")
    out.push({ label: "No Payment Set Up", tone: "danger", icon: Wallet,
      hint: "No active subscription or paid purchase on file. Send a payment link, or mark them 'no payment needed' from the ⋯ menu." });
  if (r.payment_state === "pending")
    out.push({ label: "Awaiting Payment", tone: "warn", icon: Clock,
      hint: "A payment link was sent but hasn't been paid yet." });
  if (r.f_needs_review)
    out.push({ label: "Review Due", tone: "warn", icon: ClipboardCheck,
      hint: "They submitted a check-in that's waiting for your review." });
  if (r.f_missed_workouts && r.missed_workouts_count > 0)
    out.push({ label: `${r.missed_workouts_count} Missed`, tone: "warn", icon: XCircle,
      hint: `${r.missed_workouts_count} scheduled workouts in the last 14 days weren't completed.` });
  if (r.f_inactive)
    out.push({ label: "Inactive", tone: "warn", icon: Clock,
      hint: "They're on an active program but haven't opened the app in 7+ days." });
  if (r.f_program_ending)
    out.push({ label: "Ending Soon", tone: "warn", icon: CalendarClock,
      hint: "Their current training block ends within 14 days and no next block is queued." });
  if (r.f_new_client && out.length < 2)
    out.push({ label: "New", tone: "ok", icon: UserPlus, hint: "Joined in the last 7 days." });
  if (out.length === 0)
    out.push({ label: "Active", tone: "ok", icon: CheckCircle2,
      hint: "All good: signed in, paid up, and nothing needs your attention right now." });
  return out.slice(0, 4);
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
    case "open": return ArrowRight;
    default: return AlertCircle;
  }
}
