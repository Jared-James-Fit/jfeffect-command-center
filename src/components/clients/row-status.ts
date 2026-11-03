import type { DirectoryRow } from "@/lib/clients-directory.functions";
import { contractBadge, lastSeenChip, type ChipAction } from "./clients-status";

/**
 * What a Clients list row says about a client.
 *
 * A row shows one status chip: the single most important thing waiting on the coach. Everything
 * else that applies sits behind "+N" (tap to read it). Facts (coaching type, coach, when they were
 * last seen) are one plain line of text under the name, never chips.
 */

/** Buttons a status can offer beside its explanation. "assign_program" opens Assign program in place. */
export type RowAction = ChipAction | "assign_program";

export type RowStatusId =
  | "payment_issue"
  | "no_program"
  | "program_ended"
  | "program_ending"
  | "missed"
  | "review_due"
  | "no_payment"
  | "awaiting_payment"
  | "contract"
  | "inactive"
  | "no_account"
  | "needs_setup"
  | "never_signed_in";

export type RowStatus = {
  id: RowStatusId;
  /** Sentence case, short enough for one chip on a phone. */
  label: string;
  /** Red only for something failing or overdue; everything else that needs the coach is amber. */
  tone: "danger" | "warn";
  /** What it means, in plain English (shown on a tap). */
  hint: string;
  /** What to do about it. */
  next?: string;
  actions?: RowAction[];
};

const CONTRACT_LABEL: Record<string, string> = {
  never_signed: "Contract not signed",
  admin_request: "Re-sign requested",
  new_version: "Needs new version",
};

/**
 * Every status on this client that needs the coach, most important first:
 * a failing payment (the only red besides an ended program) · no program, or the program ended /
 * ending · missed workouts · a check-in to review · payment not set up / awaiting · the agreement ·
 * inactive · account setup (no app account, needs setup, never signed in).
 */
export function rowStatuses(r: DirectoryRow): RowStatus[] {
  const out: RowStatus[] = [];

  if (r.f_payment_issue) {
    out.push({
      id: "payment_issue", label: "Payment issue", tone: "danger",
      hint: "A payment failed or is overdue. Their access may be affected.",
      next: "Open their billing and fix it.", actions: ["billing"],
    });
  }

  // Nothing running and nothing queued: no block at all, or the last one finished.
  if (r.f_missing_program && !r.block_id) {
    out.push({
      id: "no_program", label: "No program", tone: "warn",
      hint: "No training program is running or queued, so they have no workouts.",
      next: "Assign one so they have workouts to do.", actions: ["assign_program"],
    });
  } else if (r.f_missing_program) {
    out.push({
      id: "program_ended", label: "Program ended", tone: "danger",
      hint: "Their training block has finished and nothing is queued after it, so they have no workouts.",
      next: "Assign the next block.", actions: ["assign_program"],
    });
  } else if (r.f_program_ending) {
    out.push({
      id: "program_ending", label: "Program ending", tone: "warn",
      hint: "Their training block ends within 14 days and nothing is queued after it.",
      next: "Assign the next block so they don't run out.", actions: ["assign_program"],
    });
  }

  if (r.f_missed_workouts && r.missed_workouts_count > 0) {
    out.push({
      id: "missed", label: `${r.missed_workouts_count} missed workouts`, tone: "warn",
      hint: `${r.missed_workouts_count} scheduled workouts in the last 14 days weren't completed. Two or more is flagged.`,
    });
  }

  if (r.f_needs_review) {
    out.push({
      id: "review_due", label: "Check-in to review", tone: "warn",
      hint: "They sent a check-in or form that nobody has dealt with yet. It closes by itself when you reply in their chat.",
      next: "Open their chat to reply, or mark it reviewed if it's already handled.",
      actions: ["reviews", "mark_reviewed"],
    });
  }

  // A failed payment already covers "set up"; otherwise one payment status at most.
  if (!r.f_payment_issue && r.payment_state === "not_set_up") {
    out.push({
      id: "no_payment", label: "No payment set up", tone: "warn",
      hint: "No active subscription or paid purchase on file.",
      next: "Send a payment link, or mark them 'no payment needed' from the ⋯ menu.", actions: ["billing"],
    });
  } else if (!r.f_payment_issue && r.payment_state === "pending") {
    out.push({
      id: "awaiting_payment", label: "Awaiting payment", tone: "warn",
      hint: "A payment link was sent but hasn't been paid yet.",
      next: "Check their billing, or follow up with them.", actions: ["billing"],
    });
  }

  const contract = contractBadge(r);
  const contractStatus = r.coaching_agreement_status ?? null;
  if (contract && contractStatus && CONTRACT_LABEL[contractStatus]) {
    out.push({
      id: "contract", label: CONTRACT_LABEL[contractStatus], tone: "warn",
      hint: contract.hint, next: contract.next, actions: contract.actions,
    });
  }

  if (r.f_inactive) {
    out.push({
      id: "inactive", label: "Inactive", tone: "warn",
      hint: "They're on a program but haven't opened the app in 7+ days.",
    });
  }

  // Account setup: one status for the whole group, the most specific first.
  const accountActivated = r.account_status === "Account Created" || r.account_status === "Active";
  if (contract && contractStatus === "no_account") {
    out.push({
      id: "no_account", label: "No app account", tone: "warn",
      hint: contract.hint, next: contract.next, actions: ["profile"],
    });
  } else if (r.f_needs_setup && !accountActivated) {
    out.push({
      id: "needs_setup", label: "Needs setup", tone: "warn",
      hint: "They haven't signed in to their account yet. The invite or password reset is still pending.",
      next: "Open their profile and resend the invite.", actions: ["profile"],
    });
  } else if (!r.last_active_at && !r.last_login_at) {
    out.push({
      id: "never_signed_in", label: "Never signed in", tone: "warn",
      hint: "They haven't opened the app yet.",
      next: "Open their profile and resend the invite.", actions: ["profile"],
    });
  }

  return out;
}

/** The one chip a row shows, and the rest (behind "+N"). */
export function rowStatusSummary(r: DirectoryRow): { primary: RowStatus | null; more: RowStatus[] } {
  const [primary = null, ...more] = rowStatuses(r);
  return { primary, more };
}

/**
 * The plain line under the name: "In-Person Training · Coach Cole · Last seen 2 hours ago".
 * The coach is named only when there's more than one; "Never signed in" steps aside when it is
 * already the row's chip.
 */
export function rowMetaLine(r: DirectoryRow, opts: { showCoach?: boolean; primary?: RowStatus | null } = {}): string {
  const parts: string[] = [];
  if (r.coaching_type) parts.push(r.coaching_type);
  if (opts.showCoach && r.coach_name) parts.push(`Coach ${r.coach_name.trim().split(/\s+/)[0]}`);
  if (opts.primary?.id !== "never_signed_in") parts.push(shortAgo(lastSeenChip(r).label));
  return parts.join(" · ");
}

/** "Last seen about 17 hours ago" → "Last seen 17 hours ago", so the line fits a phone. */
function shortAgo(label: string): string {
  return label.replace("less than a minute ago", "just now").replace(/\b(about|almost|over) /, "");
}
