/**
 * Reads what the workout plan quality score needs for one client (Nov 24
 * 2026): their current and upcoming program (the same blocks Adjust program
 * reads, every row whole, each workout's lock), the exercises' library facts,
 * their maxes, what the builder knows about them (session limit, equipment,
 * pain, what they train for), the weight-management read (experience, meet,
 * bodyweight goal, recovery flags, lower-body strength, the nutrition plan
 * against maintenance), their cardio in force, and the last four weeks of
 * workouts: planned against done, and how hard the coach-loaded sets felt.
 * Server only; the caller checks access first. Every part but the program is
 * best effort: a read that fails is left out, never guessed.
 */
import { filterPrimaryProgramBlocks } from "@/lib/at-home-backup";
import { todayInTimeZone } from "@/lib/committed-schedule-realign";
import { all, blockTypesFor, inChunks } from "@/lib/program-ai/load.server";
import { scoreProgram, type ProgramQualityContext } from "@/lib/program-quality";
import { buildMaxIndex, computeRowLoad } from "@/lib/pl-maxes";
import type { CheckExercise, CheckInput } from "@/lib/program-check";
import type { QualityScore } from "@/lib/plan-quality";

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const toFull = (days: string[] | null | undefined) => {
  const set = new Set((days ?? []).map((d) => String(d).slice(0, 3).toLowerCase()));
  return FULL.filter((d) => set.has(d.slice(0, 3).toLowerCase()));
};

async function best<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (e: any) {
    console.warn("[program-quality] optional read failed", e?.message ?? e);
    return fallback;
  }
}

const rpeNum = (v: unknown): number | null => {
  const m = /(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?/.exec(String(v ?? ""));
  return m ? Number(m[2] ?? m[1]) : null;
};

export async function programQualityFor(sb: any, clientId: string): Promise<{ quality: QualityScore | null; blockId: string | null }> {
  const { data: client, error: ce } = await sb.from("clients").select("id, committed_training_days, timezone").eq("id", clientId).maybeSingle();
  if (ce) throw new Error(ce.message);
  if (!client) throw new Error("That client wasn't found.");
  const today = todayInTimeZone(client.timezone ?? "America/Winnipeg");
  const since = addDays(today, -28);

  // their primary programs that are live or ended in the last four weeks (adherence reads those too)
  const blocks = filterPrimaryProgramBlocks(
    await all(() => sb.from("pl_blocks").select("id, name, status, client_visible, start_date, end_date, archived, source_template_block_key, created_at").eq("client_id", clientId).eq("archived", false).order("id"), "blocks"),
  ).filter((b: any) => b.status !== "Archived" && (!b.end_date || b.end_date >= since));
  blocks.sort((a: any, b: any) => (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999") || String(a.created_at).localeCompare(String(b.created_at)));
  const liveBlocks = blocks.filter((b: any) => !b.end_date || b.end_date >= today);

  const weeks = (await inChunks(blocks.map((b: any) => b.id), "weeks", (c) => sb.from("pl_weeks").select("id, block_id, week_index, phase, notes, archived, deleted_at").in("block_id", c).order("id"))).filter((w) => !w.archived && !w.deleted_at);
  const days = (
    await inChunks(weeks.map((w) => w.id), "workouts", (c) =>
      sb.from("pl_days").select("id, week_id, day_index, title, subtitle, scheduled_date, is_optional, archived, deleted_at, at_home_backup_session_key").in("week_id", c).order("id"),
    )
  ).filter((d) => !d.archived && !d.deleted_at && !d.at_home_backup_session_key);
  const dayIds = days.map((d) => d.id);
  const [rows, completions, instances] = await Promise.all([
    inChunks(dayIds, "exercises", (c) => sb.from("pl_exercise_rows").select("*").in("day_id", c).order("id")),
    inChunks(dayIds, "completions", (c) => sb.from("pl_day_completions").select("day_id, completed_at, started_at, in_progress_at, training_started_at").in("day_id", c).order("day_id")),
    inChunks(dayIds, "calendar", (c) => sb.from("pl_scheduled_workouts").select("source_day_id, scheduled_date").eq("client_id", clientId).in("source_day_id", c).order("source_day_id")),
  ]);
  const rowIds = rows.map((r) => r.id);
  const logged = await best(
    () => inChunks(rowIds, "logged sets", (c) => sb.from("pl_row_results").select("row_id, actual_rpe_num, actual_rpe, completed_at").in("row_id", c).order("row_id")),
    [] as any[],
  );

  // locks and dates, as Adjust program reads them
  const dayOfRow = new Map(rows.map((r) => [r.id, r.day_id]));
  const lock = new Map<string, "trained" | "started">();
  for (const c of completions) {
    if (c.completed_at) lock.set(c.day_id, "trained");
    else if ((c.started_at || c.in_progress_at || c.training_started_at) && lock.get(c.day_id) !== "trained") lock.set(c.day_id, "started");
  }
  for (const l of logged) {
    const d = dayOfRow.get(l.row_id);
    if (d && !lock.has(d)) lock.set(d, "started");
  }
  const dateOf = new Map<string, string>();
  for (const i of instances) {
    const prev = dateOf.get(i.source_day_id);
    if (!prev || i.scheduled_date < prev) dateOf.set(i.source_day_id, i.scheduled_date);
  }
  const dayDate = (d: any) => dateOf.get(d.id) ?? d.scheduled_date ?? null;

  // adherence: planned workouts on days that have passed in the last four weeks (optional ones never count)
  const visibleBlock = new Set(blocks.filter((b: any) => b.client_visible !== false).map((b: any) => b.id));
  const weekBlock = new Map(weeks.map((w) => [w.id, w.block_id]));
  let planned = 0;
  let done = 0;
  for (const d of days) {
    const date = dayDate(d);
    if (!date || date < since || date >= today || d.is_optional || !visibleBlock.has(weekBlock.get(d.week_id))) continue;
    if (!rows.some((r) => r.day_id === d.id)) continue;
    planned++;
    if (lock.has(d.id)) done++;
  }

  // exercises with what the checks need
  const exIds = [...new Set(rows.map((r) => r.exercise_id).filter(Boolean))] as string[];
  const exRows = await inChunks(exIds, "exercise library", (c) =>
    sb.from("exercises").select("id, name, equipment, competition_lift_type, is_competition_lift, exercise_category, movement_family, video_url, vimeo_embed_url, youtube_url").in("id", c).order("id"),
  );
  const exercises = new Map<string, CheckExercise>(exRows.map((e: any) => [e.id, e]));

  // how hard the sets the coach loaded (a % of a max or a fixed weight) felt against their RPE target
  const rowById = new Map(rows.map((r) => [r.id, r]));
  let rated = 0;
  let harder = 0;
  for (const l of logged) {
    if (!l.completed_at || String(l.completed_at).slice(0, 10) < since) continue;
    const r = rowById.get(l.row_id);
    if (!r) continue;
    const coachLoad = (r.percentage != null && ["training_max", "1rm", "est_1rm"].includes(String(r.percentage_basis ?? ""))) || r.load_kg != null || r.load_lb != null;
    const target = rpeNum(r.rpe);
    const actual = l.actual_rpe_num != null ? Number(l.actual_rpe_num) : rpeNum(l.actual_rpe);
    if (!coachLoad || target == null || actual == null || !Number.isFinite(actual)) continue;
    rated++;
    if (actual >= target + 1.5) harder++;
  }

  // the program as Program Check reads it: the live blocks, every workout's lock
  const typed = await best(() => blockTypesFor(sb, liveBlocks.map((b: any) => b.id)), { rows: new Map(), library: [] as any });
  const lockedIds = new Set<string>();
  for (const d of days) {
    const date = dayDate(d);
    if (lock.has(d.id) || (date && date < today)) lockedIds.add(d.id);
  }
  const structure = liveBlocks.map((b: any) => {
    const t = typed.rows.get(b.id) ?? {};
    const ws = weeks.filter((w) => w.block_id === b.id).sort((x, y) => x.week_index - y.week_index);
    return {
      id: b.id,
      name: b.name ?? "Block",
      blockType: (t as any).block_type ?? null,
      blockMeta: (t as any).block_meta ?? null,
      phase: null,
      trainingFocus: (t as any).training_focus ?? null,
      startDate: b.start_date ?? null,
      weeks: ws.map((w) => ({
        week_index: w.week_index,
        phase: w.phase ?? null,
        notes: w.notes ?? null,
        days: days
          .filter((d) => d.week_id === w.id)
          .sort((x, y) => x.day_index - y.day_index || String(x.id).localeCompare(String(y.id)))
          .map((d) => ({
            _dbId: d.id,
            day_index: d.day_index,
            title: d.title ?? null,
            subtitle: d.subtitle ?? null,
            scheduled_date: dayDate(d),
            rows: rows.filter((r) => r.day_id === d.id && !r.cardio_target_id).sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0) || String(x.id).localeCompare(String(y.id))),
          })),
      })),
    };
  });

  // the athlete: builder read (session limit, equipment, pain, style), weight management, cardio, maxes
  const { loadBuilderAthlete } = await import("@/lib/builder-athlete");
  const [athlete, wm, maxes] = await Promise.all([
    best(() => loadBuilderAthlete(clientId, today, sb), null as any),
    best(async () => (await import("@/lib/weight-management/load.server")).loadWeightManagement(sb, clientId), null as any),
    best(async () => {
      const { data, error } = await sb.from("pl_client_maxes").select("*").eq("client_id", clientId);
      if (error) throw error;
      return (data ?? []) as any[];
    }, [] as any[]),
  ]);
  const maxIndexFor = (blockId: string | null) => buildMaxIndex(maxes.filter((m: any) => m.block_id == null || m.block_id === blockId));
  const firstLive = structure[0]?.id ?? null;
  const index = maxIndexFor(firstLive);

  const input: CheckInput = {
    kind: "client",
    style: athlete?.style ?? null,
    blocks: structure,
    exercises,
    blockTypes: typed.library,
    athlete: {
      sessionLimit: athlete?.sessionLimit ?? null,
      equipment: athlete?.equipment ?? null,
      pain: athlete?.pain ?? [],
      needsDates: false,
      hasMax: (name, family, basis) => {
        const out = computeRowLoad({ exerciseName: name, basis: basis as any, percentage: 100, manualLoadKg: null, manualLoadLb: null, unit: "kg", maxesIndex: index, family: family as any, ownCompetition: !!family && /competition/i.test(name) });
        return out.status !== "no-max";
      },
    },
    locked: (at) => {
      const d = structure[at.block]?.weeks?.[at.week]?.days?.[at.day];
      return !!d?._dbId && lockedIds.has(d._dbId);
    },
  };

  // what the rest of their week says: deficit, recovery, cardio
  let deficitPct: number | null = null;
  let cardio: ProgramQualityContext["cardio"] = null;
  if (wm) {
    try {
      const { observedMaintenance, weightTrend } = await import("@/lib/nutrition-targets/nutrition-intel");
      const plan = wm.input.plan;
      const trend = plan.start ? weightTrend(wm.input.weighIns, plan.start, wm.assessment.today) : null;
      const m = observedMaintenance({ trend, food: null, planKcal: plan.weeklyKcal, adherence: wm.assessment.checkins.adherence });
      if (m?.kcal && plan.weeklyKcal) deficitPct = ((plan.weeklyKcal - m.kcal) / m.kcal) * 100;
    } catch {
      /* optional */
    }
    try {
      const { loadCardioWorkspace } = await import("@/lib/cardio/workspace.server");
      const { planFacts } = await import("@/lib/cardio/quality");
      const view = await loadCardioWorkspace(sb, clientId, { loaded: wm });
      if (view.live.sessions.some((s: any) => s.enabled)) {
        const f = planFacts(view.live, view.ctx);
        cardio = { minutes: f.minutes, hardMinutes: f.hardMinutes, highImpact: f.highImpactSessions, dayBeforeHeavyLower: f.dayBeforeHeavyLower, beforeLifting: f.beforeLifting };
      }
    } catch {
      /* optional */
    }
  }

  const meet = wm?.input.meet ?? null;
  const ctx: ProgramQualityContext = {
    today,
    level: wm?.input.level ?? null,
    style: athlete?.style ?? null,
    trainingDays: toFull(client.committed_training_days),
    meet: meet ? { name: meet.name ?? null, date: meet.date, weeksOut: wm?.assessment.meetWeeksOut ?? Math.round((Date.parse(`${meet.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / (7 * 86_400_000)) } : null,
    blocks: liveBlocks.map((b: any) => ({ name: b.name, start: b.start_date ?? null, end: b.end_date ?? null, current: !!b.start_date && b.start_date <= today })),
    direction: wm ? (wm.input.goal?.type || wm.assessment.goal || wm.input.plan.phase ? wm.assessment.direction : null) : null,
    deficitPct,
    recoveryFlags: wm ? (wm.assessment.checkins.poorSleep >= 2 ? 1 : 0) + (wm.assessment.checkins.lowEnergy >= 2 ? 1 : 0) : 0,
    lowerPerformance: wm?.input.performance.lower ?? null,
    cardio,
    adherence: planned ? { done, planned } : null,
    effort: rated ? { rated, harder } : null,
    checkins: wm?.assessment.checkins.count ?? 0,
  };
  return { quality: scoreProgram(input, ctx), blockId: firstLive };
}
