/**
 * After a meeting (pure, tested in meeting-intelligence.test.ts): what came
 * out of it, organized the way a coach acts on it, and what Cleo has done
 * against what still needs the coach.
 *
 *  - organizeOutcome: key coaching feedback, what the client needs to
 *    improve, agreed decisions, the client's and the coach's
 *    responsibilities, measurable objectives, concerns still open and
 *    possible programming adjustments, from Cleo's checked read, the notes
 *    and decisions taken in the meeting and the commitments kept.
 *  - recStatus: a recommendation's state in words that never claim more than
 *    happened: Suggested, Needs review, Approved (not applied yet), Applied,
 *    Kept as is, Later, Dismissed. Approving routes the change to its own
 *    editor; only that editor applying it (or the coach saying so) is Applied.
 *  - workSummary: what Cleo did, and what's waiting on the coach.
 */
import { sameIdea, type MeetingAnalysis, type AnalysisItem } from "./analysis";

export type OutcomeLine = {
  text: string;
  quote?: string | null;
  basis?: string | null;
  due?: string | null;
  source: "cleo" | "coach";
};
export type Outcome = {
  feedback: OutcomeLine[];
  improve: OutcomeLine[];
  decisions: OutcomeLine[];
  clientDoes: OutcomeLine[];
  coachDoes: OutcomeLine[];
  objectives: OutcomeLine[];
  concerns: OutcomeLine[];
  floated: OutcomeLine[];
  wins: OutcomeLine[];
};

const fromItem = (i: AnalysisItem): OutcomeLine => ({
  text: i.text,
  quote: i.quote,
  basis: i.basis,
  due: i.due,
  source: "cleo",
});

export function organizeOutcome(x: {
  analysis: MeetingAnalysis | null;
  decisions: string[];
  commitments: Array<{
    owner: "coach" | "athlete";
    text: string;
    status: string;
    confirmed?: boolean | null;
    due_on?: string | null;
    source_quote?: string | null;
  }>;
}): Outcome {
  const a = x.analysis;
  const items = a?.items ?? [];
  const of = (...k: AnalysisItem["kind"][]) =>
    items.filter((i) => k.includes(i.kind)).map(fromItem);
  const kept = x.commitments.filter((c) => c.status !== "dropped" && c.confirmed !== false);
  // one line per idea: the coach's own words win, and Cleo's quote and due date join them
  // ("Squat opener 105 kg" the coach noted and "Squat opener is locked at 105 kg" Cleo read are one decision)
  const dedupe = (rows: OutcomeLine[]) => {
    const out: OutcomeLine[] = [];
    for (const r of rows) {
      if (!r.text.trim()) continue;
      const i = out.findIndex((o) => sameIdea(o.text, r.text));
      if (i < 0) out.push({ ...r });
      else out[i] = { ...out[i], quote: out[i].quote ?? r.quote ?? null, due: out[i].due ?? r.due ?? null };
    }
    return out;
  };
  return {
    feedback: dedupe(of("feedback")),
    improve: dedupe(of("concern").filter((c) => c.basis !== "interpretation")),
    decisions: dedupe([
      ...x.decisions.map((d) => ({ text: d, source: "coach" as const })),
      ...of("agreement"),
    ]),
    clientDoes: dedupe(
      kept
        .filter((c) => c.owner === "athlete")
        .map((c) => ({
          text: c.text,
          due: c.due_on ?? null,
          quote: c.source_quote,
          source: "coach" as const,
        })),
    ),
    coachDoes: dedupe(
      kept
        .filter((c) => c.owner === "coach")
        .map((c) => ({
          text: c.text,
          due: c.due_on ?? null,
          quote: c.source_quote,
          source: "coach" as const,
        })),
    ),
    objectives: dedupe(of("objective", "goal")),
    concerns: dedupe([
      ...of("open_question"),
      ...(a?.unitChecks ?? []).map((t) => ({ text: t, source: "cleo" as const })),
    ]),
    floated: dedupe(of("tentative")),
    wins: dedupe(of("win")),
  };
}

/* ------------------------------------------------------------------ */

export type RecStatus =
  | "suggested"
  | "needs_review"
  | "approved"
  | "applied"
  | "kept"
  | "later"
  | "dismissed";
export const REC_STATUS_WORDS: Record<RecStatus, string> = {
  suggested: "Suggested",
  needs_review: "Needs review",
  approved: "Approved · not applied yet",
  applied: "Applied",
  kept: "Kept as is",
  later: "Later",
  dismissed: "Dismissed",
};

export function recStatus(r: {
  status: string;
  applied_at?: string | null;
  flags?: unknown;
  kind?: string | null;
}): RecStatus {
  const flagged = Array.isArray(r.flags) && r.flags.length > 0;
  switch (r.status) {
    case "approved":
    case "edited":
      return r.applied_at ? "applied" : "approved";
    case "kept":
      return "kept";
    case "deferred":
      return "later";
    case "rejected":
      return "dismissed";
    case "clarify":
      return "needs_review";
    default:
      return flagged ? "needs_review" : "suggested";
  }
}

/** Whether a recommendation is still the coach's to act on. */
export const recOpen = (s: RecStatus) =>
  s === "suggested" || s === "needs_review" || s === "approved";

export type WorkSummary = { did: string[]; needs: string[] };

export function workSummary(x: {
  analysisReady: boolean;
  source: "transcript" | "notes" | "recording" | null;
  recs: Array<{ status: string; applied_at?: string | null; flags?: unknown }>;
  memories: Array<{ status: string; auto_kept?: boolean | null; conflicts_with?: string | null }>;
  commitmentsProposed: number;
  recapSent: boolean;
  unitChecks: number;
  speakersToConfirm: number;
}): WorkSummary {
  const did: string[] = [];
  const needs: string[] = [];
  if (x.analysisReady)
    did.push(
      `Read the ${x.source === "recording" ? "recording" : x.source === "transcript" ? "transcript" : "notes"}`,
    );
  const statuses = x.recs.map(recStatus);
  const decide = statuses.filter((s) => s === "suggested" || s === "needs_review").length;
  // said once: while some wait on the coach, "to decide" says it
  if (x.recs.length && !decide)
    did.push(`${x.recs.length} recommendation${x.recs.length === 1 ? "" : "s"} drafted`);
  const auto = x.memories.filter((m) => m.status === "confirmed" && m.auto_kept).length;
  if (auto) did.push(`${auto} memor${auto === 1 ? "y" : "ies"} kept automatically`);
  if (decide) needs.push(`${decide} recommendation${decide === 1 ? "" : "s"} to decide`);
  const toApply = statuses.filter((s) => s === "approved").length;
  if (toApply) needs.push(`${toApply} approved, not applied yet`);
  const mem = x.memories.filter((m) => m.status === "proposed").length;
  if (mem) needs.push(`${mem} memor${mem === 1 ? "y" : "ies"} to review`);
  if (x.commitmentsProposed)
    needs.push(
      `${x.commitmentsProposed} commitment${x.commitmentsProposed === 1 ? "" : "s"} to confirm`,
    );
  if (x.unitChecks)
    needs.push(`${x.unitChecks} load${x.unitChecks === 1 ? "" : "s"} to confirm kg or lb`);
  if (x.speakersToConfirm) needs.push("Who's who in the recording");
  if (!x.recapSent && x.analysisReady) needs.push("Recap not sent (optional)");
  return { did, needs };
}
