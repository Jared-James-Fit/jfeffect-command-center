/**
 * Where an assessment stands for the coach and for the athlete (pure,
 * tested). Opening an assessment is never approving it, and opening an update
 * is never acknowledging it: each is its own act with its own time and person.
 * An athlete's acknowledgment belongs to the version they acknowledged: when a
 * newer version is released, the old acknowledgment stays on the old version
 * and the athlete is asked again.
 */
import type { MilestoneKind } from "./types";

export type AssessmentRow = {
  id: string;
  kind: MilestoneKind;
  version: number;
  status: "ready" | "reviewed" | "changes_requested" | "approved" | "released" | "superseded";
  urgency: "routine" | "attention" | "urgent";
  needs_approval: boolean;
  created_at: string;
  coach_opened_at: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  released_at: string | null;
  release_kind: "approved" | "automated" | null;
  athlete_opened_at: string | null;
  athlete_acknowledged_at: string | null;
  superseded_at: string | null;
};

export type CoachState =
  | "unread"
  | "opened"
  | "reviewed"
  | "changes_requested"
  | "approved"
  | "released"
  | "superseded";

export function coachState(a: AssessmentRow): CoachState {
  if (a.status === "superseded") return "superseded";
  if (a.status === "released") return "released";
  if (a.status === "approved") return "approved";
  if (a.status === "changes_requested") return "changes_requested";
  if (a.status === "reviewed") return "reviewed";
  return a.coach_opened_at ? "opened" : "unread";
}

export const COACH_STATE_WORD: Record<CoachState, string> = {
  unread: "Ready · unread",
  opened: "Opened",
  reviewed: "Reviewed",
  changes_requested: "Changes requested",
  approved: "Approved",
  released: "Released",
  superseded: "Superseded",
};

export type AthleteState = "not_released" | "unread" | "opened" | "acknowledged" | "updated";

/** `newerReleased`: a later version of the same kind (or a confirmation after a game plan) was released. */
export function athleteState(a: AssessmentRow, newerReleased: boolean): AthleteState {
  if (!a.released_at) return "not_released";
  if (newerReleased) return "updated";
  if (a.athlete_acknowledged_at) return "acknowledged";
  return a.athlete_opened_at ? "opened" : "unread";
}

export const ATHLETE_STATE_WORD: Record<AthleteState, string> = {
  not_released: "Not released",
  unread: "Delivered · unread",
  opened: "Opened",
  acknowledged: "Acknowledged",
  updated: "Newer version sent",
};

/** The game plan and its confirmation ask the athlete to acknowledge them. */
export function needsAcknowledgment(kind: MilestoneKind): boolean {
  return kind === "game_plan" || kind === "confirm";
}

/** Released without the coach's tap: only routine updates, only when the coach turned it on. */
export function autoReleases(input: {
  kind: MilestoneKind;
  urgency: AssessmentRow["urgency"];
  needsApproval: boolean;
  policy: "approve_all" | "auto_routine";
}): boolean {
  if (input.policy !== "auto_routine" || input.needsApproval) return false;
  if (input.kind === "game_plan" || input.kind === "confirm" || input.kind === "debrief")
    return false;
  return input.urgency === "routine";
}

/** Which actions the coach has on an assessment in this state. */
export function coachActions(
  a: AssessmentRow,
): Array<"review" | "request_changes" | "approve" | "release" | "edit_athlete"> {
  if (a.status === "superseded" || a.status === "released")
    return a.status === "released" ? ["edit_athlete"] : [];
  const out: Array<"review" | "request_changes" | "approve" | "release" | "edit_athlete"> = [];
  if (a.status === "ready") out.push("review");
  out.push("request_changes", "edit_athlete");
  if (a.needs_approval && a.status !== "approved") out.push("approve");
  if (!a.needs_approval || a.status === "approved") out.push("release");
  return out;
}

/** The athlete's current plan among released versions: the latest confirmation, else the latest game plan. */
export function currentPlanId(
  rows: Array<Pick<AssessmentRow, "id" | "kind" | "released_at" | "version">>,
): string | null {
  const released = rows.filter(
    (r) => r.released_at && (r.kind === "confirm" || r.kind === "game_plan"),
  );
  released.sort(
    (a, b) =>
      (a.kind === b.kind ? b.version - a.version : a.kind === "confirm" ? -1 : 1) ||
      String(b.released_at).localeCompare(String(a.released_at)),
  );
  return released[0]?.id ?? null;
}
