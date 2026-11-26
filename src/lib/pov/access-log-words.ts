/**
 * The account access record in words (pure): statuses, roles, what each event was, and a
 * change's before and after values, field by field. The record itself is the database's
 * (admin_pov_events, admin_access_denials); this only reads it.
 */

export type AccessStatus = "active" | "completed" | "expired" | "interrupted" | "revoked" | "denied";

export function accessStatusWord(s: AccessStatus | string): string {
  switch (s) {
    case "active":
      return "Open now";
    case "completed":
      return "Closed";
    case "expired":
      return "Expired";
    case "interrupted":
      return "Interrupted";
    case "revoked":
      return "Access removed";
    case "denied":
      return "Refused";
    default:
      return String(s);
  }
}

export function roleWord(role: string | null | undefined): string {
  switch (role) {
    case "admin":
      return "Admin";
    case "coach":
      return "Coach";
    case "finance":
      return "Finance";
    case "client":
      return "Client or member";
    case null:
    case undefined:
    case "":
      return "Staff";
    default:
      return role.charAt(0).toUpperCase() + role.slice(1).replace(/_/g, " ");
  }
}

/** Where a refused attempt came from. */
export function sourceWord(source: string): string {
  switch (source) {
    case "view_as":
      return "View as";
    case "profile":
      return "client profile";
    case "quick_view":
      return "workout quick view";
    case "server":
      return "a staff tool";
    default:
      return source.replace(/_/g, " ");
  }
}

/** "12 min", "1h 5m", "Under a minute". */
export function durationWords(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return "Under a minute";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** The account's data, by table, in the coach's words. */
const TABLE_WORDS: Record<string, string> = {
  clients: "Profile",
  client_goals_setup: "Goals & Setup",
  client_goals: "Goals",
  client_health_items: "Health",
  client_lifestyle: "Work & lifestyle",
  athlete_competition_profiles: "Competition profile",
  athlete_equipment: "Equipment",
  athlete_exercise_setups: "Exercise setup",
  athlete_gyms: "Gyms",
  pl_row_results: "Logged set",
  pl_warmup_sets: "Warm-up",
  pl_day_completions: "Workout",
  pl_workout_feedback: "Workout review",
  pl_exercise_notes: "Exercise note",
  pl_scheduled_workouts: "Workout schedule",
  pl_client_maxes: "Maxes",
  pl_set_videos: "Set video",
  pl_blocks: "Program",
  pain_reports: "Pain report",
  cardio_completions: "Cardio",
  cardio_targets: "Cardio plan",
  messages: "Message",
  pt_sessions: "Session",
  pt_session_change_requests: "Session change request",
  session_requests: "Session request",
  nutrition_targets: "Nutrition plan",
  nf_submissions: "Form",
  messenger_checkins: "Weekly check-in",
  progress_metrics: "Progress",
  progress_submissions: "Progress check-in",
  progress_bodyweight: "Bodyweight",
  progress_water_entries: "Water",
  documents: "Document",
  competitions: "Competition",
  member_support_threads: "Support chat",
  community_posts: "Crew post",
  community_comments: "Crew comment",
  athlete_programs: "Their program",
};

export function tableWord(table: string | null | undefined): string {
  if (!table) return "Their data";
  return TABLE_WORDS[table] ?? table.replace(/_/g, " ");
}

const OP_WORDS: Record<string, string> = { insert: "added", update: "changed", delete: "removed" };

export function eventWords(e: { kind: string; detail?: Record<string, any> | null }): { title: string; detail: string | null } {
  const d = e.detail ?? {};
  switch (e.kind) {
    case "start":
      return { title: d.mode === "edit" ? "Opened with edits on" : "Opened view-only", detail: null };
    case "view":
      return { title: "Looked at", detail: typeof d.path === "string" ? d.path : null };
    case "edit_on":
      return { title: "Switched on edits", detail: null };
    case "edit_off":
      return { title: "Edits off", detail: d.why === "timed_out" ? "after 15 minutes" : null };
    case "change":
      return { title: `${tableWord(d.table)} ${OP_WORDS[d.op] ?? "changed"}`, detail: d.mode === "view" ? "while view-only" : null };
    case "write":
      return { title: "Saved", detail: typeof d.target === "string" ? d.target : null };
    case "blocked":
      return { title: "Stopped (view-only)", detail: typeof d.target === "string" ? d.target : null };
    case "end":
      return { title: "Closed", detail: d.why && d.why !== "exit" ? String(d.why).replace(/_/g, " ") : null };
    case "expired":
      return { title: "Expired", detail: "4 hours" };
    case "interrupted":
      return { title: "Interrupted", detail: "the app stopped reporting in" };
    case "revoked":
      return { title: "Access removed", detail: "the account isn't theirs any more" };
    default:
      return { title: e.kind, detail: null };
  }
}

function fieldWord(key: string): string {
  const k = key.replace(/_/g, " ").trim();
  return k.charAt(0).toUpperCase() + k.slice(1);
}

function valueWord(v: unknown): string {
  if (v === null || v === undefined) return "empty";
  if (typeof v === "string") return v === "" ? "empty" : v;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 80 ? `${s.slice(0, 77)}…` : s;
  } catch {
    return "…";
  }
}

/**
 * A change's lines: an update's fields with their before and after values; an insert's or a
 * delete's values (from null for an insert's, to "removed" for a delete's). Twelve at most.
 */
export function changeLines(detail: Record<string, any> | null | undefined): Array<{ field: string; from: string | null; to: string }> {
  const changes = detail?.changes;
  if (!changes || typeof changes !== "object") return [];
  const op = detail?.op;
  const out: Array<{ field: string; from: string | null; to: string }> = [];
  for (const [key, v] of Object.entries(changes as Record<string, any>)) {
    if (out.length >= 12) break;
    if (op === "update" && v && typeof v === "object" && ("from" in v || "to" in v)) {
      out.push({ field: fieldWord(key), from: valueWord((v as any).from), to: valueWord((v as any).to) });
    } else if (op === "delete") {
      out.push({ field: fieldWord(key), from: valueWord(v), to: "removed" });
    } else {
      out.push({ field: fieldWord(key), from: null, to: valueWord(v) });
    }
  }
  return out;
}
