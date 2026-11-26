/**
 * Reads a client's pain history and the sessions around it, with whatever
 * session it's given (the caller's own login, so RLS decides; the service
 * role only after the caller was checked). Every reader goes through here so
 * the athlete's review, the coach's sheet, the dashboard, the check-in recap
 * and the training brief see the same reports.
 */
import {
  entriesFromCheckinText,
  entriesFromLegacyFeedback,
  entriesFromReports,
  localDay,
  WINDOW_DAYS,
  type PainEntry,
  type PainReportRow,
} from "@/lib/pain/history";
import type { PainSession } from "@/lib/pain/sessions";
import type { GivenSuggestion } from "@/lib/pain/recovery";

const REPORT_COLS_BASE =
  "id, client_id, feedback_id, checkin_id, day_id, reported_on, reported_at, source, region, side, severity, trigger, exercise_name, feel, impact, same_issue, change, continues_id, note";
/** With the spot, 0–10 and when it hurts (20270430091000_pain_sites.sql); the base set while that isn't in yet. */
const REPORT_COLS = `${REPORT_COLS_BASE}, site, score, timing`;

/** Did the read fail only because a newer column isn't in this database yet? */
function missingColumn(error: any): boolean {
  return error?.code === "42703" || /column .* does not exist/i.test(String(error?.message ?? ""));
}

export function daysAgo(today: string, n: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

/** Today in a client's clock. */
export function todayIn(tz?: string | null): string {
  return localDay(new Date().toISOString(), tz);
}

function chunks<T>(xs: T[], n = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/**
 * Every pain entry for these clients in the last `days` days: the structured
 * reports, plus older reviews and check-ins read as they were stored.
 */
export async function loadPainEntries(
  sb: any,
  clientIds: string[],
  opts: { days?: number; tz?: Map<string, string | null> } = {},
): Promise<Map<string, PainEntry[]>> {
  const out = new Map<string, PainEntry[]>();
  if (!clientIds.length) return out;
  const days = opts.days ?? WINDOW_DAYS + 7;
  const since = daysAgo(todayIn("America/Winnipeg"), days);
  const sinceTs = `${since}T00:00:00Z`;
  const tz = opts.tz ?? new Map<string, string | null>();
  if (!opts.tz) {
    for (const ids of chunks(clientIds)) {
      const { data } = await sb.from("clients").select("id, timezone").in("id", ids);
      for (const c of data ?? []) tz.set(c.id, c.timezone ?? null);
    }
  }

  const reports: PainReportRow[] = [];
  const feedback: any[] = [];
  const checkins: any[] = [];
  for (const ids of chunks(clientIds)) {
    const reportsQuery = (cols: string) => sb.from("pain_reports").select(cols).in("client_id", ids).gte("reported_on", since).order("reported_at", { ascending: true }).limit(2000);
    const [r0, f, c] = await Promise.all([
      reportsQuery(REPORT_COLS),
      sb
        .from("pl_workout_feedback")
        .select("id, client_id, day_id, created_at, pain_area, pain_level, client_note, pain_note, review_version")
        .in("client_id", ids)
        .eq("pain", true)
        .gte("created_at", sinceTs)
        .limit(2000),
      sb
        .from("messenger_checkins")
        .select("id, client_id, created_at, submitted_at, answers")
        .in("client_id", ids)
        .eq("task_type", "weekly_checkin")
        .eq("status", "completed")
        .gte("created_at", sinceTs)
        .contains("answers", { recovery_flags: ["Pain / injury"] })
        .limit(1000),
    ]);
    const r = r0.error && missingColumn(r0.error) ? await reportsQuery(REPORT_COLS_BASE) : r0;
    if (r.error) throw r.error;
    if (f.error) throw f.error;
    reports.push(...((r.data ?? []) as PainReportRow[]));
    feedback.push(...(f.data ?? []));
    // a check-in read is context only: never fail the history for it
    checkins.push(...(c.data ?? []));
  }

  const coveredFeedback = new Set(reports.map((r) => r.feedback_id).filter(Boolean) as string[]);
  const coveredCheckins = new Set(reports.map((r) => r.checkin_id).filter(Boolean) as string[]);
  for (const id of clientIds) {
    const zone = tz.get(id) ?? null;
    out.set(id, [
      ...entriesFromReports(reports.filter((r) => r.client_id === id)),
      ...entriesFromLegacyFeedback(feedback.filter((f) => f.client_id === id), { tz: zone, covered: coveredFeedback }),
      ...entriesFromCheckinText(
        checkins
          .filter((c) => c.client_id === id)
          .map((c) => ({ id: c.id, created_at: c.created_at, submitted_at: c.submitted_at, pain_details: c.answers?.pain_details ?? null })),
        { tz: zone, covered: coveredCheckins },
      ),
    ]);
  }
  return out;
}

/** The workouts they finished in the window: what was in each, and how it went. */
export async function loadPainSessions(sb: any, clientId: string, tz: string | null, days = WINDOW_DAYS): Promise<PainSession[]> {
  const sinceTs = `${daysAgo(todayIn(tz), days)}T00:00:00Z`;
  const { data: done, error } = await sb
    .from("pl_day_completions")
    .select("id, day_id, completed_at")
    .eq("client_id", clientId)
    .not("completed_at", "is", null)
    .gte("completed_at", sinceTs)
    .order("completed_at", { ascending: true })
    .limit(400);
  if (error) throw error;
  const completions = (done ?? []) as { id: string; day_id: string; completed_at: string }[];
  if (!completions.length) return [];
  const dayIds = [...new Set(completions.map((c) => c.day_id))];
  const names = new Map<string, string[]>();
  for (const ids of chunks(dayIds)) {
    const { data } = await sb
      .from("pl_exercise_rows")
      .select("day_id, sort_order, exercise_name_override, exercises(name)")
      .in("day_id", ids)
      .order("sort_order", { ascending: true })
      .limit(3000);
    for (const r of data ?? []) {
      const name = (r.exercise_name_override || r.exercises?.name || "").trim();
      if (!name) continue;
      const list = names.get(r.day_id) ?? [];
      list.push(name);
      names.set(r.day_id, list);
    }
  }
  // each workout's training block, for "changes across blocks" (best effort)
  const blockOfDay = new Map<string, { id: string; name: string }>();
  try {
    const weekOfDay = new Map<string, string>();
    for (const ids of chunks(dayIds)) {
      const { data } = await sb.from("pl_days").select("id, week_id").in("id", ids);
      for (const d of data ?? []) if (d.week_id) weekOfDay.set(d.id, d.week_id);
    }
    const blockOfWeek = new Map<string, string>();
    for (const ids of chunks([...new Set(weekOfDay.values())])) {
      const { data } = await sb.from("pl_weeks").select("id, block_id").in("id", ids);
      for (const w of data ?? []) if (w.block_id) blockOfWeek.set(w.id, w.block_id);
    }
    const blockName = new Map<string, string>();
    for (const ids of chunks([...new Set(blockOfWeek.values())])) {
      const { data } = await sb.from("pl_blocks").select("id, name").in("id", ids);
      for (const b of data ?? []) blockName.set(b.id, (b.name ?? "").trim() || "Block");
    }
    for (const [day, week] of weekOfDay) {
      const block = blockOfWeek.get(week);
      if (block) blockOfDay.set(day, { id: block, name: blockName.get(block) ?? "Block" });
    }
  } catch {
    // without blocks, the rest of the history reads as before
  }
  const fb = new Map<string, any>();
  for (const ids of chunks(completions.map((c) => c.id))) {
    const { data } = await sb.from("pl_workout_feedback").select("completion_id, session_rpe, review_version, sleep_bucket, recovery_today").in("completion_id", ids);
    for (const f of data ?? []) fb.set(f.completion_id, f);
  }
  return completions.map((c) => {
    const f = fb.get(c.id);
    return {
      date: localDay(c.completed_at, tz),
      dayId: c.day_id,
      block: blockOfDay.get(c.day_id) ?? null,
      exercises: names.get(c.day_id) ?? [],
      sessionRpe: f && (f.review_version ?? 0) >= 2 && f.session_rpe != null ? Number(f.session_rpe) : null,
      sleep: f?.sleep_bucket ?? null,
      energy: f?.recovery_today ?? null,
    };
  });
}

/** Recovery suggestions the coach already sent in a reply they used (not to repeat them). */
export async function loadGivenSuggestions(sb: any, clientId: string): Promise<{ given: GivenSuggestion[]; reviewedAt: string | null; draft: { text: string; at: string; through: string | null; keys: string[] } | null }> {
  const { data } = await sb
    .from("pain_coach_reviews")
    .select("kind, through_at, regions, suggestion_keys, draft, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(60);
  const rows = (data ?? []) as any[];
  const given: GivenSuggestion[] = [];
  for (const r of rows.filter((x) => x.kind === "used")) {
    for (const key of r.suggestion_keys ?? []) {
      const [k, region] = String(key).split(":");
      given.push({ key: k, region: region || null, at: r.created_at });
    }
  }
  const reviewed = rows.find((r) => r.kind === "reviewed" || r.kind === "used");
  const draft = rows.find((r) => r.kind === "draft");
  return {
    given,
    reviewedAt: reviewed ? reviewed.through_at ?? reviewed.created_at : null,
    draft: draft ? { text: draft.draft ?? "", at: draft.created_at, through: draft.through_at ?? null, keys: draft.suggestion_keys ?? [] } : null,
  };
}

/** A workout's exercises, in order, for "which exercise?". */
export async function loadDayExercises(sb: any, dayId: string): Promise<{ id: string | null; name: string }[]> {
  const { data } = await sb
    .from("pl_exercise_rows")
    .select("exercise_id, sort_order, exercise_name_override, exercises(name)")
    .eq("day_id", dayId)
    .order("sort_order", { ascending: true })
    .limit(60);
  const seen = new Set<string>();
  const out: { id: string | null; name: string }[] = [];
  for (const r of data ?? []) {
    const name = (r.exercise_name_override || r.exercises?.name || "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ id: r.exercise_id ?? null, name });
  }
  return out;
}

/**
 * What they've trained lately (the last `days` days, newest first), so a
 * description that names a lift from another day ("my hack squat") reads as
 * their own exercise. Names and ids only; best effort.
 */
export async function loadRecentExercises(sb: any, clientId: string, days = 28): Promise<{ id: string | null; name: string }[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data: done } = await sb
    .from("pl_day_completions")
    .select("day_id, completed_at")
    .eq("client_id", clientId)
    .not("completed_at", "is", null)
    .gte("completed_at", since)
    .order("completed_at", { ascending: false })
    .limit(40);
  const dayIds = [...new Set(((done ?? []) as { day_id: string }[]).map((d) => d.day_id).filter(Boolean))];
  if (!dayIds.length) return [];
  const seen = new Set<string>();
  const out: { id: string | null; name: string }[] = [];
  for (const ids of chunks(dayIds)) {
    const { data } = await sb.from("pl_exercise_rows").select("exercise_id, exercise_name_override, exercises(name)").in("day_id", ids).limit(1500);
    for (const r of data ?? []) {
      const name = (r.exercise_name_override || r.exercises?.name || "").trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ id: r.exercise_id ?? null, name });
      if (out.length >= 60) return out;
    }
  }
  return out;
}
