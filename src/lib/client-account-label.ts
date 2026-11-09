/**
 * What kind of account a client record is, as one label read from the record
 * itself, never typed by hand: the coach's header, the overlay and Coaching
 * setup all show this.
 *
 *   Lead        applied for coaching, hasn't signed in to the app yet
 *   Client      a coaching client (a lead becomes one the first time they
 *               sign in from the coach's setup link: mark_client_signed_in)
 *   Member      a free JF Effect account (self-serve, no coach)
 *   Paused / Cancelling / Deactivated / Archived
 *
 * The old hand-set statuses ("New Client", "Needs Attention", "Payment
 * Overdue", …) all read as Client: what needs attention is the Clients list's
 * own chips, worked out from the data.
 */

export type AccountKind = "lead" | "client" | "member" | "paused" | "cancelling" | "deactivated" | "archived";

export type AccountLabel = {
  kind: AccountKind;
  label: string;
  /** "warn" only for what the coach should notice (paused, cancelling). */
  tone: "default" | "warn";
  /** One plain line on what it means. */
  hint: string;
};

export type AccountLabelInput = {
  status?: string | null;
  archived?: boolean | null;
  service_tier?: string | null;
  last_signed_in_at?: string | null;
};

const LABELS: Record<AccountKind, Omit<AccountLabel, "kind">> = {
  lead: { label: "Lead", tone: "default", hint: "Applied for coaching. Becomes a client the first time they sign in from your setup link." },
  client: { label: "Client", tone: "default", hint: "A coaching client." },
  member: { label: "Member", tone: "default", hint: "A free JF Effect account: trains on their own, no coach." },
  paused: { label: "Paused", tone: "warn", hint: "Coaching is on hold." },
  cancelling: { label: "Cancelling", tone: "warn", hint: "Coaching is ending." },
  deactivated: { label: "Deactivated", tone: "default", hint: "Coaching ended. Their history is kept." },
  archived: { label: "Archived", tone: "default", hint: "Hidden from your lists." },
};

export function accountKind(c: AccountLabelInput | null | undefined): AccountKind {
  const status = (c?.status ?? "").trim().toLowerCase();
  if (c?.archived || status === "archived") return "archived";
  if (status === "deactivated") return "deactivated";
  if (c?.service_tier === "self_serve" || status === "member") return "member";
  if (status === "paused") return "paused";
  if (status === "cancelling") return "cancelling";
  // A lead who has signed in is a client, even before the record catches up.
  if (status === "lead" && !c?.last_signed_in_at) return "lead";
  return "client";
}

export function clientAccountLabel(c: AccountLabelInput | null | undefined): AccountLabel {
  const kind = accountKind(c);
  return { kind, ...LABELS[kind] };
}

/**
 * What the coach can set by hand on Coaching setup: only what can't be read
 * from the data. Deactivated and Archived have their own actions (they turn
 * portal access and lists off with them). "Active" is stored as before, so
 * every job that treats Active / New Client as a current client keeps working.
 */
export const CLIENT_STATUS_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "Lead", label: "Lead" },
  { value: "Active", label: "Client" },
  { value: "Paused", label: "Paused" },
  { value: "Cancelling", label: "Cancelling" },
];

/** The choices, plus the record's own status when it's an older one, so the picker never shows blank. */
export function statusChoicesFor(current: string | null | undefined): Array<{ value: string; label: string }> {
  const value = (current ?? "").trim();
  const known = CLIENT_STATUS_CHOICES.some((c) => c.value === value);
  if (!value || known) return [...CLIENT_STATUS_CHOICES];
  const reads = clientAccountLabel({ status: value }).label;
  return [...CLIENT_STATUS_CHOICES, { value, label: reads.toLowerCase() === value.toLowerCase() ? value : `${reads} (was "${value}")` }];
}
