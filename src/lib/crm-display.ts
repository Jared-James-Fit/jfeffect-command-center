/**
 * Display-only normalization for the existing CRM.
 *
 * Nothing here writes or derives new state: it maps the canonical
 * `clients.lifecycle_stage` values and existing follow-up rows into the six
 * scan-first sales stages, and supplies the explicit fallbacks the leads list
 * and drawer render. There is exactly one current stage per lead.
 */
import { toLeadScore5, leadScoreReason } from "./lead-score-display";

export const SOURCE_UNKNOWN = "Source unknown";
export const NO_FOLLOW_UP = "No follow-up set";

export type LeadStageKey = "new" | "contacted" | "qualified" | "offer_sent" | "won" | "lost";

export const LEAD_STAGES: { key: LeadStageKey; label: string }[] = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "qualified", label: "Qualified" },
  { key: "offer_sent", label: "Offer Sent" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
];

/** Canonical lifecycle_stage → one displayed sales stage. */
const STAGE_MAP: Record<string, LeadStageKey> = {
  lead: "new",
  applicant: "new",
  new: "new",
  contacted: "contacted",
  call_booked: "contacted",
  follow_up: "contacted",
  nurture: "contacted",
  qualified: "qualified",
  offer_sent: "offer_sent",
  proposal_sent: "offer_sent",
  proposal: "offer_sent",
  won: "won",
  active_client: "won",
  lost: "lost",
  disqualified: "lost",
  churned: "lost",
};

export function leadStage(lifecycleStage: string | null | undefined): {
  key: LeadStageKey;
  label: string;
} {
  const key = STAGE_MAP[String(lifecycleStage ?? "").toLowerCase()] ?? "new";
  return { key, label: LEAD_STAGES.find((s) => s.key === key)!.label };
}

/** Won / converted leads leave the active sales board but keep their history. */
export function isClosedStage(lifecycleStage: string | null | undefined): boolean {
  const k = leadStage(lifecycleStage).key;
  return k === "won" || k === "lost";
}

export function displayLeadSource(source: string | null | undefined): string {
  const s = typeof source === "string" ? source.trim() : "";
  return s || SOURCE_UNKNOWN;
}

export function displayLeadName(row: {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}): string {
  const full = row.full_name?.trim();
  if (full) return full;
  const composed = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  if (composed) return composed;
  return row.email?.trim() || "Unnamed lead";
}

export type LeadScoreDisplay = { value: number | null; label: string; reason: string };

export function leadScoreDisplay(score: unknown, scoring?: unknown): LeadScoreDisplay {
  const value = toLeadScore5(score);
  return {
    value,
    label: value == null ? "No score" : `${value}/5`,
    reason: value == null ? "No scoring detail recorded." : leadScoreReason(scoring),
  };
}

export type FollowupLike = {
  status?: string | null;
  reason?: string | null;
  due_date?: string | null;
};

/**
 * Next action shown on the row. The internal coach_followups system wins when
 * an open follow-up exists; the legacy `next_follow_up_at` column is the
 * fallback. Never invents an action.
 */
export function nextActionDisplay(input: {
  followups?: FollowupLike[] | null;
  next_follow_up_at?: string | null;
}): { label: string; dueAt: string | null; isSet: boolean } {
  const open = (input.followups ?? [])
    .filter((f) => (f?.status ?? "open") === "open")
    .filter((f) => !!f?.due_date)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  const first = open[0];
  if (first) {
    return { label: first.reason?.trim() || "Follow up", dueAt: first.due_date ?? null, isSet: true };
  }
  const legacy = input.next_follow_up_at ?? null;
  if (legacy) return { label: "Follow up", dueAt: legacy, isSet: true };
  return { label: NO_FOLLOW_UP, dueAt: null, isSet: false };
}

/** Most recent meaningful touch: contact log wins, else application date. */
export function lastMeaningfulContact(row: {
  last_contacted_at?: string | null;
  applied_at?: string | null;
  created_at?: string | null;
}): { at: string | null; kind: "contacted" | "applied" | "none" } {
  if (row.last_contacted_at) return { at: row.last_contacted_at, kind: "contacted" };
  const applied = row.applied_at ?? row.created_at ?? null;
  if (applied) return { at: applied, kind: "applied" };
  return { at: null, kind: "none" };
}

export function stageCounts(rows: Array<{ lifecycle_stage?: string | null }>): Record<LeadStageKey, number> {
  const out: Record<LeadStageKey, number> = { new: 0, contacted: 0, qualified: 0, offer_sent: 0, won: 0, lost: 0 };
  for (const r of rows) out[leadStage(r.lifecycle_stage).key] += 1;
  return out;
}
