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
  FileSignature,
  FileCheck2,
  FileClock,
  Hourglass,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import type { DirectoryNextAction, DirectoryRow } from "@/lib/clients-directory.functions";
import type { DirectoryFilterKey } from "@/lib/clients-directory-filters";

/** Every filter on the Clients list, plus "all". The keys are the database's (see clients-directory-filters.ts). */
export type StatusKey = "all" | DirectoryFilterKey;

/**
 * One plain-English definition per filter. `hint` is the one-line "what this finds" shown in the
 * filter sheet and under the active filters, so it says what the filter matches, not what to do.
 */
export const STATUS_META: Record<
  StatusKey,
  { label: string; icon: LucideIcon; tone: "neutral" | "warn" | "danger" | "ok" | "info"; hint?: string }
> = {
  all:              { label: "All Clients",         icon: Users,           tone: "neutral" },
  // Missing: things the client doesn't have yet
  no_contract:      { label: "Contract Not Signed", icon: FileSignature,   tone: "danger", hint: "Hasn't signed the Coaching Agreement yet, or needs to sign it again." },
  no_payment:       { label: "No Payment",          icon: Wallet,          tone: "danger", hint: "No active subscription or paid purchase on file." },
  no_program:       { label: "No Program",          icon: Dumbbell,        tone: "warn",   hint: "Nothing running and nothing queued. They need a training block." },
  no_nutrition:     { label: "No Nutrition",        icon: Apple,           tone: "warn",   hint: "No active nutrition plan." },
  no_cardio:        { label: "No Cardio",           icon: HeartPulse,      tone: "warn",   hint: "No active cardio plan." },
  // Needs attention
  payment_issues:   { label: "Payment Issue",       icon: CreditCard,      tone: "danger", hint: "A payment failed or is overdue." },
  payment_pending:  { label: "Awaiting Payment",    icon: Hourglass,       tone: "warn",   hint: "A payment link was sent but hasn't been paid yet." },
  needs_review:     { label: "Review Due",          icon: ClipboardCheck,  tone: "warn",   hint: "Submitted a check-in that's waiting for your review." },
  missed_workouts:  { label: "Missed Workouts",     icon: XCircle,         tone: "warn",   hint: "Skipped 2 or more scheduled workouts in the last 14 days." },
  inactive:         { label: "Inactive",            icon: Clock,           tone: "warn",   hint: "On a program but hasn't opened the app in 7+ days." },
  program_ending:   { label: "Program Ending",      icon: CalendarClock,   tone: "warn",   hint: "Training block ends within 14 days and no next block is queued." },
  // Account
  needs_setup:      { label: "Needs Setup",         icon: UserRoundCog,    tone: "info",   hint: "Hasn't signed in to their account yet (invite or password reset still pending)." },
  new_clients:      { label: "New Clients",         icon: UserPlus,        tone: "ok",     hint: "Joined in the last 7 days." },
};

/** How the filters are grouped, in the order they appear in the quick row and the filter sheet. */
export const FILTER_GROUPS: {
  key: "missing" | "attention" | "account";
  label: string;
  keys: DirectoryFilterKey[];
}[] = [
  { key: "missing", label: "Missing", keys: ["no_contract", "no_payment", "no_program", "no_nutrition", "no_cardio"] },
  {
    key: "attention",
    label: "Needs attention",
    keys: ["payment_issues", "payment_pending", "needs_review", "missed_workouts", "inactive", "program_ending"],
  },
  { key: "account", label: "Account", keys: ["needs_setup", "new_clients"] },
];

export const TONE_CLASSES: Record<string, { bg: string; text: string; ring: string; iconBg: string }> = {
  neutral: { bg: "bg-card",           text: "text-foreground",       ring: "ring-border",           iconBg: "bg-muted text-muted-foreground" },
  info:    { bg: "bg-card",           text: "text-foreground",       ring: "ring-blue-500/30",      iconBg: "bg-blue-500/15 text-blue-400" },
  warn:    { bg: "bg-card",           text: "text-foreground",       ring: "ring-amber-500/30",     iconBg: "bg-amber-500/15 text-amber-400" },
  danger:  { bg: "bg-card",           text: "text-foreground",       ring: "ring-destructive/40",   iconBg: "bg-destructive/15 text-destructive" },
  ok:      { bg: "bg-card",           text: "text-foreground",       ring: "ring-emerald-500/30",   iconBg: "bg-emerald-500/15 text-emerald-400" },
};

/** Buttons a status can offer next to its explanation; the row decides how each one works. */
export type ChipAction = "billing" | "profile" | "reviews" | "program" | "agreement" | "remind";

export type BadgeDef = {
  label: string;
  tone: "danger" | "warn" | "info" | "ok" | "muted";
  icon?: LucideIcon;
  /** What it means, in plain English. Shown when the status is tapped (or hovered on a computer). */
  hint: string;
  /** What to do about it, when there is something to do. */
  next?: string;
  actions?: ChipAction[];
};

/** Hasn't signed (or must sign again) and isn't exempt: this client still has something to do. */
function owesContract(r: DirectoryRow): boolean {
  return !!r.f_no_contract;
}

/** Up to 4 most relevant badges for a row, in priority order. Each carries a plain-English hint. */
export function rowBadges(r: DirectoryRow): BadgeDef[] {
  const out: BadgeDef[] = [];
  if (r.f_payment_issue)
    out.push({ label: "Payment Issue", tone: "danger", icon: CreditCard,
      hint: "A payment failed or is overdue. Their access may be affected.",
      next: "Open their billing and fix it.", actions: ["billing"] });
  // Only surface "Needs Setup" when the account itself isn't activated yet
  // (invite pending, reset sent). Otherwise a missing optional field like
  // `preferred_training_days` would flag every client.
  const accountActivated = r.account_status === "Account Created" || r.account_status === "Active";
  if (r.f_needs_setup && !accountActivated)
    out.push({ label: "Needs Setup", tone: "info", icon: UserRoundCog,
      hint: "They haven't signed in to their account yet. The invite or password reset is still pending.",
      next: "Open their profile and resend the invite.", actions: ["profile"] });
  if (r.payment_state === "not_set_up")
    out.push({ label: "No Payment Set Up", tone: "danger", icon: Wallet,
      hint: "No active subscription or paid purchase on file.",
      next: "Send a payment link, or mark them 'no payment needed' from the ⋯ menu.", actions: ["billing"] });
  if (r.payment_state === "pending")
    out.push({ label: "Awaiting Payment", tone: "warn", icon: Clock,
      hint: "A payment link was sent but hasn't been paid yet.",
      next: "Check their billing, or follow up with them.", actions: ["billing"] });
  if (r.f_needs_review)
    out.push({ label: "Review Due", tone: "warn", icon: ClipboardCheck,
      hint: "They submitted a check-in that's waiting for your review.",
      next: "Open check-in reviews to respond.", actions: ["reviews"] });
  if (r.f_missed_workouts && r.missed_workouts_count > 0)
    out.push({ label: `${r.missed_workouts_count} Missed`, tone: "warn", icon: XCircle,
      hint: `${r.missed_workouts_count} scheduled workouts in the last 14 days weren't completed. Two or more is flagged.` });
  if (r.f_inactive)
    out.push({ label: "Inactive", tone: "warn", icon: Clock,
      hint: "They're on an active program but haven't opened the app in 7+ days." });
  if (r.f_program_ending)
    out.push({ label: "Program Ending", tone: "warn", icon: CalendarClock,
      hint: "Their current training block ends within 14 days and no next block is queued.",
      next: "Build the next block so they don't run out.", actions: ["program"] });
  if (r.f_new_client && out.length < 2)
    out.push({ label: "New", tone: "ok", icon: UserPlus, hint: "Joined in the last 7 days." });
  // "All good" would contradict an agreement that still needs signing.
  if (out.length === 0 && !owesContract(r))
    out.push({ label: "Active", tone: "ok", icon: CheckCircle2,
      hint: "All good: signed in, paid up, signed the agreement, and nothing needs your attention right now." });
  return out.slice(0, 4);
}

const day = (iso: string | null | undefined) => {
  if (!iso) return null;
  try {
    return format(parseISO(iso), "MMM d, yyyy");
  } catch {
    return null;
  }
};

const ago = (iso: string | null | undefined) => {
  if (!iso) return null;
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return null;
  }
};

/**
 * The Coaching Agreement status, shown on every client (signed or not). Null only when the row
 * has no agreement information at all (a database that predates it).
 */
export function contractBadge(r: DirectoryRow): BadgeDef | null {
  const status = r.coaching_agreement_status;
  if (!status) return null;
  const reminded = ago(r.coaching_agreement_reminded_at);
  const remindedNote = reminded ? ` Last reminded ${reminded}.` : "";
  const remind = "Remind them to open the app and sign it.";

  switch (status) {
    case "signed": {
      const on = day(r.coaching_agreement_signed_at);
      const version = r.coaching_agreement_version;
      return { label: "Contract Signed", tone: "ok", icon: FileCheck2,
        hint: `Signed the Coaching Agreement${version ? ` (version ${version})` : ""}${on ? ` on ${on}` : ""}. One signature covers everything they buy.`,
        next: "Open the Forms tab to see the signed copy.", actions: ["agreement"] };
    }
    case "never_signed":
      return { label: "Contract Not Signed", tone: "danger", icon: FileSignature,
        hint: `Hasn't signed the Coaching Agreement yet. They see it as a popup each time they open the app until they do.${remindedNote}`,
        next: remind, actions: ["remind", "agreement"] };
    case "admin_request": {
      const on = day(r.coaching_agreement_requested_at);
      return { label: "Re-Sign Requested", tone: "warn", icon: FileClock,
        hint: `They were asked to sign the Coaching Agreement again${on ? ` (${on})` : ""} and haven't yet. They see it each time they open the app.${remindedNote}`,
        next: remind, actions: ["remind", "agreement"] };
    }
    case "new_version": {
      const version = r.coaching_agreement_version;
      return { label: "Needs New Version", tone: "warn", icon: FileClock,
        hint: `They signed an older Coaching Agreement${version ? ` (version ${version})` : ""}. They need to sign the updated one.${remindedNote}`,
        next: remind, actions: ["remind", "agreement"] };
    }
    case "exempt":
      return r.coaching_agreement_exempt_kind === "offline_signed"
        ? { label: "Signed On Paper", tone: "muted", icon: FileCheck2,
            hint: "Marked as signed on paper, so the app won't ask them to sign.",
            next: "Open the Forms tab to change this.", actions: ["agreement"] }
        : { label: "Contract Not Required", tone: "muted", icon: FileSignature,
            hint: "Marked as not needing to sign (staff, a test account, family), so the app won't ask them to.",
            next: "Open the Forms tab to change this.", actions: ["agreement"] };
    case "no_account":
      return { label: "No App Account", tone: "muted", icon: Smartphone,
        hint: "They haven't created their app account yet, so they can't sign the Coaching Agreement. They'll be asked as soon as they sign in.",
        next: "Send their invite from their profile.", actions: ["profile"] };
  }
}

/** Everything the status row shows: the priority badges, then the contract (always, when known). */
export function rowStatusChips(r: DirectoryRow): BadgeDef[] {
  const contract = contractBadge(r);
  return contract ? [...rowBadges(r), contract] : rowBadges(r);
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
