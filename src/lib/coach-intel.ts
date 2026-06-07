import { supabase } from "@/integrations/supabase/client";
import { epley1RM } from "@/lib/pl-programs";

const sb = supabase as any;

export const PAIN_REGEX = /\b(pain|hurts?|hurt|sore|soreness|injury|injured|injuries|tweak(ed)?|discomfort|aching|ache|sharp pain|sciatic)\b/i;

export type IntelLabel =
  | "on_track"
  | "needs_review"
  | "needs_followup"
  | "low_compliance"
  | "pr_hit"
  | "pain_flag"
  | "event_soon"
  | "inactive";

export interface ClientIntel {
  client_id: string;
  full_name: string;
  profile_picture_url: string | null;
  assigned_coach_id: string | null;
  // program context
  prep_title: string | null;
  prep_goal_type: string | null;
  event_name: string | null;
  event_date: string | null;
  days_to_event: number | null;
  active_block_name: string | null;
  // compliance (rolling 14d window of scheduled days)
  assigned: number;
  completed: number;
  missed: number;
  compliance_pct: number | null;
  last_completed_at: string | null;
  // duration delta avg (min) — actual minus estimated, over completed days w/ both values
  duration_delta_min: number | null;
  // signals
  recent_pr_count: number;
  recent_notes: { day_title: string; note: string; date: string; source: "day" | "set"; exercise?: string | null }[];
  pain_notes: { day_title: string; note: string; date: string; source: "day" | "set"; exercise?: string | null }[];
  // labels
  labels: IntelLabel[];
}

function daysBetween(a: Date, b: Date) {
  return Math.ceil((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

/** Build dashboard intelligence for all clients the current user can read. */
export async function getCoachIntel(opts?: { coachId?: string | null }): Promise<ClientIntel[]> {
  const now = new Date();
  const windowStart = new Date(now); windowStart.setDate(now.getDate() - 14);
  const recentCutoff = new Date(now); recentCutoff.setDate(now.getDate() - 30);

  // 1. Clients (RLS already scopes to admin / assigned coach)
  let q = sb.from("clients").select("id, full_name, profile_picture_url, assigned_coach_id, archived").eq("archived", false);
  if (opts?.coachId) q = q.eq("assigned_coach_id", opts.coachId);
  const { data: clients = [] } = await q;
  const clientIds = (clients as any[]).map((c) => c.id);
  if (clientIds.length === 0) return [];

  // 2. Active preps + blocks
  const { data: preps = [] } = await sb
    .from("pl_preps").select("*")
    .in("client_id", clientIds)
    .in("status", ["Active", "Planned"]);
  const { data: blocks = [] } = await sb
    .from("pl_blocks").select("id, client_id, prep_id, name, status, weeks, updated_at")
    .in("client_id", clientIds)
    .in("status", ["Active", "Draft"]);

  // 3. Scheduled days in the last 14d (and any future scheduled in window)
  //    Pull weeks for active blocks, then days with scheduled_date >= windowStart.
  const activeBlockIds = (blocks as any[]).filter((b) => b.status === "Active").map((b) => b.id);
  let weekIds: string[] = [];
  if (activeBlockIds.length) {
    const { data: weeks = [] } = await sb.from("pl_weeks").select("id, block_id").in("block_id", activeBlockIds);
    weekIds = (weeks as any[]).map((w) => w.id);
  }
  let scheduledDays: any[] = [];
  if (weekIds.length) {
    const { data: d = [] } = await sb
      .from("pl_days")
      .select("id, week_id, title, scheduled_date, duration_estimate_min, duration_override_min, pl_weeks!inner(block_id, pl_blocks!inner(client_id))")
      .in("week_id", weekIds)
      .gte("scheduled_date", windowStart.toISOString().slice(0, 10));
    scheduledDays = d as any[];
  }

  // 4. Completions in last 30d
  const { data: completions = [] } = await sb
    .from("pl_day_completions")
    .select("id, day_id, client_id, completed_at, actual_duration_min, client_notes, pl_days(title, duration_estimate_min, duration_override_min)")
    .in("client_id", clientIds)
    .gte("completed_at", recentCutoff.toISOString());

  // 5. Recent set results for PR + pain note scanning
  const { data: results = [] } = await sb
    .from("pl_row_results")
    .select("id, client_id, actual_load, actual_reps, notes, completed_at, pl_exercise_rows(exercise_name_override, exercises(name))")
    .in("client_id", clientIds)
    .gte("completed_at", recentCutoff.toISOString());

  // 6. All-time est-1RM PR table per (client, exercise) for delta detection
  const { data: allResults = [] } = await sb
    .from("pl_row_results")
    .select("client_id, actual_load, actual_reps, completed_at, pl_exercise_rows(exercise_name_override, exercises(name))")
    .in("client_id", clientIds)
    .not("actual_load", "is", null)
    .not("actual_reps", "is", null);

  // Build PR baseline = max est_1rm per (client, exercise) using rows OLDER than recentCutoff
  const baseline = new Map<string, number>();
  for (const r of allResults as any[]) {
    const ex = r.pl_exercise_rows?.exercises?.name ?? r.pl_exercise_rows?.exercise_name_override ?? "?";
    const key = `${r.client_id}::${ex}`;
    const date = r.completed_at ? new Date(r.completed_at) : null;
    if (!date || date >= recentCutoff) continue;
    const est = epley1RM(Number(r.actual_load) || 0, Number(r.actual_reps) || 0);
    if (est > (baseline.get(key) ?? 0)) baseline.set(key, est);
  }

  // Assemble per-client intel
  return (clients as any[]).map((c) => {
    const prep = (preps as any[]).find((p) => p.client_id === c.id && p.status === "Active")
      ?? (preps as any[]).find((p) => p.client_id === c.id);
    const activeBlock = (blocks as any[]).find((b) => b.client_id === c.id && b.status === "Active");

    // Compliance: scheduled days <= today (within window) vs completions in same set
    const today = new Date().toISOString().slice(0, 10);
    const mySchedDays = scheduledDays.filter((d) => d.pl_weeks?.pl_blocks?.client_id === c.id);
    const dueDays = mySchedDays.filter((d) => (d.scheduled_date ?? "") <= today);
    const myComp = (completions as any[]).filter((cm) => cm.client_id === c.id);
    const completedSchedIds = new Set(myComp.map((cm) => cm.day_id));
    const completed = dueDays.filter((d) => completedSchedIds.has(d.id)).length;
    const assigned = dueDays.length;
    const missed = Math.max(0, assigned - completed);
    const compliance_pct = assigned > 0 ? Math.round((completed / assigned) * 100) : null;

    const last = myComp.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))[0];

    // duration delta avg
    const deltas: number[] = [];
    for (const cm of myComp) {
      const planned = cm.pl_days?.duration_override_min ?? cm.pl_days?.duration_estimate_min;
      if (cm.actual_duration_min && planned) deltas.push(cm.actual_duration_min - planned);
    }
    const duration_delta_min = deltas.length ? Math.round(deltas.reduce((s, v) => s + v, 0) / deltas.length) : null;

    // PR detection in last 30d
    const myResults = (results as any[]).filter((r) => r.client_id === c.id);
    let prCount = 0;
    for (const r of myResults) {
      const load = Number(r.actual_load) || 0;
      const reps = Number(r.actual_reps) || 0;
      if (!load || !reps) continue;
      const ex = r.pl_exercise_rows?.exercises?.name ?? r.pl_exercise_rows?.exercise_name_override ?? "?";
      const key = `${c.id}::${ex}`;
      const est = epley1RM(load, reps);
      const base = baseline.get(key) ?? 0;
      if (base > 0 && est > base) {
        prCount++;
        baseline.set(key, est); // don't double-count subsequent same-PR rows
      }
    }

    // Notes (last 14d)
    const recent_notes: ClientIntel["recent_notes"] = [];
    const pain_notes: ClientIntel["pain_notes"] = [];
    for (const cm of myComp) {
      if (!cm.client_notes) continue;
      const dateStr = cm.completed_at ?? "";
      if (new Date(dateStr) < windowStart) continue;
      const entry = { day_title: cm.pl_days?.title ?? "Workout", note: cm.client_notes, date: dateStr, source: "day" as const };
      recent_notes.push(entry);
      if (PAIN_REGEX.test(cm.client_notes)) pain_notes.push(entry);
    }
    for (const r of myResults) {
      if (!r.notes) continue;
      const dateStr = r.completed_at ?? "";
      if (new Date(dateStr) < windowStart) continue;
      const ex = r.pl_exercise_rows?.exercises?.name ?? r.pl_exercise_rows?.exercise_name_override ?? null;
      const entry = { day_title: "Set note", note: r.notes, date: dateStr, source: "set" as const, exercise: ex };
      recent_notes.push(entry);
      if (PAIN_REGEX.test(r.notes)) pain_notes.push(entry);
    }
    recent_notes.sort((a, b) => b.date.localeCompare(a.date));

    // Labels
    const labels: IntelLabel[] = [];
    const daysToEvent = prep?.event_date ? daysBetween(new Date(prep.event_date + "T00:00:00"), new Date()) : null;
    if (daysToEvent != null && daysToEvent >= 0 && daysToEvent <= 21) labels.push("event_soon");
    if (pain_notes.length > 0) labels.push("pain_flag");
    if (prCount > 0) labels.push("pr_hit");
    if (compliance_pct != null && compliance_pct < 60) labels.push("low_compliance");
    if (missed >= 2) labels.push("needs_followup");
    if (recent_notes.length > 0 && pain_notes.length === 0) labels.push("needs_review");
    const lastDate = last?.completed_at ? new Date(last.completed_at) : null;
    const inactiveDays = lastDate ? Math.floor((Date.now() - lastDate.getTime()) / 86400000) : 999;
    if (assigned > 0 && inactiveDays >= 10) labels.push("inactive");
    if (labels.length === 0 && assigned > 0 && completed > 0) labels.push("on_track");

    return {
      client_id: c.id,
      full_name: c.full_name ?? "Unnamed",
      profile_picture_url: c.profile_picture_url ?? null,
      assigned_coach_id: c.assigned_coach_id ?? null,
      prep_title: prep?.title ?? null,
      prep_goal_type: prep?.goal_type ?? null,
      event_name: prep?.event_name ?? null,
      event_date: prep?.event_date ?? null,
      days_to_event: daysToEvent,
      active_block_name: activeBlock?.name ?? null,
      assigned,
      completed,
      missed,
      compliance_pct,
      last_completed_at: last?.completed_at ?? null,
      duration_delta_min,
      recent_pr_count: prCount,
      recent_notes: recent_notes.slice(0, 5),
      pain_notes,
      labels,
    };
  });
}

export const LABEL_META: Record<IntelLabel, { label: string; cls: string }> = {
  on_track:        { label: "On Track",        cls: "border-green-500/30 bg-green-500/10 text-green-500" },
  needs_review:    { label: "Needs Review",    cls: "border-blue-500/30 bg-blue-500/10 text-blue-400" },
  needs_followup:  { label: "Needs Follow-Up", cls: "border-amber-500/30 bg-amber-500/10 text-amber-400" },
  low_compliance:  { label: "Low Compliance",  cls: "border-orange-500/30 bg-orange-500/10 text-orange-400" },
  pr_hit:          { label: "PR Hit",          cls: "border-violet-500/30 bg-violet-500/10 text-violet-400" },
  pain_flag:       { label: "Pain Flag",       cls: "border-red-500/30 bg-red-500/10 text-red-400" },
  event_soon:      { label: "Event Soon",      cls: "border-primary/30 bg-primary/10 text-primary" },
  inactive:        { label: "Inactive",        cls: "border-muted-foreground/30 bg-muted text-muted-foreground" },
};

export type FilterKey = "all" | "attention" | "pr" | "missed" | "pain" | "event" | "low_comp";

export function filterIntel(items: ClientIntel[], key: FilterKey): ClientIntel[] {
  switch (key) {
    case "attention": return items.filter((i) => i.labels.some((l) => ["needs_followup", "low_compliance", "pain_flag", "inactive", "needs_review"].includes(l)));
    case "pr":        return items.filter((i) => i.labels.includes("pr_hit"));
    case "missed":    return items.filter((i) => i.missed > 0);
    case "pain":      return items.filter((i) => i.labels.includes("pain_flag"));
    case "event":     return items.filter((i) => i.labels.includes("event_soon"));
    case "low_comp":  return items.filter((i) => i.labels.includes("low_compliance"));
    default:          return items;
  }
}

/** Per-client deep intel for the in-profile dashboard. */
export async function getClientIntel(clientId: string): Promise<ClientIntel | null> {
  const all = await getCoachIntel();
  return all.find((c) => c.client_id === clientId) ?? null;
}