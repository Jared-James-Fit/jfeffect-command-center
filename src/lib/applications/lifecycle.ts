/**
 * An applicant's whole path, from the application to training (Nov 25 2026):
 * New → Awaiting review → Awaiting response → Approved → Awaiting payment →
 * Onboarding → Ready to start → Active → Archived, read from what really
 * happened (the application's own fields and the athlete's record), never set
 * by hand. Pure and tested (applications-lifecycle.test.ts).
 *
 * Free membership has no payment, so it never sits in Awaiting payment; the
 * stage is there for a paid plan's checkout (`awaitingPayment`), which the
 * payments work fills in when it lands.
 */
import type { MemberApplication } from "@/lib/membership-apply";

export type LifecycleStage =
  | "new" | "awaiting_review" | "awaiting_response" | "approved" | "awaiting_payment"
  | "onboarding" | "ready" | "active" | "archived";

export const LIFECYCLE: Array<{ key: LifecycleStage; label: string }> = [
  { key: "new", label: "New" },
  { key: "awaiting_review", label: "Awaiting review" },
  { key: "awaiting_response", label: "Awaiting response" },
  { key: "approved", label: "Approved" },
  { key: "awaiting_payment", label: "Awaiting payment" },
  { key: "onboarding", label: "Onboarding" },
  { key: "ready", label: "Ready to start" },
  { key: "active", label: "Active" },
  { key: "archived", label: "Archived" },
];
export const stageLabel = (k: LifecycleStage) => LIFECYCLE.find((s) => s.key === k)!.label;

/** What the athlete's record says once they're in (the server reads it). */
export type ApplicantFacts = {
  clientId: string | null;
  /** Their setup is done (member_setup_complete's rule); null = no member record. */
  setupComplete: boolean | null;
  /** They've started a program. */
  programStarted: boolean;
  /** Their latest finished workout. */
  lastTrainedAt: string | null;
  /** Their client record is archived. */
  clientArchived: boolean;
  /** A paid plan's checkout is waiting on them (never for free membership). */
  awaitingPayment?: boolean;
};

export const NO_FACTS: ApplicantFacts = { clientId: null, setupComplete: null, programStarted: false, lastTrainedAt: null, clientArchived: false };

type App = Pick<MemberApplication, "status" | "flagged" | "contact_status" | "activated_at" | "existing_account" | "client_id"> & {
  archived_at?: string | null;
};

export function lifecycleStage(a: App, f: ApplicantFacts = NO_FACTS): LifecycleStage {
  if (a.archived_at || a.status === "declined" || f.clientArchived) return "archived";
  if (a.status === "pending") {
    if (a.contact_status === "messaged") return "awaiting_response";
    if (a.flagged || a.contact_status === "talking") return "awaiting_review";
    return "new";
  }
  // approved
  const inApp = !!a.activated_at || (a.existing_account && !!(f.clientId ?? a.client_id));
  if (!inApp) return f.awaitingPayment ? "awaiting_payment" : "approved";
  if (f.awaitingPayment) return "awaiting_payment";
  if (f.lastTrainedAt) return "active";
  if (f.setupComplete === false) return "onboarding";
  return "ready";
}

/** Which list an applicant sits in on the Applications screen. */
export function lifecycleGroup(s: LifecycleStage): "waiting" | "invited" | "starting" | "earlier" {
  if (s === "new" || s === "awaiting_review" || s === "awaiting_response") return "waiting";
  if (s === "approved" || s === "awaiting_payment") return "invited";
  if (s === "onboarding" || s === "ready") return "starting";
  return "earlier";
}

const DAY = 86_400_000;
const daysSince = (iso: string | null | undefined, now: number) => (iso ? Math.floor((now - Date.parse(iso)) / DAY) : null);

/**
 * Cleo's read of an applicant: what's missing and what to watch, from their
 * answers and what happened since (code, never a model: nothing invented).
 */
export function applicantConcerns(
  a: Pick<MemberApplication, "status" | "contact_method" | "phone" | "instagram" | "coaching_interest" | "flagged" | "contacted_at" | "contact_status" | "decided_at" | "invite_sent_at" | "invite_count" | "activated_at" | "created_at" | "existing_account" | "client_id"> & { archived_at?: string | null },
  f: ApplicantFacts = NO_FACTS,
  now = Date.now(),
): string[] {
  const out: string[] = [];
  const stage = lifecycleStage(a, f);
  if (stage === "archived") return out;
  if (a.contact_method === "text" && !a.phone) out.push("Asked to be texted but left no phone number: reach them by email.");
  if (a.contact_method === "instagram" && !a.instagram) out.push("Asked for an Instagram DM but left no handle: reach them by email.");
  if (a.coaching_interest === "yes") out.push("Wants coaching: offer the discovery call when you say hi.");
  if (a.flagged) out.push("You flagged this one for a closer look.");
  const waited = daysSince(a.created_at, now);
  if (stage === "new" && waited !== null && waited >= 1) out.push(`Applied ${waited} day${waited === 1 ? "" : "s"} ago and nobody has said hi yet.`);
  const quiet = daysSince(a.contacted_at, now);
  if (stage === "awaiting_response" && quiet !== null && quiet >= 3) out.push(`No reply ${quiet} days after your message: one follow-up, or approve them anyway.`);
  const invited = daysSince(a.invite_sent_at ?? a.decided_at, now);
  if (stage === "approved" && invited !== null && invited >= 2) out.push(`Approved ${invited} days ago and not in yet${(a.invite_count ?? 0) > 1 ? ` (${a.invite_count} invites sent)` : ""}: resend or DM the link.`);
  const joined = daysSince(a.activated_at, now);
  if (stage === "onboarding" && joined !== null && joined >= 1) out.push("Joined but hasn't picked their training days: setup is one step.");
  if (stage === "ready" && !f.programStarted && joined !== null && joined >= 2) out.push("In the app with no program yet: point them to a plan for their goal.");
  if (stage === "ready" && f.programStarted && joined !== null && joined >= 7) out.push("Started a program but no finished workout in their first week.");
  return out;
}

export type ApplicantAction = "approve" | "message" | "resend" | "review_intake" | "start_onboarding" | "archive" | "unarchive" | "open_client";

/** The quick actions that make sense where they are (never one that can't do anything). */
export function applicantActions(a: App & { status: MemberApplication["status"] }, f: ApplicantFacts = NO_FACTS): ApplicantAction[] {
  const stage = lifecycleStage(a, f);
  const clientId = f.clientId ?? a.client_id;
  const out: ApplicantAction[] = [];
  if (stage === "archived") return a.archived_at ? ["unarchive", ...(clientId ? (["open_client"] as const) : [])] : clientId ? ["open_client"] : [];
  if (a.status === "pending") out.push("approve");
  if (clientId) out.push("message");
  if (stage === "approved") out.push("resend");
  if (clientId) out.push("review_intake");
  if (stage === "onboarding") out.push("start_onboarding");
  out.push("archive");
  if (clientId) out.push("open_client");
  return out;
}
