import { supabase } from "@/integrations/supabase/client";
import { epley1RM } from "@/lib/pl-programs";

const sb = supabase as any;

export const PAIN_KEYWORDS = [
  "pain","hurt","hurts","sore","soreness","injury","injured","injuries",
  "tweak","tweaked","discomfort","aching","ache","sharp","sciatic",
  "tight","tightness","strain","strained","pinch","pinched","numb","numbness",
] as const;
export const PAIN_REGEX = new RegExp(`\\b(${PAIN_KEYWORDS.join("|")})\\b`, "ig");

export function extractPainKeywords(text: string): string[] {
  const m = text.match(PAIN_REGEX);
  if (!m) return [];
  return Array.from(new Set(m.map((s) => s.toLowerCase())));
}

export type IntelLabel =
  | "on_track" | "needs_review" | "needs_followup" | "low_compliance"
  | "pr_hit" | "pain_flag" | "event_soon" | "inactive";

export type PainStatus = "new" | "reviewed" | "followup" | "resolved" | "dismissed";
export type FollowupStatus = "open" | "completed" | "dismissed";

export interface PainFlag {
  id: string; client_id: string; source: "day" | "set"; source_id: string;
  note_text: string; matched_keywords: string[]; status: PainStatus;
  day_title: string | null; exercise: string | null; note_date: string | null;
  status_note: string | null; updated_at: string;
}
export interface Followup {
  id: string; client_id: string; reason: string; source: string | null;
  due_date: string | null; status: FollowupStatus; notes: string | null;
  created_at: string; completed_at: string | null;
}
export interface MissedDay { day_id: string; title: string; scheduled_date: string; alert_key: string; }
export interface PrEvent {
  client_id: string; exercise: string; est_1rm: number; baseline: number;
  actual_load: number; actual_reps: number; date: string; result_id: string;
  day_id: string | null; alert_key: string;
}
export interface NoteEntry {
  day_title: string; note: string; date: string; source: "day" | "set"; source_id: string;
  exercise?: string | null; day_id?: string | null; alert_key: string;
}

export interface ClientIntel {
  client_id: string;
  full_name: string;
  profile_picture_url: string | null;
  assigned_coach_id: string | null;
  prep_title: string | null;
  prep_goal_type: string | null;
  event_name: string | null;
  event_date: string | null;
  days_to_event: number | null;
  active_block_name: string | null;
  assigned: number;
  completed: number;
  missed: number;
  compliance_pct: number | null;
  last_completed_at: string | null;
  duration_delta_min: number | null;
  recent_pr_count: number;
  recent_prs: PrEvent[];
  recent_notes: NoteEntry[];
  missed_days: MissedDay[];
  pain_flags: PainFlag[];
  open_followups: Followup[];
  last_reviewed_at: string | null;
  labels: IntelLabel[];
}

function daysBetween(a: Date, b: Date) {
  return Math.ceil((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}
function exerciseOf(r: any): string {
  return r?.pl_exercise_rows?.exercises?.name
    ?? r?.pl_exercise_rows?.exercise_name_override
    ?? "Unknown";
}

export async function getCoachIntel(opts?: { coachId?: string | null }): Promise<ClientIntel[]> {
  const now = new Date();
  const windowStart = new Date(now); windowStart.setDate(now.getDate() - 14);
  const recentCutoff = new Date(now); recentCutoff.setDate(now.getDate() - 30);

  let q = sb.from("clients").select("id, full_name, profile_picture_url, assigned_coach_id, archived").eq("archived", false);
  if (opts?.coachId) q = q.eq("assigned_coach_id", opts.coachId);
  const { data: clients = [] } = await q;
  const clientIds = (clients as any[]).map((c) => c.id);
  if (clientIds.length === 0) return [];

  const { data: preps = [] } = await sb.from("pl_preps").select("*").in("client_id", clientIds).in("status", ["Active", "Planned"]);
  const { data: blocks = [] } = await sb.from("pl_blocks").select("id, client_id, prep_id, name, status, weeks, updated_at").in("client_id", clientIds).in("status", ["Active", "Draft"]);

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

  const { data: completions = [] } = await sb
    .from("pl_day_completions")
    .select("id, day_id, client_id, completed_at, actual_duration_min, client_notes, pl_days(title, duration_estimate_min, duration_override_min)")
    .in("client_id", clientIds)
    .gte("completed_at", recentCutoff.toISOString());

  const { data: results = [] } = await sb
    .from("pl_row_results")
    .select("id, client_id, actual_load, actual_reps, notes, completed_at, pl_exercise_rows(day_id, exercise_name_override, exercises(name))")
    .in("client_id", clientIds)
    .gte("completed_at", recentCutoff.toISOString());

  const { data: allResults = [] } = await sb
    .from("pl_row_results")
    .select("client_id, actual_load, actual_reps, completed_at, pl_exercise_rows(exercise_name_override, exercises(name))")
    .in("client_id", clientIds)
    .not("actual_load", "is", null)
    .not("actual_reps", "is", null);

  const baseline = new Map<string, number>();
  for (const r of allResults as any[]) {
    const ex = exerciseOf(r);
    const key = `${r.client_id}::${ex}`;
    const date = r.completed_at ? new Date(r.completed_at) : null;
    if (!date || date >= recentCutoff) continue;
    const est = epley1RM(Number(r.actual_load) || 0, Number(r.actual_reps) || 0);
    if (est > (baseline.get(key) ?? 0)) baseline.set(key, est);
  }

  const [{ data: painRows = [] }, { data: reviewRows = [] }, { data: followupRows = [] }] = await Promise.all([
    sb.from("coach_pain_flags").select("*").in("client_id", clientIds),
    sb.from("coach_intel_reviews").select("*").in("client_id", clientIds),
    sb.from("coach_followups").select("*").in("client_id", clientIds),
  ]);
  const painByKey = new Map<string, any>();
  for (const p of painRows as any[]) painByKey.set(`${p.client_id}::${p.source}::${p.source_id}`, p);
  const reviewedKeys = new Set<string>((reviewRows as any[]).map((r) => `${r.client_id}::${r.alert_key}`));
  const lastReviewedByClient = new Map<string, string>();
  for (const r of reviewRows as any[]) {
    const cur = lastReviewedByClient.get(r.client_id);
    if (!cur || r.reviewed_at > cur) lastReviewedByClient.set(r.client_id, r.reviewed_at);
  }

  // Auto-upsert pain flags for newly detected notes
  const toUpsert: any[] = [];
  const seen = new Set<string>();
  const consider = (clientId: string, source: "day"|"set", source_id: string, note: string, day_title: string | null, exercise: string | null, date: string | null) => {
    const kws = extractPainKeywords(note);
    if (kws.length === 0) return;
    const key = `${clientId}::${source}::${source_id}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (painByKey.has(key)) return;
    toUpsert.push({ client_id: clientId, source, source_id, note_text: note, matched_keywords: kws, day_title, exercise, note_date: date });
  };
  for (const cm of completions as any[]) {
    if (cm.client_notes) consider(cm.client_id, "day", cm.id, cm.client_notes, cm.pl_days?.title ?? "Workout", null, cm.completed_at);
  }
  for (const r of results as any[]) {
    if (r.notes) consider(r.client_id, "set", r.id, r.notes, "Set note", exerciseOf(r), r.completed_at);
  }
  if (toUpsert.length) {
    const { data: inserted = [] } = await sb
      .from("coach_pain_flags")
      .upsert(toUpsert, { onConflict: "client_id,source,source_id", ignoreDuplicates: true })
      .select("*");
    for (const p of inserted as any[]) painByKey.set(`${p.client_id}::${p.source}::${p.source_id}`, p);
  }
  const allPainRowsNow = Array.from(painByKey.values());

  return (clients as any[]).map((c) => {
    const prep = (preps as any[]).find((p) => p.client_id === c.id && p.status === "Active")
      ?? (preps as any[]).find((p) => p.client_id === c.id);
    const activeBlock = (blocks as any[]).find((b) => b.client_id === c.id && b.status === "Active");

    const today = new Date().toISOString().slice(0, 10);
    const mySchedDays = scheduledDays.filter((d) => d.pl_weeks?.pl_blocks?.client_id === c.id);
    const dueDays = mySchedDays.filter((d) => (d.scheduled_date ?? "") <= today);
    const myComp = (completions as any[]).filter((cm) => cm.client_id === c.id);
    const completedSchedIds = new Set(myComp.map((cm) => cm.day_id));
    const completed = dueDays.filter((d) => completedSchedIds.has(d.id)).length;
    const assigned = dueDays.length;
    const missedAll: MissedDay[] = dueDays
      .filter((d) => !completedSchedIds.has(d.id))
      .map((d) => ({ day_id: d.id, title: d.title ?? "Workout", scheduled_date: d.scheduled_date, alert_key: `missed:${d.id}` }))
      .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));
    const missed_days = missedAll.filter((m) => !reviewedKeys.has(`${c.id}::${m.alert_key}`));
    const missed = missed_days.length;
    const compliance_pct = assigned > 0 ? Math.round((completed / assigned) * 100) : null;

    const last = myComp.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))[0];

    const deltas: number[] = [];
    for (const cm of myComp) {
      const planned = cm.pl_days?.duration_override_min ?? cm.pl_days?.duration_estimate_min;
      if (cm.actual_duration_min && planned) deltas.push(cm.actual_duration_min - planned);
    }
    const duration_delta_min = deltas.length ? Math.round(deltas.reduce((s, v) => s + v, 0) / deltas.length) : null;

    const myResults = (results as any[]).filter((r) => r.client_id === c.id);
    const localBaseline = new Map(baseline);
    const prsAll: PrEvent[] = [];
    for (const r of myResults) {
      const load = Number(r.actual_load) || 0;
      const reps = Number(r.actual_reps) || 0;
      if (!load || !reps) continue;
      const ex = exerciseOf(r);
      const key = `${c.id}::${ex}`;
      const est = epley1RM(load, reps);
      const base = localBaseline.get(key) ?? 0;
      if (base > 0 && est > base) {
        prsAll.push({
          client_id: c.id, exercise: ex, est_1rm: Math.round(est), baseline: Math.round(base),
          actual_load: load, actual_reps: reps, date: r.completed_at, result_id: r.id,
          day_id: r.pl_exercise_rows?.day_id ?? null, alert_key: `pr:${r.id}`,
        });
        localBaseline.set(key, est);
      }
    }
    const recent_prs = prsAll.filter((p) => !reviewedKeys.has(`${c.id}::${p.alert_key}`));

    const recent_notes: NoteEntry[] = [];
    for (const cm of myComp) {
      if (!cm.client_notes) continue;
      const dateStr = cm.completed_at ?? "";
      if (new Date(dateStr) < windowStart) continue;
      const alert_key = `note:day:${cm.id}`;
      if (reviewedKeys.has(`${c.id}::${alert_key}`)) continue;
      recent_notes.push({ day_title: cm.pl_days?.title ?? "Workout", note: cm.client_notes, date: dateStr, source: "day", source_id: cm.id, day_id: cm.day_id, alert_key });
    }
    for (const r of myResults) {
      if (!r.notes) continue;
      const dateStr = r.completed_at ?? "";
      if (new Date(dateStr) < windowStart) continue;
      const alert_key = `note:set:${r.id}`;
      if (reviewedKeys.has(`${c.id}::${alert_key}`)) continue;
      recent_notes.push({ day_title: "Set note", note: r.notes, date: dateStr, source: "set", source_id: r.id, exercise: exerciseOf(r), day_id: r.pl_exercise_rows?.day_id ?? null, alert_key });
    }
    recent_notes.sort((a, b) => b.date.localeCompare(a.date));

    const pain_flags: PainFlag[] = allPainRowsNow
      .filter((p: any) => p.client_id === c.id && !["resolved", "dismissed"].includes(p.status))
      .map((p: any) => p as PainFlag)
      .sort((a, b) => (b.note_date ?? "").localeCompare(a.note_date ?? ""));

    const open_followups: Followup[] = (followupRows as any[])
      .filter((f) => f.client_id === c.id && f.status === "open")
      .map((f) => f as Followup)
      .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));

    const labels: IntelLabel[] = [];
    const daysToEvent = prep?.event_date ? daysBetween(new Date(prep.event_date + "T00:00:00"), new Date()) : null;
    if (daysToEvent != null && daysToEvent >= 0 && daysToEvent <= 21) labels.push("event_soon");
    if (pain_flags.length > 0) labels.push("pain_flag");
    if (recent_prs.length > 0) labels.push("pr_hit");
    if (compliance_pct != null && compliance_pct < 60) labels.push("low_compliance");
    if (missed >= 2 || open_followups.length > 0) labels.push("needs_followup");
    if (recent_notes.length > 0 && pain_flags.length === 0) labels.push("needs_review");
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
      assigned, completed, missed, compliance_pct,
      last_completed_at: last?.completed_at ?? null,
      duration_delta_min,
      recent_pr_count: recent_prs.length,
      recent_prs,
      recent_notes: recent_notes.slice(0, 5),
      missed_days,
      pain_flags,
      open_followups,
      last_reviewed_at: lastReviewedByClient.get(c.id) ?? null,
      labels: Array.from(new Set(labels)),
    };
  });
}

export const LABEL_META: Record<IntelLabel, { label: string; cls: string }> = {
  on_track:       { label: "On Track",        cls: "border-green-500/30 bg-green-500/10 text-green-500" },
  needs_review:   { label: "Needs Review",    cls: "border-blue-500/30 bg-blue-500/10 text-blue-400" },
  needs_followup: { label: "Needs Follow-Up", cls: "border-amber-500/30 bg-amber-500/10 text-amber-400" },
  low_compliance: { label: "Low Compliance",  cls: "border-orange-500/30 bg-orange-500/10 text-orange-400" },
  pr_hit:         { label: "PR Hit",          cls: "border-violet-500/30 bg-violet-500/10 text-violet-400" },
  pain_flag:      { label: "Pain Flag",       cls: "border-red-500/30 bg-red-500/10 text-red-400" },
  event_soon:     { label: "Event Soon",      cls: "border-primary/30 bg-primary/10 text-primary" },
  inactive:       { label: "Inactive",        cls: "border-muted-foreground/30 bg-muted text-muted-foreground" },
};

export type FilterKey = "all" | "attention" | "followup" | "pr" | "missed" | "pain" | "event" | "low_comp" | "powerlifting" | "bodybuilding";

export function filterIntel(items: ClientIntel[], key: FilterKey): ClientIntel[] {
  switch (key) {
    case "attention":     return items.filter((i) => i.labels.some((l) => ["needs_followup", "low_compliance", "pain_flag", "inactive", "needs_review"].includes(l)));
    case "followup":      return items.filter((i) => i.open_followups.length > 0 || i.missed >= 2);
    case "pr":            return items.filter((i) => i.recent_prs.length > 0);
    case "missed":        return items.filter((i) => i.missed > 0);
    case "pain":          return items.filter((i) => i.pain_flags.length > 0);
    case "event":         return items.filter((i) => i.labels.includes("event_soon"));
    case "low_comp":      return items.filter((i) => i.labels.includes("low_compliance"));
    case "powerlifting":  return items.filter((i) => (i.prep_goal_type ?? "").toLowerCase().includes("power"));
    case "bodybuilding":  return items.filter((i) => /body|hyper/i.test(i.prep_goal_type ?? ""));
    default:              return items;
  }
}

export async function getClientIntel(clientId: string): Promise<ClientIntel | null> {
  const all = await getCoachIntel();
  return all.find((c) => c.client_id === clientId) ?? null;
}

/* ===================== Action helpers ===================== */

export async function markAlertReviewed(clientId: string, alertKey: string, alertKind: string, note?: string) {
  const { data: u } = await sb.auth.getUser();
  const { error } = await sb.from("coach_intel_reviews").upsert(
    { client_id: clientId, alert_key: alertKey, alert_kind: alertKind, reviewed_by: u?.user?.id ?? null, reviewed_at: new Date().toISOString(), note: note ?? null },
    { onConflict: "client_id,alert_key" }
  );
  if (error) throw error;
}

export async function unreviewAlert(clientId: string, alertKey: string) {
  const { error } = await sb.from("coach_intel_reviews").delete().eq("client_id", clientId).eq("alert_key", alertKey);
  if (error) throw error;
}

export async function markAllReviewed(clientId: string, alerts: { alert_key: string; alert_kind: string }[]) {
  if (alerts.length === 0) return;
  const { data: u } = await sb.auth.getUser();
  const rows = alerts.map((a) => ({
    client_id: clientId, alert_key: a.alert_key, alert_kind: a.alert_kind,
    reviewed_by: u?.user?.id ?? null, reviewed_at: new Date().toISOString(),
  }));
  const { error } = await sb.from("coach_intel_reviews").upsert(rows, { onConflict: "client_id,alert_key" });
  if (error) throw error;
}

export async function setPainFlagStatus(id: string, status: PainStatus, statusNote?: string) {
  const { data: u } = await sb.auth.getUser();
  const { error } = await sb.from("coach_pain_flags").update({
    status, status_note: statusNote ?? null, updated_by: u?.user?.id ?? null,
  }).eq("id", id);
  if (error) throw error;
}

export async function listFollowups(clientId?: string): Promise<Followup[]> {
  let q = sb.from("coach_followups").select("*").order("status").order("due_date", { ascending: true, nullsFirst: false });
  if (clientId) q = q.eq("client_id", clientId);
  const { data = [] } = await q;
  return data as Followup[];
}

export async function createFollowup(input: { client_id: string; reason: string; source?: string; due_date?: string | null; notes?: string | null }) {
  const { data: u } = await sb.auth.getUser();
  const { error } = await sb.from("coach_followups").insert({
    client_id: input.client_id, reason: input.reason, source: input.source ?? "manual",
    due_date: input.due_date ?? null, notes: input.notes ?? null, created_by: u?.user?.id ?? null,
  });
  if (error) throw error;
}

export async function setFollowupStatus(id: string, status: FollowupStatus) {
  const { error } = await sb.from("coach_followups").update({
    status, completed_at: status === "completed" ? new Date().toISOString() : null,
  }).eq("id", id);
  if (error) throw error;
}

export const PAIN_STATUSES: { value: PainStatus; label: string; cls: string }[] = [
  { value: "new",       label: "New",          cls: "border-red-500/30 bg-red-500/10 text-red-400" },
  { value: "reviewed",  label: "Reviewed",     cls: "border-blue-500/30 bg-blue-500/10 text-blue-400" },
  { value: "followup",  label: "Follow-Up",    cls: "border-amber-500/30 bg-amber-500/10 text-amber-400" },
  { value: "resolved",  label: "Resolved",     cls: "border-green-500/30 bg-green-500/10 text-green-500" },
  { value: "dismissed", label: "Dismissed",    cls: "border-muted-foreground/30 bg-muted text-muted-foreground" },
];
