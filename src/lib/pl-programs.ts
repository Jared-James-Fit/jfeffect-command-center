import { supabase } from "@/integrations/supabase/client";
import { mergeScheduledInstances } from "@/lib/scheduled-instances-merge";
import { filterPrimaryProgramBlocks, isAtHomeBackupSessionBlock } from "@/lib/at-home-backup";
import { isInactivePrimaryDay } from "@/lib/active-calendar";
import { normalizeMuscle } from "@/lib/analytics/muscle-map";
import { compareWorkoutItemsBySchedule } from "@/lib/workout-today";

// ---------- Types ----------
export type PrepStatus = "Planned" | "Active" | "Completed" | "Archived";
export type BlockStatus = "Draft" | "Active" | "Completed" | "Archived";
export type TimeProfile =
  | "main_lift"
  | "secondary_lift"
  | "accessory_compound"
  | "accessory_isolation"
  | "warmup_mobility"
  | "conditioning";
export type PercentageBasis =
  | "1rm"
  | "training_max"
  | "est_1rm"
  | "top_set"
  | "prev_set"
  | "prev_week"
  | "manual"
  | "none";
export type TemplateType = "full_prep" | "block" | "week" | "day" | "exercise_row";
export type TrainingStyle =
  | "powerlifting"
  | "bodybuilding"
  | "strength"
  | "lifestyle"
  | "hybrid"
  | "rehab"
  | "conditioning"
  | "custom";

export const GOAL_TYPES = [
  "Powerlifting Competition",
  "Bodybuilding / Hypertrophy Phase",
  "Fat Loss Phase",
  "Muscle Gain Phase",
  "Strength Phase",
  "Lifestyle Phase",
  "Rehab / Pivot",
  "Offseason",
  "Photoshoot",
  "Wedding / Event",
  "General Fitness",
  "Custom",
] as const;

export const TRAINING_FOCUSES = [
  "Volume",
  "Strength",
  "Peaking",
  "Technique",
  "Hypertrophy",
  "Rehab / Pivot",
  "Meet Prep",
  "Offseason",
  "Taper",
  "Deload",
  "Custom",
] as const;

export const TIME_PROFILES: { value: TimeProfile; label: string; defaultRest: number; warmupBuffer: number }[] = [
  { value: "main_lift",          label: "Main Lift",         defaultRest: 240, warmupBuffer: 600 },
  { value: "secondary_lift",     label: "Secondary Lift",    defaultRest: 180, warmupBuffer: 300 },
  { value: "accessory_compound", label: "Accessory Compound", defaultRest: 120, warmupBuffer: 0 },
  { value: "accessory_isolation",label: "Accessory Isolation",defaultRest: 60,  warmupBuffer: 0 },
  { value: "warmup_mobility",    label: "Warm-Up / Mobility", defaultRest: 30,  warmupBuffer: 0 },
  { value: "conditioning",       label: "Conditioning",       defaultRest: 60,  warmupBuffer: 0 },
];

export const PERCENTAGE_BASES: { value: PercentageBasis; label: string }[] = [
  { value: "manual",       label: "Manual load" },
  { value: "1rm",          label: "% of 1RM" },
  { value: "training_max", label: "% of Training Max" },
  { value: "est_1rm",      label: "% of Estimated 1RM" },
  { value: "top_set",      label: "% of Top Set (linked row)" },
  { value: "prev_set",     label: "% of Previous Set (linked row)" },
  { value: "prev_week",    label: "% of Previous Week" },
  { value: "none",         label: "No prescribed load" },
];

// ---------- Duration estimator ----------
export interface RowForEstimate {
  sets?: number | null;
  rest_seconds?: number | null;
  time_profile?: TimeProfile | null;
  estimated_seconds_override?: number | null;
}

export function profileDefaults(profile: TimeProfile | null | undefined) {
  return TIME_PROFILES.find((p) => p.value === profile) ?? TIME_PROFILES[2];
}

/** Per-row seconds: sets * (work + rest) + warmup buffer for main/secondary lifts. */
export function estimateRowSeconds(row: RowForEstimate): number {
  if (row.estimated_seconds_override) return row.estimated_seconds_override;
  const sets = Math.max(0, row.sets ?? 0);
  if (sets === 0) return 0;
  const prof = profileDefaults(row.time_profile);
  const rest = row.rest_seconds ?? prof.defaultRest;
  const workPerSet = prof.value === "main_lift" ? 60 : prof.value === "warmup_mobility" ? 0 : 45;
  const transitions = 180; // setup between exercises
  return prof.warmupBuffer + sets * (workPerSet + rest) + transitions;
}

/** Whole-day minutes: sum rows + 10 min general warm-up; round to nearest 5. */
export function estimateDayMinutes(rows: RowForEstimate[]): number {
  const general = 600;
  const total = general + rows.reduce((s, r) => s + estimateRowSeconds(r), 0);
  return Math.max(5, Math.round(total / 60 / 5) * 5);
}

/** Display range ±10%. */
export function durationRange(minutes: number): string {
  const low = Math.max(5, Math.round((minutes * 0.9) / 5) * 5);
  const high = Math.round((minutes * 1.1) / 5) * 5;
  return low === high ? `${minutes} min` : `${low}–${high} min`;
}

// ---------- Percentage / load resolver ----------
export function roundLoad(load: number, unit: "kg" | "lb"): number {
  const step = unit === "kg" ? 2.5 : 5;
  return Math.round(load / step) * step;
}

export interface ClientMax { lift: string; one_rm: number | null; training_max: number | null; estimated_1rm: number | null; unit: string }

export function resolveLoad(opts: {
  basis: PercentageBasis | null | undefined;
  percentage: number | null | undefined;
  liftMax?: ClientMax | null;
  basisRowLoad?: number | null;
  manualLoad?: number | null;
  unit: "kg" | "lb";
}): number | null {
  const { basis, percentage, liftMax, basisRowLoad, manualLoad, unit } = opts;
  if (!basis || basis === "manual") return manualLoad ?? null;
  if (!percentage) return null;
  let base: number | null = null;
  if (basis === "1rm")          base = liftMax?.one_rm ?? null;
  else if (basis === "training_max") base = liftMax?.training_max ?? null;
  else if (basis === "est_1rm") base = liftMax?.estimated_1rm ?? null;
  else if (basis === "top_set" || basis === "prev_set" || basis === "prev_week") base = basisRowLoad ?? null;
  if (base == null) return null;
  return roundLoad((base * percentage) / 100, unit);
}

// ---------- Countdown ----------
export function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function countdownLabel(dateStr: string | null | undefined): string | null {
  const days = daysUntil(dateStr);
  if (days == null) return null;
  if (days < 0) return `${Math.abs(days)} days past`;
  if (days === 0) return "Today";
  const weeks = Math.floor(days / 7);
  if (weeks >= 2) return `${weeks} weeks out`;
  return `${days} days out`;
}

// ---------- Data helpers (untyped — new tables not in generated types yet) ----------
const sb = supabase as any;

export async function listClientPreps(clientId: string) {
  const { data, error } = await sb.from("pl_preps").select("*").eq("client_id", clientId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listClientBlocks(clientId: string) {
  const { data, error } = await sb.from("pl_blocks").select("*").eq("client_id", clientId).order("sort_order").order("created_at");
  if (error) throw error;
  // Reserved At-Home Backup blocks (definitions + sessions) never appear in
  // primary block selection, Schedule Manager, or Block View.
  return filterPrimaryProgramBlocks(data ?? []);
}

export async function getBlockTree(blockId: string) {
  const { data: block, error: be } = await sb.from("pl_blocks").select("*").eq("id", blockId).maybeSingle();
  if (be) throw be;
  if (!block) return null;
  const { data: weeks } = await sb.from("pl_weeks").select("*").eq("block_id", blockId).order("week_index");
  const weekIds = (weeks ?? []).map((w: any) => w.id);
  const { data: days } = weekIds.length
    ? await sb.from("pl_days").select("*").in("week_id", weekIds).order("day_index")
    : { data: [] };
  const dayIds = (days ?? []).map((d: any) => d.id);
  const { data: rows } = dayIds.length
    ? await sb.from("pl_exercise_rows").select("*, exercises(id,name,video_url,vimeo_embed_url,thumbnail_url,cues)").in("day_id", dayIds).order("sort_order")
    : { data: [] };
  return { block, weeks: weeks ?? [], days: days ?? [], rows: rows ?? [] };
}

export async function createPrep(input: { client_id: string; title: string; goal_type?: string; event_name?: string | null; event_date?: string | null; total_weeks?: number | null; status?: PrepStatus; client_visible?: boolean; source_template_id?: string | null; start_date?: string | null; end_date?: string | null }) {
  const { data, error } = await sb.from("pl_preps").insert(input as any).select("*").single();
  if (error) throw error;
  return data;
}

export async function createBlock(input: { client_id: string; prep_id?: string | null; name: string; weeks: number; training_focus?: string | null; week_start_index?: number | null; source_template_id?: string | null; status?: BlockStatus; start_date?: string | null; end_date?: string | null }) {
  const { data: block, error } = await sb.from("pl_blocks").insert(input as any).select("*").single();
  if (error) throw error;
  // Seed weeks + 1 day each
  for (let i = 1; i <= input.weeks; i++) {
    const { data: w } = await sb.from("pl_weeks").insert({ block_id: block.id, week_index: i }).select("*").single();
    if (w) {
      // No generated "Day 1" title — the label is derived from day_index at render time.
      await sb.from("pl_days").insert({ week_id: w.id, day_index: 1 });
    }
  }
  return block;
}

export async function addDay(weekId: string, dayIndex: number, title?: string | null) {
  // `title` is now optional / nullable. The day's visible label ("Day N") is
  // derived from `day_index` at render time; only pass a value here when the
  // coach has typed a real title (rare — most days should leave it NULL and
  // use `subtitle` instead).
  const insert: any = { week_id: weekId, day_index: dayIndex };
  if (title && title.trim()) insert.title = title.trim();
  const { data, error } = await sb.from("pl_days").insert(insert).select("*").single();
  if (error) throw error;
  return data;
}

export async function addRow(dayId: string, sortOrder: number) {
  // Blank rows are left empty — coach fills in sets/reps/rpe/etc.
  // Placeholders in the UI show example values but nothing is saved here.
  const { data, error } = await sb
    .from("pl_exercise_rows")
    .insert({ day_id: dayId, sort_order: sortOrder, time_profile: "accessory_compound" })
    .select("*").single();
  if (error) throw error;
  return data;
}

export async function updateRow(rowId: string, patch: Record<string, any>) {
  const { error } = await sb.from("pl_exercise_rows").update(patch).eq("id", rowId);
  if (error) throw error;
}

export async function deleteRow(rowId: string) {
  const { error } = await sb.from("pl_exercise_rows").delete().eq("id", rowId);
  if (error) throw error;
}

export async function updateDay(dayId: string, patch: Record<string, any>) {
  const { error } = await sb.from("pl_days").update(patch).eq("id", dayId);
  if (error) throw error;
}

export async function updateBlock(blockId: string, patch: Record<string, any>) {
  const { error } = await sb.from("pl_blocks").update(patch).eq("id", blockId);
  if (error) throw error;
}

export async function updatePrep(prepId: string, patch: Record<string, any>) {
  const { error } = await sb.from("pl_preps").update(patch).eq("id", prepId);
  if (error) throw error;
}

export async function deletePrep(prepId: string) {
  // Detach blocks first so we don't hit FK constraints; coach can re-link them later.
  await sb.from("pl_blocks").update({ prep_id: null }).eq("prep_id", prepId);
  const { error } = await sb.from("pl_preps").delete().eq("id", prepId);
  if (error) throw error;
}

export async function deleteBlock(blockId: string) {
  // pl_weeks/pl_days/pl_exercise_rows cascade via FK; if not, this still removes the block row.
  const { error } = await sb.from("pl_blocks").delete().eq("id", blockId);
  if (error) throw error;
}

export async function deleteDay(dayId: string) {
  const { error } = await sb.from("pl_days").delete().eq("id", dayId);
  if (error) throw error;
}

export async function deleteWeek(weekId: string) {
  const { error } = await sb.from("pl_weeks").delete().eq("id", weekId);
  if (error) throw error;
}

export async function duplicateDay(dayId: string) {
  const { data: src } = await sb.from("pl_days").select("*").eq("id", dayId).maybeSingle();
  if (!src) throw new Error("Day not found");
  const { data: siblings } = await sb.from("pl_days").select("day_index").eq("week_id", src.week_id);
  const nextIdx = Math.max(0, ...(siblings ?? []).map((s: any) => s.day_index ?? 0)) + 1;
  const { data: newDay, error } = await sb.from("pl_days").insert({
    week_id: src.week_id, day_index: nextIdx,
    // Derive the label from position; carry any coach-typed title/subtitle
    // forward, appending "(copy)" to whichever is set so the coach can tell
    // duplicates apart without stuffing generated text into the title.
    title: src.title ?? null,
    subtitle: src.subtitle
      ? `${src.subtitle} (copy)`
      : (src.title ? null : null),
    focus: src.focus, notes: src.notes, notes_client_visible: src.notes_client_visible,
    duration_estimate_min: src.duration_estimate_min,
  }).select("*").single();
  if (error) throw error;
  const { data: rows } = await sb.from("pl_exercise_rows").select("*").eq("day_id", dayId).order("sort_order");
  for (const r of rows ?? []) {
    const { id, created_at, updated_at, day_id, ...rest } = r;
    await sb.from("pl_exercise_rows").insert({ ...rest, day_id: newDay.id });
  }
  return newDay;
}

export async function duplicateWeek(weekId: string) {
  const { data: src } = await sb.from("pl_weeks").select("*").eq("id", weekId).maybeSingle();
  if (!src) throw new Error("Week not found");
  const { data: siblings } = await sb.from("pl_weeks").select("week_index").eq("block_id", src.block_id);
  const nextIdx = Math.max(0, ...(siblings ?? []).map((s: any) => s.week_index ?? 0)) + 1;
  const { data: newWeek, error } = await sb.from("pl_weeks").insert({
    block_id: src.block_id, week_index: nextIdx, notes: src.notes,
  }).select("*").single();
  if (error) throw error;
  // bump block.weeks
  await sb.from("pl_blocks").update({ weeks: nextIdx }).eq("id", src.block_id);
  const { data: days } = await sb.from("pl_days").select("*").eq("week_id", weekId).order("day_index");
  for (const d of days ?? []) {
    const { data: newDay } = await sb.from("pl_days").insert({
      week_id: newWeek.id, day_index: d.day_index, title: d.title, subtitle: d.subtitle, focus: d.focus, notes: d.notes, notes_client_visible: d.notes_client_visible,
      duration_estimate_min: d.duration_estimate_min,
    }).select("*").single();
    const { data: rows } = await sb.from("pl_exercise_rows").select("*").eq("day_id", d.id).order("sort_order");
    for (const r of rows ?? []) {
      const { id, created_at, updated_at, day_id, ...rest } = r;
      await sb.from("pl_exercise_rows").insert({ ...rest, day_id: newDay.id });
    }
  }
  return newWeek;
}

export async function moveRow(rowId: string, direction: "up" | "down") {
  // Protected server function backed by the pl_move_row RPC. Both updates
  // happen inside the same database function (transaction); on failure the
  // RPC raises and Postgres rolls back, leaving sort_order unchanged.
  const { moveRowFn } = await import("@/lib/pl-programs.functions");
  return moveRowFn({ data: { rowId, direction } });
}

// ---------- Sheet-style builder helpers ----------

/** Append a new week to a block (and bump block.weeks). Seeds one empty day. */
export async function addWeek(blockId: string) {
  const { data: existing } = await sb
    .from("pl_weeks")
    .select("week_index")
    .eq("block_id", blockId)
    .order("week_index", { ascending: false })
    .limit(1);
  const nextIdx = (((existing ?? []) as any[])[0]?.week_index ?? 0) + 1;
  const { data: w, error } = await sb
    .from("pl_weeks")
    .insert({ block_id: blockId, week_index: nextIdx })
    .select("*")
    .single();
  if (error) throw error;
  await sb.from("pl_blocks").update({ weeks: nextIdx }).eq("id", blockId);
  await sb.from("pl_days").insert({ week_id: w.id, day_index: 1, title: "Day 1" });
  return w;
}

/** Insert a new row from an exercise at a given position (defaults appended). */
export async function addRowFromExercise(dayId: string, exerciseId: string, position?: number) {
  // Look up the exercise so we can seed sensible defaults (time profile + rest)
  const { data: ex } = await sb
    .from("exercises")
    .select("name, category, muscle_group, exercise_category, is_competition_lift, competition_lift_type")
    .eq("id", exerciseId)
    .maybeSingle();
  const profile = inferTimeProfileFromExercise(ex);
  const prof = TIME_PROFILES.find((p) => p.value === profile) ?? TIME_PROFILES[2];
  const { defaultRestSeconds } = await import("@/lib/exercise-metadata");
  const restDefault = defaultRestSeconds(ex as any);
  const { data: existing } = await sb
    .from("pl_exercise_rows")
    .select("id, sort_order")
    .eq("day_id", dayId)
    .order("sort_order");
  const list = (existing ?? []) as any[];
  const pos = position ?? list.length;
  for (const r of list) {
    if ((r.sort_order ?? 0) >= pos) {
      await sb.from("pl_exercise_rows").update({ sort_order: (r.sort_order ?? 0) + 1 }).eq("id", r.id);
    }
  }
  const { data, error } = await sb
    .from("pl_exercise_rows")
    .insert({
      day_id: dayId,
      sort_order: pos,
      exercise_id: exerciseId,
      time_profile: profile,
      // sets / reps / rpe / rir intentionally left null — coach fills them in.
      // Rest seconds are seeded from the exercise's category default.
      rest_seconds: restDefault,
      rest_seconds_override: null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Infer a default time profile from an exercise's category/name. */
export function inferTimeProfileFromExercise(ex: { name?: string | null; category?: string | null; muscle_group?: string | null } | null | undefined): TimeProfile {
  const cat = (ex?.category ?? "").toLowerCase();
  const name = (ex?.name ?? "").toLowerCase();
  if (cat === "warm-ups" || cat === "mobility" || /warm[- ]?up|mobility|activation/.test(name)) return "warmup_mobility";
  if (cat === "cardio" || /cardio|conditioning|sprint|sled|prowler/.test(name)) return "conditioning";
  if (/(^|\s)(comp |competition )?(back |front |high.bar |low.bar )?squat$|^bench press$|^deadlift$|^conventional deadlift$|^sumo deadlift$|^overhead press$|^ohp$/.test(name)) return "main_lift";
  if (/squat|bench press|deadlift|overhead press|press$/.test(name)) return "secondary_lift";
  if (/curl|extension|raise|fly|kickback|pulldown|pushdown|shrug|calf/.test(name)) return "accessory_isolation";
  return "accessory_compound";
}

/** Move a row to a different day (or same day at a position). Shifts siblings. */
export async function moveRowToDay(rowId: string, targetDayId: string, position?: number) {
  const { data: existing } = await sb
    .from("pl_exercise_rows")
    .select("id, sort_order")
    .eq("day_id", targetDayId)
    .order("sort_order");
  const list = (existing ?? []) as any[];
  const pos = position ?? list.length;
  for (const r of list) {
    if (r.id === rowId) continue;
    if ((r.sort_order ?? 0) >= pos) {
      await sb.from("pl_exercise_rows").update({ sort_order: (r.sort_order ?? 0) + 1 }).eq("id", r.id);
    }
  }
  const { error } = await sb
    .from("pl_exercise_rows")
    .update({ day_id: targetDayId, sort_order: pos })
    .eq("id", rowId);
  if (error) throw error;
}

/** Duplicate a row inside the same day, immediately after it. */
export async function duplicateRow(rowId: string) {
  const { data: src } = await sb.from("pl_exercise_rows").select("*").eq("id", rowId).maybeSingle();
  if (!src) return;
  const { id, created_at, updated_at, ...rest } = src as any;
  const newPos = (src.sort_order ?? 0) + 1;
  const { data: list } = await sb
    .from("pl_exercise_rows")
    .select("id, sort_order")
    .eq("day_id", src.day_id)
    .order("sort_order");
  for (const r of (list ?? []) as any[]) {
    if ((r.sort_order ?? 0) >= newPos) {
      await sb.from("pl_exercise_rows").update({ sort_order: (r.sort_order ?? 0) + 1 }).eq("id", r.id);
    }
  }
  await sb.from("pl_exercise_rows").insert({ ...rest, sort_order: newPos });
}

export interface CopyWeekOptions {
  prescriptions: boolean;
  notes: boolean;
}

/**
 * Build the explicit programming payload shared by the two legacy copy flows.
 * A role is a property of the prescription, not exercise order or display
 * metadata, so it must always be retained even when numerical prescriptions
 * are intentionally omitted.
 */
export function buildCopiedExerciseRowPayload(r: Record<string, any>, dayId: string, opts: CopyWeekOptions) {
  return {
    day_id: dayId,
    sort_order: r.sort_order,
    exercise_id: r.exercise_id,
    exercise_name_override: r.exercise_name_override,
    sets: opts.prescriptions ? r.sets : null,
    reps_text: opts.prescriptions ? r.reps_text : null,
    rpe: opts.prescriptions ? r.rpe : null,
    rir: opts.prescriptions ? r.rir : null,
    percentage: opts.prescriptions ? r.percentage : null,
    percentage_basis: opts.prescriptions ? r.percentage_basis : "manual",
    load_kg: opts.prescriptions ? r.load_kg : null,
    load_lb: opts.prescriptions ? r.load_lb : null,
    rest_seconds: opts.prescriptions ? r.rest_seconds : null,
    tempo: opts.prescriptions ? r.tempo : null,
    time_profile: r.time_profile,
    notes: opts.notes ? r.notes : null,
    measurement_type: r.measurement_type ?? "reps",
    tracking_type: r.tracking_type ?? (r.measurement_type === "time" ? "time" : "reps_weight"),
    duration_seconds: opts.prescriptions ? r.duration_seconds : null,
    reps_text_backup: opts.prescriptions ? r.reps_text_backup : null,
    duration_seconds_backup: opts.prescriptions ? r.duration_seconds_backup : null,
    // Keep the stored canonical role plus the display/family metadata that
    // identifies the same competition-lift prescription in every downstream
    // view. These fields intentionally do not depend on `opts.prescriptions`.
    purpose_label: r.purpose_label ?? null,
    movement_family: r.movement_family ?? null,
    card_color: r.card_color ?? null,
  };
}

/** Copy week structure (days + rows) into another week. Never touches client logs. */
export async function copyWeek(srcWeekId: string, targetWeekId: string, opts: CopyWeekOptions) {
  if (srcWeekId === targetWeekId) throw new Error("Source and target weeks must differ");
  // Wipe existing days in target (cascades to rows + completions)
  const { data: targetDays } = await sb.from("pl_days").select("id").eq("week_id", targetWeekId);
  for (const d of (targetDays ?? []) as any[]) {
    await sb.from("pl_days").delete().eq("id", d.id);
  }
  // Optionally copy week notes
  if (opts.notes) {
    const { data: src } = await sb.from("pl_weeks").select("notes").eq("id", srcWeekId).maybeSingle();
    if (src) await sb.from("pl_weeks").update({ notes: (src as any).notes }).eq("id", targetWeekId);
  }
  const { data: srcDays } = await sb.from("pl_days").select("*").eq("week_id", srcWeekId).order("day_index");
  for (const d of (srcDays ?? []) as any[]) {
    const { data: newDay } = await sb
      .from("pl_days")
      .insert({
        week_id: targetWeekId,
        day_index: d.day_index,
        title: d.title,
        focus: d.focus,
        notes: opts.notes ? d.notes : null,
        notes_client_visible: opts.notes ? d.notes_client_visible : false,
        duration_source: d.duration_source,
        duration_override_min: d.duration_override_min,
        source_day_id: d.id,
        is_custom: false,
      })
      .select("*")
      .single();
    const { data: rows } = await sb
      .from("pl_exercise_rows")
      .select("*")
      .eq("day_id", d.id)
      .order("sort_order");
    for (const r of (rows ?? []) as any[]) {
      await sb.from("pl_exercise_rows").insert(buildCopiedExerciseRowPayload(r, newDay.id, opts));
    }
  }
}

// ---------- Linked-week helpers ----------

export type EditScope = "this" | "future" | "all";

/** Resolve which day IDs an edit should apply to, given a scope. Custom days (other than the origin) are excluded. */
export async function expandLinkedDays(dayId: string, scope: EditScope): Promise<string[]> {
  if (scope === "this") return [dayId];
  const { data: day } = await sb.from("pl_days").select("id, week_id, day_index").eq("id", dayId).maybeSingle();
  if (!day) return [dayId];
  const { data: week } = await sb.from("pl_weeks").select("id, block_id, week_index").eq("id", day.week_id).maybeSingle();
  if (!week) return [dayId];
  const { data: allWeeks } = await sb.from("pl_weeks").select("id, week_index").eq("block_id", week.block_id).order("week_index");
  const weekIds = (allWeeks ?? [])
    .filter((w: any) => scope === "all" || w.week_index >= week.week_index)
    .map((w: any) => w.id);
  if (!weekIds.length) return [dayId];
  const { data: days } = await sb
    .from("pl_days")
    .select("id, is_custom")
    .in("week_id", weekIds)
    .eq("day_index", day.day_index);
  return (days ?? [])
    .filter((d: any) => d.id === dayId || !d.is_custom)
    .map((d: any) => d.id);
}

/** Count downstream days (future weeks, same day_index) that are flagged custom — used for warning UX. */
export async function countCustomDownstream(dayId: string): Promise<number> {
  const { data: day } = await sb.from("pl_days").select("week_id, day_index").eq("id", dayId).maybeSingle();
  if (!day) return 0;
  const { data: week } = await sb.from("pl_weeks").select("block_id, week_index").eq("id", day.week_id).maybeSingle();
  if (!week) return 0;
  const { data: weeks } = await sb.from("pl_weeks").select("id").eq("block_id", week.block_id).gt("week_index", week.week_index);
  const ids = (weeks ?? []).map((w: any) => w.id);
  if (!ids.length) return 0;
  const { data: days } = await sb.from("pl_days").select("id").in("week_id", ids).eq("day_index", day.day_index).eq("is_custom", true);
  return (days ?? []).length;
}

/** Apply the same patch to a set of rows across days, matched by sort_order. */
export async function applyRowPatchAcrossDays(originRowId: string, dayIds: string[], patch: Record<string, any>) {
  const { data: origin } = await sb.from("pl_exercise_rows").select("sort_order, day_id").eq("id", originRowId).maybeSingle();
  if (!origin) return;
  await sb.from("pl_exercise_rows").update(patch).eq("id", originRowId);
  for (const did of dayIds) {
    if (did === origin.day_id) continue;
    await sb.from("pl_exercise_rows").update(patch).eq("day_id", did).eq("sort_order", origin.sort_order);
  }
}

/** Apply a day-level patch to a set of days. */
export async function applyDayPatchAcrossDays(dayIds: string[], patch: Record<string, any>) {
  if (!dayIds.length) return;
  await sb.from("pl_days").update(patch).in("id", dayIds);
}

/** Break the link on a day so future cascades skip it. */
export async function breakDayLink(dayId: string) {
  await sb.from("pl_days").update({ is_custom: true }).eq("id", dayId);
}

/** Re-link a day to the same-day-index day in the previous week. */
export async function relinkDay(dayId: string) {
  const { data: day } = await sb.from("pl_days").select("week_id, day_index").eq("id", dayId).maybeSingle();
  if (!day) return;
  const { data: week } = await sb.from("pl_weeks").select("block_id, week_index").eq("id", day.week_id).maybeSingle();
  if (!week) return;
  const { data: prev } = await sb.from("pl_weeks").select("id").eq("block_id", week.block_id).eq("week_index", week.week_index - 1).maybeSingle();
  if (!prev) return;
  const { data: src } = await sb.from("pl_days").select("id").eq("week_id", prev.id).eq("day_index", day.day_index).maybeSingle();
  await sb.from("pl_days").update({ source_day_id: src?.id ?? null, is_custom: false }).eq("id", dayId);
}

/** Copy one week into every other week in the same block. */
export async function copyWeekToAll(srcWeekId: string, opts: CopyWeekOptions) {
  const { data: src } = await sb.from("pl_weeks").select("block_id").eq("id", srcWeekId).maybeSingle();
  if (!src) return { copied: 0 };
  const { data: weeks } = await sb.from("pl_weeks").select("id").eq("block_id", src.block_id).neq("id", srcWeekId);
  let copied = 0;
  for (const w of (weeks ?? []) as any[]) {
    await copyWeek(srcWeekId, w.id, opts);
    copied++;
  }
  return { copied };
}

/** Copy one day's rows into the same day_index in every later week of the block. */
export async function copyDayToFutureWeeks(dayId: string, opts: CopyWeekOptions = { prescriptions: true, notes: true }) {
  const { data: day } = await sb.from("pl_days").select("id, week_id, day_index").eq("id", dayId).maybeSingle();
  if (!day) return { copied: 0 };
  const { data: week } = await sb.from("pl_weeks").select("block_id, week_index").eq("id", day.week_id).maybeSingle();
  if (!week) return { copied: 0 };
  const { data: laterWeeks } = await sb.from("pl_weeks").select("id, week_index").eq("block_id", week.block_id).gt("week_index", week.week_index).order("week_index");
  let copied = 0;
  for (const w of (laterWeeks ?? []) as any[]) {
    await copyDayContent(dayId, w.id, day.day_index, opts);
    copied++;
  }
  return { copied };
}

/** Copy one day's rows into the same day_index across the given week IDs. */
export async function copyDayToWeeks(dayId: string, weekIds: string[], opts: CopyWeekOptions = { prescriptions: true, notes: true }) {
  const { data: day } = await sb.from("pl_days").select("id, day_index").eq("id", dayId).maybeSingle();
  if (!day) return { copied: 0 };
  let copied = 0;
  for (const wid of weekIds) {
    await copyDayContent(dayId, wid, day.day_index, opts);
    copied++;
  }
  return { copied };
}

/** Internal: replace the day at (weekId, dayIndex) with a clone of srcDayId. Creates the day if missing. */
async function copyDayContent(srcDayId: string, targetWeekId: string, dayIndex: number, opts: CopyWeekOptions) {
  const { data: src } = await sb.from("pl_days").select("*").eq("id", srcDayId).maybeSingle();
  if (!src) return;
  // Skip if the target day is flagged custom — preserve manual edits by default.
  const { data: existing } = await sb.from("pl_days").select("id, is_custom").eq("week_id", targetWeekId).eq("day_index", dayIndex).maybeSingle();
  if (existing?.is_custom) return;
  // Delete existing day at this slot (cascades to rows).
  if (existing) await sb.from("pl_days").delete().eq("id", existing.id);
  const { data: newDay } = await sb
    .from("pl_days")
    .insert({
      week_id: targetWeekId,
      day_index: dayIndex,
      title: src.title,
      focus: src.focus,
      notes: opts.notes ? src.notes : null,
      notes_client_visible: opts.notes ? src.notes_client_visible : false,
      duration_source: src.duration_source,
      duration_override_min: src.duration_override_min,
      source_day_id: src.id,
      is_custom: false,
    })
    .select("*")
    .single();
  const { data: rows } = await sb.from("pl_exercise_rows").select("*").eq("day_id", srcDayId).order("sort_order");
  for (const r of (rows ?? []) as any[]) {
    await sb.from("pl_exercise_rows").insert(buildCopiedExerciseRowPayload(r, newDay.id, opts));
  }
}

/** Delete every row in every day of every week with week_index > fromIndex in a block. Custom days are preserved. */
export async function clearFutureWeeks(blockId: string, fromIndex: number) {
  const { data: weeks } = await sb.from("pl_weeks").select("id").eq("block_id", blockId).gt("week_index", fromIndex);
  let cleared = 0;
  for (const w of (weeks ?? []) as any[]) {
    const { data: days } = await sb.from("pl_days").select("id, is_custom").eq("week_id", w.id);
    for (const d of (days ?? []) as any[]) {
      if (d.is_custom) continue;
      await sb.from("pl_exercise_rows").delete().eq("day_id", d.id);
      cleared++;
    }
  }
  return { cleared };
}

/** Flip every day in the block to is_custom = true (so cascades stop touching them). */
export async function breakAllLinks(blockId: string) {
  const { data: weeks } = await sb.from("pl_weeks").select("id").eq("block_id", blockId);
  const weekIds = (weeks ?? []).map((w: any) => w.id);
  if (!weekIds.length) return { updated: 0 };
  const { data: days } = await sb.from("pl_days").select("id").in("week_id", weekIds);
  const ids = (days ?? []).map((d: any) => d.id);
  if (!ids.length) return { updated: 0 };
  await sb.from("pl_days").update({ is_custom: true }).in("id", ids);
  return { updated: ids.length };
}

// ---------- Progression rules ----------

export type ProgressionRuleType = "add_kg" | "add_lb" | "add_pct" | "repeat" | "deload";

export interface ProgressionRule {
  type: ProgressionRuleType;
  amount?: number;
  /** Substring filter on exercise name. Empty = apply to all rows. */
  exerciseFilter?: string;
}

/** Walk weeks in order; for each week >= 2, derive new prescriptions from the previous week's rows. Skips custom days. */
export async function applyProgression(blockId: string, rule: ProgressionRule): Promise<{ updated: number; skippedCustom: number }> {
  const { data: weeks } = await sb.from("pl_weeks").select("id, week_index").eq("block_id", blockId).order("week_index");
  if (!weeks || weeks.length < 2) return { updated: 0, skippedCustom: 0 };
  let updated = 0;
  let skippedCustom = 0;
  const filter = (rule.exerciseFilter ?? "").trim().toLowerCase();

  for (let i = 1; i < weeks.length; i++) {
    const prevWeek = weeks[i - 1] as any;
    const thisWeek = weeks[i] as any;
    const { data: prevDays } = await sb.from("pl_days").select("id, day_index").eq("week_id", prevWeek.id);
    const { data: thisDays } = await sb.from("pl_days").select("id, day_index, is_custom").eq("week_id", thisWeek.id);
    for (const td of (thisDays ?? []) as any[]) {
      if (td.is_custom) { skippedCustom++; continue; }
      const pd = (prevDays ?? []).find((d: any) => d.day_index === td.day_index);
      if (!pd) continue;
      const { data: prevRows } = await sb.from("pl_exercise_rows").select("*, exercises(name)").eq("day_id", pd.id).order("sort_order");
      const { data: thisRows } = await sb.from("pl_exercise_rows").select("id, sort_order").eq("day_id", td.id).order("sort_order");
      for (const pr of (prevRows ?? []) as any[]) {
        const tr = (thisRows ?? []).find((r: any) => r.sort_order === pr.sort_order);
        if (!tr) continue;
        const name: string = (pr.exercises?.name ?? pr.exercise_name_override ?? "").toLowerCase();
        if (filter && !name.includes(filter)) continue;
        const patch: Record<string, any> = {};
        if (rule.type === "add_kg" && pr.load_kg != null) patch.load_kg = Number(pr.load_kg) + (rule.amount ?? 2.5);
        else if (rule.type === "add_lb" && pr.load_lb != null) patch.load_lb = Number(pr.load_lb) + (rule.amount ?? 5);
        else if (rule.type === "add_pct" && pr.percentage != null) patch.percentage = Number(pr.percentage) + (rule.amount ?? 2.5);
        else if (rule.type === "repeat") {
          if (pr.load_kg != null) patch.load_kg = pr.load_kg;
          if (pr.load_lb != null) patch.load_lb = pr.load_lb;
          if (pr.percentage != null) patch.percentage = pr.percentage;
        } else if (rule.type === "deload") {
          if (pr.load_kg != null) patch.load_kg = Math.round((Number(pr.load_kg) * 0.9) / 2.5) * 2.5;
          if (pr.load_lb != null) patch.load_lb = Math.round((Number(pr.load_lb) * 0.9) / 5) * 5;
          if (pr.percentage != null) patch.percentage = Math.round(Number(pr.percentage) * 0.9 * 10) / 10;
        }
        if (Object.keys(patch).length > 0) {
          await sb.from("pl_exercise_rows").update(patch).eq("id", tr.id);
          updated++;
        }
      }
    }
  }
  return { updated, skippedCustom };
}

// ---------- Analytics / PRs ----------
// e1RM math lives in the unified analytics module; re-exported here for
// backward compatibility with existing callers.
import { epley1RM } from "@/lib/analytics/e1rm";
export { epley1RM };

export interface LiftResultPoint {
  date: string;
  load: number;
  reps: number;
  est_1rm: number;
  exercise_name: string;
  rpe?: string | null;
}

/** Pull all completed sets for a client, joined with exercise + muscle group. */
export async function getClientResults(
  clientId: string,
  opts: { blockId?: string } = {},
) {
  // When blockId is provided, restrict results to rows whose day belongs to
  // the block. This is the authoritative boundary for exact-block analytics.
  let allowedDayIds: Set<string> | null = null;
  if (opts.blockId) {
    const { data: weeks } = await sb.from("pl_weeks").select("id").eq("block_id", opts.blockId);
    const weekIds = (weeks ?? []).map((w: any) => w.id);
    if (weekIds.length === 0) return [];
    const { data: days } = await sb.from("pl_days").select("id").in("week_id", weekIds);
    const dayIds = (days ?? []).map((d: any) => d.id);
    if (dayIds.length === 0) return [];
    allowedDayIds = new Set(dayIds);
  }
  const { data, error } = await sb
    .from("pl_row_results")
    .select("id, set_index, actual_load, actual_load_unit, entered_value, entered_unit, normalized_lb, normalized_kg, actual_reps, actual_rpe, actual_rir, is_bodyweight, load_type, notes, completed_at, completed_duration_seconds, row_id, pl_exercise_rows(exercise_id, exercise_name_override, day_id, purpose_label, movement_family, exercises(name, muscle_group, primary_muscle_group, category))")
    .eq("client_id", clientId)
    .not("actual_reps", "is", null)
    .order("completed_at", { ascending: true });
  if (error) throw error;
  const LB_PER_KG = 2.2046226;
  return (data ?? [])
    .filter((r: any) => {
      if (!allowedDayIds) return true;
      const did = r.pl_exercise_rows?.day_id ?? null;
      return did && allowedDayIds.has(did);
    })
    .map((r: any) => {
      // Always work in LB internally. Prefer the pre-computed normalized
      // column; fall back to converting whichever raw value + unit was
      // logged. This is what stops kg-logged sets from being summed as lb
      // (or vice versa) on the analytics page.
      let loadLb: number;
      if (r.normalized_lb != null) {
        loadLb = Number(r.normalized_lb) || 0;
      } else if (r.normalized_kg != null) {
        loadLb = (Number(r.normalized_kg) || 0) * LB_PER_KG;
      } else {
        const rawVal = r.entered_value ?? r.actual_load;
        const rawUnit = (r.entered_unit ?? r.actual_load_unit ?? "lb") as string;
        const n = Number(rawVal) || 0;
        loadLb = rawUnit === "kg" ? n * LB_PER_KG : n;
      }
      const loadType: "external" | "bodyweight" | "assisted" =
        r.load_type === "assisted" || r.load_type === "bodyweight" || r.load_type === "external"
          ? r.load_type
          : r.is_bodyweight === true
            ? "bodyweight"
            : "external";
      const isBodyweight = loadType === "bodyweight";
      const isAssisted = loadType === "assisted";
      // A set carries external load only when a positive load was logged.
      // Bodyweight (and legacy zero-load) sets are still real, completed sets:
      // they must survive into set counts, reps, adherence and frequency, but
      // they must never produce a 0 lb "PR" or fake tonnage.
      // Assisted sets carry a POSITIVE assistance number, not external load.
      // They count as real sets/reps/volume-by-muscle, but must never inflate
      // "Weight Lifted" tonnage or produce external-load PRs.
      const hasLoad = loadLb > 0 && !isAssisted;
      return {
        id: r.id,
        set_index: r.set_index,
        // `load` is now ALWAYS in LB. Display code is responsible for
        // converting to the viewer's preferred unit before rendering.
        load: isAssisted ? 0 : loadLb,
        is_bodyweight: isBodyweight,
        load_type: loadType,
        /** Assistance amount in LB (assisted sets only). Lower is better. */
        assist_lb: isAssisted ? loadLb : null,
        counts_load: hasLoad,
        reps: Number(r.actual_reps) || 0,
        rpe: r.actual_rpe ?? null,
        rir: r.actual_rir ?? null,
        exercise_note: r.notes ?? null,
        duration_seconds: r.completed_duration_seconds ?? null,
        row_id: r.row_id,
        day_id: r.pl_exercise_rows?.day_id ?? null,
        purpose_label: r.pl_exercise_rows?.purpose_label ?? null,
        movement_family: r.pl_exercise_rows?.movement_family ?? null,
        date: r.completed_at,
        est_1rm: hasLoad ? epley1RM(loadLb, Number(r.actual_reps) || 0) : 0,
        exercise_id: r.pl_exercise_rows?.exercise_id ?? null,
        exercise_name: r.pl_exercise_rows?.exercises?.name ?? r.pl_exercise_rows?.exercise_name_override ?? "Unknown",
        muscle_group:
          r.pl_exercise_rows?.exercises?.primary_muscle_group ??
          r.pl_exercise_rows?.exercises?.muscle_group ??
          "Other",
        category: r.pl_exercise_rows?.exercises?.category ?? null,
      };
    });
}

/**
 * Identity key for grouping a set's history. Prefers the library exercise id
 * so renamed / near-duplicate display names ("Spotto Press" vs "Spoto Press")
 * stop fragmenting history. Falls back to the display name for rows that are
 * genuinely custom (no library link).
 */
function exerciseIdentityKey(r: any): string {
  return r.exercise_id ? `id:${r.exercise_id}` : `name:${(r.exercise_name ?? "Unknown").trim().toLowerCase()}`;
}

/** Group result history by exercise; return time-series est-1RM and current PR. */
export function buildExerciseHistory(results: any[]) {
  const byEx = new Map<string, any[]>();
  // Strength history is a loaded-lift view: bodyweight/zero-load sets are kept
  // in `results` for set counting but excluded from e1RM series and PRs.
  for (const r of (results as any[]).filter((r) => (r.load ?? 0) > 0)) {
    const k = exerciseIdentityKey(r);
    if (!byEx.has(k)) byEx.set(k, []);
    byEx.get(k)!.push(r);
  }
  const out: { name: string; pr: any; latest_est: number; points: any[] }[] = [];
  for (const [, pts] of byEx) {
    const pr = pts.reduce((best, p) => (p.est_1rm > (best?.est_1rm ?? 0) ? p : best), null as any);
    const latest = pts[pts.length - 1];
    // Display name follows the most recent record so historical renames show
    // under the current name without splitting the series.
    out.push({ name: latest?.exercise_name ?? pts[0]?.exercise_name ?? "Unknown", pr, latest_est: latest?.est_1rm ?? 0, points: pts });
  }
  return out.sort((a, b) => (b.pr?.est_1rm ?? 0) - (a.pr?.est_1rm ?? 0));
}

/** Sets per muscle group in the last `days` days. */
export function weeklyMuscleVolume(results: any[], days = 7) {
  const cutoff = Date.now() - days * 86400000;
  const tally = new Map<string, number>();
  for (const r of results) {
    if (!r.date || new Date(r.date).getTime() < cutoff) continue;
    // Normalize library free-text muscle values (e.g. "Lower Back",
    // "Adductors") into the canonical analytics groups before tallying.
    const k = normalizeMuscle(r.muscle_group) ?? "Other";
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  return [...tally.entries()].map(([muscle, sets]) => ({ muscle, sets })).sort((a, b) => b.sets - a.sets);
}

/** Newest est-1RM PR per exercise in last `days` days. */
export function recentPRs(results: any[], days = 30) {
  const cutoff = Date.now() - days * 86400000;
  // Loaded sets only — a bodyweight set can never be a 0 lb / 0 kg PR.
  const loaded = results.filter((r) => (r.load ?? 0) > 0);
  const recent = loaded.filter((r) => r.date && new Date(r.date).getTime() >= cutoff);
  const all = loaded;
  const prs: any[] = [];
  const byEx = new Map<string, any[]>();
  for (const r of all) {
    const k = exerciseIdentityKey(r);
    if (!byEx.has(k)) byEx.set(k, []);
    byEx.get(k)!.push(r);
  }
  for (const r of recent) {
    const history = byEx.get(exerciseIdentityKey(r)) ?? [];
    const priorMax = history.filter((h) => h.date && new Date(h.date).getTime() < new Date(r.date).getTime()).reduce((m, h) => Math.max(m, h.est_1rm), 0);
    if (r.est_1rm > priorMax && priorMax > 0) {
      prs.push({ ...r, prior_est: priorMax, delta: r.est_1rm - priorMax });
    }
  }
  prs.push(...recentAssistedPRs(results, days));
  return prs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/**
 * Assisted-machine PRs. Direction is INVERTED: less assistance = better.
 * A PR is a set with lower assistance than any prior set of the same exercise
 * at the same or more reps. `delta` is the assistance REMOVED (positive lb).
 */
export function recentAssistedPRs(results: any[], days = 30) {
  const cutoff = Date.now() - days * 86400000;
  const assisted = results.filter((r) => r.load_type === "assisted" && (r.assist_lb ?? 0) > 0 && r.date);
  const byEx = new Map<string, any[]>();
  for (const r of assisted) {
    const k = exerciseIdentityKey(r);
    if (!byEx.has(k)) byEx.set(k, []);
    byEx.get(k)!.push(r);
  }
  const prs: any[] = [];
  for (const r of assisted) {
    if (new Date(r.date).getTime() < cutoff) continue;
    const history = (byEx.get(exerciseIdentityKey(r)) ?? []).filter(
      (h) => new Date(h.date).getTime() < new Date(r.date).getTime() && (h.reps ?? 0) >= (r.reps ?? 0),
    );
    if (history.length === 0) continue;
    const priorMin = history.reduce((m, h) => Math.min(m, h.assist_lb), Infinity);
    if (!Number.isFinite(priorMin) || r.assist_lb >= priorMin) continue;
    prs.push({
      ...r,
      assisted: true,
      prior_assist: priorMin,
      assist: r.assist_lb,
      prior_est: priorMin,
      delta: priorMin - r.assist_lb,
    });
  }
  return prs;
}

/** Active prep for client (most recent Active, then Planned). */
export async function getActivePrep(clientId: string) {
  const { data } = await sb.from("pl_preps").select("*").eq("client_id", clientId).in("status", ["Active", "Planned"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}

export async function getCompletedHistory(clientId: string) {
  const { data: preps } = await sb.from("pl_preps").select("*").eq("client_id", clientId).in("status", ["Completed", "Archived"]).order("end_date", { ascending: false });
  const { data: blocks } = await sb.from("pl_blocks").select("*").eq("client_id", clientId).in("status", ["Completed", "Archived"]).order("updated_at", { ascending: false });
  return { preps: preps ?? [], blocks: blocks ?? [] };
}

/* ---------------------------------------------------------------------- */
/* Block summary, week status, archive helpers (training-block overhaul). */
/* ---------------------------------------------------------------------- */

export type WeekStatus = "Not Started" | "In Progress" | "Completed" | "Manually Completed";

export interface BlockSummaryWeek {
  id: string;
  week_index: number;
  start_date: string | null;
  end_date: string | null;
  date_source: string | null;
  status: WeekStatus;
  manually_completed: boolean;
  manual_completed_at: string | null;
  manual_completed_by: string | null;
  est_minutes: number | null;
  training_days: string[];
  notes: string | null;
  day_count: number;
  completed_count: number;
}

export interface BlockSummary {
  block: any;
  weeks: BlockSummaryWeek[];
  total_workouts: number;
  completed_workouts: number;
  progress_pct: number;
  current_week_index: number | null;
}

/** Build a normalized summary for a block: weeks, status, progress, current week. */
export async function getBlockSummary(blockId: string): Promise<BlockSummary | null> {
  const { data: block } = await sb.from("pl_blocks").select("*").eq("id", blockId).maybeSingle();
  if (!block) return null;
  const { data: weeksRaw } = await sb.from("pl_weeks").select("*").eq("block_id", blockId).order("week_index");
  const weeks = (weeksRaw ?? []) as any[];
  const weekIds = weeks.map((w) => w.id);
  const { data: days } = weekIds.length
    ? await sb.from("pl_days").select("id, week_id").in("week_id", weekIds)
    : { data: [] as any[] };
  const dayIds = (days ?? []).map((d: any) => d.id);
  const { data: comps } = dayIds.length
    ? await sb.from("pl_day_completions").select("day_id, client_id, completed_at").in("day_id", dayIds).eq("client_id", block.client_id)
    : { data: [] as any[] };
  const completedDayIds = new Set(
    (comps ?? []).filter((c: any) => c.completed_at).map((c: any) => c.day_id),
  );
  const dayByWeek = new Map<string, string[]>();
  for (const d of (days ?? []) as any[]) {
    const arr = dayByWeek.get(d.week_id) ?? [];
    arr.push(d.id);
    dayByWeek.set(d.week_id, arr);
  }
  const summaryWeeks: BlockSummaryWeek[] = weeks.map((w) => {
    const dIds = dayByWeek.get(w.id) ?? [];
    const doneCount = dIds.filter((id) => completedDayIds.has(id)).length;
    return {
      id: w.id,
      week_index: w.week_index,
      start_date: w.start_date ?? null,
      end_date: w.end_date ?? null,
      date_source: w.date_source ?? null,
      status: (w.status ?? "Not Started") as WeekStatus,
      manually_completed: !!w.manually_completed,
      manual_completed_at: w.manual_completed_at ?? null,
      manual_completed_by: w.manual_completed_by ?? null,
      est_minutes: w.est_minutes ?? null,
      training_days: w.training_days ?? [],
      notes: w.notes ?? null,
      day_count: dIds.length,
      completed_count: doneCount,
    };
  });
  const total = summaryWeeks.reduce((s, w) => s + w.day_count, 0);
  const done = summaryWeeks.reduce((s, w) => s + w.completed_count, 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // Current week: by status (In Progress / Not Started after a Completed),
  // then by date range if block has start_date.
  let currentWeekIndex: number | null = null;
  const sd: string | null = block.start_date ?? null;
  if (sd) {
    const dur = block.week_duration_days ?? 7;
    const start = new Date(sd + "T00:00:00");
    if (!isNaN(start.getTime())) {
      const ms = Date.now() - start.getTime();
      const idx = Math.floor(ms / (dur * 86400000)) + 1;
      if (idx >= 1 && idx <= summaryWeeks.length) currentWeekIndex = idx;
    }
  }
  if (currentWeekIndex == null) {
    const firstUnfinished = summaryWeeks.find(
      (w) => w.status === "In Progress" || w.status === "Not Started",
    );
    if (firstUnfinished) currentWeekIndex = firstUnfinished.week_index;
  }

  return {
    block,
    weeks: summaryWeeks,
    total_workouts: total,
    completed_workouts: done,
    progress_pct: pct,
    current_week_index: currentWeekIndex,
  };
}

/** Toggle a week's manual completion flag. Re-runs status calc via DB trigger fallback. */
export async function setWeekManualComplete(weekId: string, on: boolean, userId?: string | null) {
  const patch: Record<string, any> = {
    manually_completed: on,
    manual_completed_at: on ? new Date().toISOString() : null,
    manual_completed_by: on ? userId ?? null : null,
  };
  const { error } = await sb.from("pl_weeks").update(patch).eq("id", weekId);
  if (error) throw error;
  // Recompute status (function exists in DB).
  await sb.rpc("pl_recompute_week_status", { _week_id: weekId });
  // Pull the block_id so we can also refresh block status.
  const { data: w } = await sb.from("pl_weeks").select("block_id").eq("id", weekId).maybeSingle();
  if (w?.block_id) await sb.rpc("pl_recompute_block_status", { _block_id: w.block_id });
}

export async function archiveBlock(blockId: string, userId?: string | null) {
  const { error } = await sb.from("pl_blocks").update({
    status: "Archived",
    archived: true,
    archived_at: new Date().toISOString(),
    archived_by: userId ?? null,
  }).eq("id", blockId);
  if (error) throw error;
}

export async function unarchiveBlock(blockId: string) {
  const { error } = await sb.from("pl_blocks").update({
    status: "Active",
    archived: false,
    archived_at: null,
    archived_by: null,
  }).eq("id", blockId);
  if (error) throw error;
}

export async function markBlockComplete(blockId: string, opts?: { archive?: boolean }) {
  const { error } = await sb.from("pl_blocks").update({
    status: opts?.archive ? "Archived" : "Completed",
    completed_at: new Date().toISOString(),
    completion_method: "manual",
    archived: !!opts?.archive,
    archived_at: opts?.archive ? new Date().toISOString() : null,
  }).eq("id", blockId);
  if (error) throw error;
}

/** List archived blocks for a client (workout archive). */
export async function listArchivedBlocks(clientId: string) {
  const { data } = await sb
    .from("pl_blocks")
    .select("*")
    .eq("client_id", clientId)
    .or("status.eq.Archived,archived.eq.true")
    .order("archived_at", { ascending: false, nullsFirst: false });
  return (data ?? []) as any[];
}

/** Set the block end date manually (marks the end date as overridden). */
export async function setBlockEndDate(blockId: string, endDate: string | null) {
  const { error } = await sb.from("pl_blocks").update({ end_date: endDate }).eq("id", blockId);
  if (error) throw error;
}

/** Set the prep end date manually. */
export async function setPrepEndDate(prepId: string, endDate: string | null) {
  const { error } = await sb.from("pl_preps").update({ end_date: endDate }).eq("id", prepId);
  if (error) throw error;
}

/** Update per-week schedule fields (training days, est minutes, notes). */
export async function updateWeekMeta(weekId: string, patch: Partial<{ training_days: string[]; est_minutes: number | null; notes: string }>) {
  const { error } = await sb.from("pl_weeks").update(patch).eq("id", weekId);
  if (error) throw error;
}

export const PREP_STATUSES: PrepStatus[] = ["Planned", "Active", "Completed", "Archived"];
export const BLOCK_STATUSES: BlockStatus[] = ["Draft", "Active", "Completed", "Archived"];

export async function listTemplates(opts: {
  type?: TemplateType | "all";
  style?: TrainingStyle | "all";
  q?: string;
  /** When set, return only the N most recently updated templates (used for the empty-state of the cmd+K palette). */
  limit?: number;
}) {
  let q = sb.from("pl_templates").select("*");
  if (!(opts as any).includeArchived) q = q.eq("archived", false);
  else if ((opts as any).onlyArchived) q = q.eq("archived", true);
  if (opts.type && opts.type !== "all") q = q.eq("template_type", opts.type);
  if (opts.style && opts.style !== "all") q = q.ilike("training_style", opts.style);
  if (opts.q && opts.q.trim()) {
    const term = `%${opts.q.trim()}%`;
    // Match name OR training_focus OR notes OR training_style OR any tag.
    q = q.or(
      `name.ilike.${term},training_focus.ilike.${term},notes.ilike.${term},training_style.ilike.${term}`,
    );
    // Post-filter tags in JS (PostgREST can't OR into a text[] column directly).
    const { data, error } = await q.order("updated_at", { ascending: false });
    if (error) throw error;
    const needle = opts.q.trim().toLowerCase();
    const rows = (data ?? []).filter((r: any) => {
      if (r.name?.toLowerCase().includes(needle)) return true;
      if (r.training_focus?.toLowerCase().includes(needle)) return true;
      if (r.notes?.toLowerCase().includes(needle)) return true;
      if (r.training_style?.toLowerCase().includes(needle)) return true;
      if (Array.isArray(r.tags) && r.tags.some((t: string) => t.toLowerCase().includes(needle))) return true;
      return false;
    });
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }
  const { data, error } = await q
    .order("updated_at", { ascending: false })
    .limit(opts.limit ?? 1000);
  if (error) throw error;
  return data ?? [];
}

export async function createTemplate(input: { name: string; template_type: TemplateType; training_style: TrainingStyle; training_focus?: string; goal?: string; description?: string; notes?: string; weeks?: number; days_per_week?: number; est_duration_min?: number; tags?: string[]; payload?: any }) {
  // Stamp ownership so the new template lands in the creator's My Library.
  const { data: au } = await sb.auth.getUser();
  const owner_user_id = au.user?.id ?? null;
  // Default visibility: 'team' for admin-created (matches legacy org-wide visibility),
  // 'private' for coach-created (they must explicitly share/submit).
  // We don't know the caller role here without a round-trip, so default to 'team';
  // coach-created flows should override via a follow-up update if needed.
  const { data, error } = await sb
    .from("pl_templates")
    .insert({ ...input, owner_user_id, visibility: "team" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function getTemplate(id: string) {
  const { data, error } = await sb.from("pl_templates").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateTemplate(id: string, patch: Record<string, any>) {
  const { error } = await sb.from("pl_templates").update(patch).eq("id", id);
  if (error) throw error;
}

export async function duplicateTemplate(id: string) {
  const tpl = await getTemplate(id);
  if (!tpl) throw new Error("Template not found");
  const { id: _i, created_at: _c, updated_at: _u, created_by: _b, owner_user_id: _o, payload_revision: _pr, ...rest } = tpl as any;
  const { data: au } = await sb.auth.getUser();
  const { data, error } = await sb
    .from("pl_templates")
    .insert({
      ...rest,
      name: `${tpl.name} (copy)`,
      archived: false,
      owner_user_id: au.user?.id ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function setTemplateArchived(id: string, archived: boolean) {
  await updateTemplate(id, { archived });
}

/** Clients (and the prep/block rows) that were created from a given template. */
export async function listTemplateAssignments(templateId: string) {
  const [preps, blocks] = await Promise.all([
    (sb as any).from("pl_preps")
      .select("id, title, client_id, created_at, status, archived, start_date, end_date, clients:clients(id, full_name)")
      .eq("source_template_id", templateId)
      .order("created_at", { ascending: false }),
    (sb as any).from("pl_blocks")
      .select("id, name, client_id, prep_id, created_at, status, archived, start_date, end_date, clients:clients(id, full_name)")
      .eq("source_template_id", templateId)
      .order("created_at", { ascending: false }),
  ]);
  const rows: Array<{
    kind: "prep" | "block";
    id: string;
    label: string;
    clientId: string;
    clientName: string | null;
    prepId?: string | null;
    createdAt: string;
    status?: string | null;
    archived?: boolean;
    startDate?: string | null;
    endDate?: string | null;
  }> = [];
  for (const p of (preps.data ?? []) as any[]) {
    rows.push({ kind: "prep", id: p.id, label: p.title, clientId: p.client_id, clientName: p.clients?.full_name ?? null, createdAt: p.created_at, status: p.status, archived: !!p.archived, startDate: p.start_date ?? null, endDate: p.end_date ?? null });
  }
  for (const b of (blocks.data ?? []) as any[]) {
    // Skip blocks that belong to a prep already listed above to avoid double-counting full-prep assignments.
    rows.push({ kind: "block", id: b.id, label: b.name, clientId: b.client_id, clientName: b.clients?.full_name ?? null, prepId: b.prep_id, createdAt: b.created_at, status: b.status, archived: !!b.archived, startDate: b.start_date ?? null, endDate: b.end_date ?? null });
  }
  return rows;
}

/** Lookup the source template (if any) for a given prep id or block id. */
export async function getSourceTemplate(opts: { prepId?: string | null; blockId?: string | null }) {
  let templateId: string | null = null;
  if (opts.prepId) {
    const { data } = await (sb as any).from("pl_preps").select("source_template_id").eq("id", opts.prepId).maybeSingle();
    templateId = data?.source_template_id ?? null;
  } else if (opts.blockId) {
    const { data } = await (sb as any).from("pl_blocks").select("source_template_id").eq("id", opts.blockId).maybeSingle();
    templateId = data?.source_template_id ?? null;
  }
  if (!templateId) return null;
  const { data: tpl } = await (sb as any).from("pl_templates").select("id, name, template_type").eq("id", templateId).maybeSingle();
  return tpl ?? null;
}

export async function deleteTemplate(id: string) {
  const { error } = await sb.from("pl_templates").delete().eq("id", id);
  if (error) throw error;
}

/** Count weeks/days/rows in a template payload for summary display. */
export function summarizeTemplatePayload(tpl: any) {
  const p = tpl?.payload || {};
  if (tpl?.template_type === "full_prep") {
    const blocks = p.blocks_data || [];
    const weeks = blocks.reduce((s: number, b: any) => s + (b.weeks_data?.length || 0), 0);
    const days = blocks.reduce((s: number, b: any) => s + (b.weeks_data || []).reduce((ss: number, w: any) => ss + (w.days?.length || 0), 0), 0);
    const rows = blocks.reduce((s: number, b: any) => s + (b.weeks_data || []).reduce((ss: number, w: any) => ss + (w.days || []).reduce((sss: number, d: any) => sss + (d.rows?.length || 0), 0), 0), 0);
    return { blocks: blocks.length, weeks, days, rows };
  }
  if (tpl?.template_type === "block") {
    const wd = p.weeks_data || [];
    const days = wd.reduce((s: number, w: any) => s + (w.days?.length || 0), 0);
    const rows = wd.reduce((s: number, w: any) => s + (w.days || []).reduce((ss: number, d: any) => ss + (d.rows?.length || 0), 0), 0);
    return { blocks: 1, weeks: wd.length, days, rows };
  }
  if (tpl?.template_type === "week") {
    const days = (p.days || []).length;
    const rows = (p.days || []).reduce((s: number, d: any) => s + (d.rows?.length || 0), 0);
    return { blocks: 0, weeks: 1, days, rows };
  }
  if (tpl?.template_type === "day") {
    return { blocks: 0, weeks: 0, days: 1, rows: (p.rows || []).length };
  }
  return { blocks: 0, weeks: 0, days: 0, rows: 1 };
}

export function getTemplateWeeks(tpl: any): number {
  if (!tpl) return 0;
  const p = tpl.payload || {};
  if (tpl.template_type === "full_prep") {
    if (p.prep?.total_weeks) return Number(p.prep.total_weeks);
    const blocks = p.blocks_data || [];
    return blocks.reduce((s: number, b: any) => s + (b.weeks_data?.length || b.weeks || 0), 0);
  }
  if (tpl.template_type === "block") {
    if (Array.isArray(p.weeks_data)) return p.weeks_data.length;
    return Number(tpl.weeks) || 0;
  }
  if (tpl.template_type === "week") return 1;
  return 0;
}

export function computeEndDateFromStart(startDate: string, weeks: number): string {
  const d = new Date(startDate + "T00:00:00");
  d.setDate(d.getDate() + weeks * 7 - 1);
  // Format in local time. `toISOString().slice(0,10)` shifts to UTC and
  // returns the previous day for any user east of UTC, producing off-by-one
  // block end dates and "missing today's workout" symptoms.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function insertWeekTree(blockId: string, weekIndex: number, w: any) {
  const { data: newWeek } = await sb.from("pl_weeks").insert({ block_id: blockId, week_index: weekIndex, notes: w.notes ?? null }).select("*").single();
  for (const d of (w.days || [])) await insertDayTree(newWeek.id, d.day_index ?? 1, d);
  return newWeek;
}
async function insertDayTree(weekId: string, dayIndex: number, d: any) {
  const { data: newDay } = await sb.from("pl_days").insert({ week_id: weekId, day_index: dayIndex, title: d.title ?? null, focus: d.focus ?? null, notes: d.notes ?? null }).select("*").single();
  let i = 0;
  for (const r of (d.rows || [])) {
    await insertRow(newDay.id, i++, r);
  }
  return newDay;
}
async function insertRow(dayId: string, sortOrder: number, r: any) {
  await sb.from("pl_exercise_rows").insert({
    day_id: dayId, sort_order: r.sort_order ?? sortOrder, exercise_id: r.exercise_id ?? null,
    exercise_name_override: r.exercise_name_override ?? null, sets: r.sets ?? null, reps_text: r.reps_text ?? null,
    rpe: r.rpe ?? null, rir: r.rir ?? null, percentage: r.percentage ?? null, percentage_basis: r.percentage_basis ?? null,
    load_kg: r.load_kg ?? null, load_lb: r.load_lb ?? null, rest_seconds: r.rest_seconds ?? null,
    tempo: r.tempo ?? null, time_profile: r.time_profile ?? "accessory_compound", notes: r.notes ?? null,
    measurement_type: r.measurement_type ?? "reps",
        tracking_type: r.tracking_type ?? (r.measurement_type === "time" ? "time" : "reps_weight"),
    duration_seconds: r.duration_seconds ?? null,
    reps_text_backup: r.reps_text_backup ?? null,
    duration_seconds_backup: r.duration_seconds_backup ?? null,
  });
}

export type TemplatePlacement =
  | { mode: "new_prep"; prep?: { title?: string; goal_type?: string; event_name?: string | null; event_date?: string | null } }
  | { mode: "existing_prep"; prepId: string }
  | { mode: "standalone_block" }
  | { mode: "into_block"; blockId: string }
  | { mode: "into_week"; weekId: string }
  | { mode: "into_day"; dayId: string };

export async function applyTemplateToClient(opts: { templateId: string; clientId: string; placement?: TemplatePlacement; prepId?: string | null; name?: string; clientVisible?: boolean; startDate?: string | null; endDate?: string | null; selectedBlockIds?: string[]; startFromBlockId?: string | null }) {
  // Hardened path: client-side browser code MUST NOT mutate program tables.
  // All assignment goes through the protected server function backed by an
  // atomic RPC. This re-export keeps existing import sites compiling while
  // ensuring there is exactly one assignment path on the server.
  const { applyTemplateToClientFn } = await import("@/lib/pl-programs.functions");
  const placement: TemplatePlacement | undefined = opts.placement ?? (opts.prepId ? { mode: "existing_prep", prepId: opts.prepId } : undefined);
  return applyTemplateToClientFn({
    data: {
      templateId: opts.templateId,
      clientId: opts.clientId,
      placement,
      name: opts.name ?? null,
      clientVisible: opts.clientVisible,
      startDate: opts.startDate ?? null,
      endDate: opts.endDate ?? null,
      selectedBlockIds: opts.selectedBlockIds ?? null,
      startFromBlockId: opts.startFromBlockId ?? null,
    },
  });
}


export async function saveBlockAsTemplate(blockId: string, name: string, style: TrainingStyle) {
  const tree = await getBlockTree(blockId);
  if (!tree) throw new Error("Block not found");
  const weeks_data = tree.weeks.map((w: any) => ({
    week_index: w.week_index,
    notes: w.notes,
    days: tree.days.filter((d: any) => d.week_id === w.id).map((d: any) => ({
      day_index: d.day_index, title: d.title, focus: d.focus, notes: d.notes,
      rows: tree.rows.filter((r: any) => r.day_id === d.id).map((r: any) => ({
        sort_order: r.sort_order, exercise_id: r.exercise_id, exercise_name_override: r.exercise_name_override,
        sets: r.sets, reps_text: r.reps_text, rpe: r.rpe, rir: r.rir, percentage: r.percentage,
        percentage_basis: r.percentage_basis, load_kg: r.load_kg, load_lb: r.load_lb,
        rest_seconds: r.rest_seconds, tempo: r.tempo, time_profile: r.time_profile, notes: r.notes,
        measurement_type: r.measurement_type ?? "reps",
        tracking_type: r.tracking_type ?? (r.measurement_type === "time" ? "time" : "reps_weight"),
        duration_seconds: r.duration_seconds ?? null,
        reps_text_backup: r.reps_text_backup ?? null,
        duration_seconds_backup: r.duration_seconds_backup ?? null,
      })),
    })),
  }));
  return createTemplate({
    name, template_type: "block", training_style: style,
    weeks: tree.block.weeks, payload: { weeks_data },
  });
}

export async function getClientWorkouts(
  clientId: string,
  options: { includeAtHomeBackupSessions?: boolean } = {},
) {
  // Visible blocks → weeks → days, plus completion status
  // Order matches pickCurrentBlock() and listClientBlocks(): sort_order first
  // so coach-driven reordering takes effect everywhere, with created_at as
  // a stable tiebreaker. Previously this used created_at only, causing the
  // workouts list/calendar to disagree with the block-view tab about which
  // block is "current".
  const { data: blocks } = await sb
    .from("pl_blocks")
    .select("*")
    .eq("client_id", clientId)
    .eq("client_visible", true)
    .neq("status", "Archived")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  // Session blocks need client visibility so the unchanged canonical logger can
  // read their cloned prescriptions through existing RLS. Exclude them by
  // default from every primary-program consumer; the Workout calendar opts in
  // explicitly to show them as additional At-Home Backup history items.
  const visibleBlocks = filterPrimaryProgramBlocks(blocks ?? [], {
    includeSessions: options.includeAtHomeBackupSessions,
  });
  const blockIds = visibleBlocks.map((b: any) => b.id);
  if (!blockIds.length) return [];
  const { data: weeks } = await sb.from("pl_weeks").select("*").in("block_id", blockIds).order("week_index");
  const weekIds = (weeks ?? []).map((w: any) => w.id);
  const { data: days } = weekIds.length
    ? await sb.from("pl_days").select("*").in("week_id", weekIds).order("day_index")
    : { data: [] };
  // Archived or soft-deleted days never render on active workout surfaces —
  // primary program days included. This is what stops a removed day from
  // regenerating through the legacy derived-cadence fallback once its
  // canonical pl_scheduled_workouts instance has been deleted. Prescriptions
  // are untouched; history/audit readers query pl_days directly.
  const activeDays = (days ?? []).filter((day: any) => !isInactivePrimaryDay(day));
  const dayIds = activeDays.map((d: any) => d.id);
  // Fire the two day-dependent reads (completions + exercise rows) in
  // parallel — they don't depend on each other and previously added a
  // serial round-trip each, which on mobile turned the workouts list
  // into a ~2s blank state.
  const [completionsRes, exerciseRowsRes, scheduledInstancesRes] = dayIds.length
    ? await Promise.all([
        sb.from("pl_day_completions").select("*").in("day_id", dayIds).eq("client_id", clientId),
        // Estimate fields ride along (sets/rest/profile) so the workouts
        // list can show a per-day duration estimate without a second query.
        sb.from("pl_exercise_rows").select("id, day_id, sets, rest_seconds, time_profile, estimated_seconds_override").in("day_id", dayIds),
        // Phase 2a: fetch instance-level schedule alongside prescriptions.
        // Filtered to this client so we never merge another client's cards.
        sb.from("pl_scheduled_workouts")
          .select("id, client_id, source_day_id, scheduled_date, scheduled_time, order_index, schedule_source, note, created_at")
          .eq("client_id", clientId)
          .in("source_day_id", dayIds),
      ])
    : [{ data: [] as any[] }, { data: [] as any[] }, { data: [] as any[] }];
  const { data: completions } = completionsRes;
  const { data: exerciseRows } = exerciseRowsRes;
  const { data: scheduledInstances } = scheduledInstancesRes;
  const rowIdToDay = new Map<string, string>();
  const rowsByDay = new Map<string, RowForEstimate[]>();
  for (const r of (exerciseRows ?? []) as any[]) {
    rowIdToDay.set(r.id, r.day_id);
    const list = rowsByDay.get(r.day_id) ?? [];
    list.push(r);
    rowsByDay.set(r.day_id, list);
  }
  const rowIds = Array.from(rowIdToDay.keys());
  // Run the two completion-derived reads (logged-set counts + feedback
  // presence) in parallel too — they're independent.
  const completionIds = (completions ?? []).map((c: any) => c.id).filter(Boolean);
  const [rowResultsRes, feedbacksRes] = await Promise.all([
    rowIds.length
      ? sb
          .from("pl_row_results")
          .select("row_id, actual_load, actual_load_unit, actual_reps, completed_duration_seconds")
          .eq("client_id", clientId)
          .in("row_id", rowIds)
      : Promise.resolve({ data: [] as any[] }),
    completionIds.length
      ? sb.from("pl_workout_feedback").select("completion_id").in("completion_id", completionIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const { data: rowResults } = rowResultsRes;
  const { data: feedbacks } = feedbacksRes;
  const loggedSetsByDay = new Map<string, number>();
  for (const rr of (rowResults ?? []) as any[]) {
    const hasLoad = rr.actual_load != null && Number.isFinite(Number(rr.actual_load)) && Number(rr.actual_load) > 0;
    const hasReps = rr.actual_reps != null && Number.isFinite(Number(rr.actual_reps)) && Number(rr.actual_reps) > 0;
    const hasDuration = rr.completed_duration_seconds != null && Number.isFinite(Number(rr.completed_duration_seconds)) && Number(rr.completed_duration_seconds) > 0;
    if (!hasDuration && !(hasReps && hasLoad)) continue;
    const dayId = rowIdToDay.get(rr.row_id);
    if (!dayId) continue;
    loggedSetsByDay.set(dayId, (loggedSetsByDay.get(dayId) ?? 0) + 1);
  }
  const feedbackSet = new Set<string>((feedbacks ?? []).map((f: any) => f.completion_id));
  const daysByWeek = new Map<string, any[]>();
  for (const d of activeDays) {
    const list = daysByWeek.get(d.week_id) ?? [];
    list.push(d);
    daysByWeek.set(d.week_id, list);
  }
  // Build one prescription-shaped item per pl_days row (or a placeholder
  // for weeks with no days). We then run these through
  // mergeScheduledInstances to emit one card per scheduled instance and
  // link completions instance-first with a safe legacy fallback.
  const baseItems = (weeks ?? []).flatMap((w: any) => {
    const b = visibleBlocks.find((x: any) => x.id === w?.block_id);
    const weekDays = daysByWeek.get(w.id) ?? [];
    if (weekDays.length === 0) return [{ day: null, week: w, block: b, completion: null, logged_sets_count: 0 }];
    return weekDays.map((d: any) => {
      // Base completion resolution is done by mergeScheduledInstances
      // (instance-first, legacy fallback). Leave null here so the merge
      // owns linkage — otherwise it would double-attach.
      // Resolve the day's estimated duration once, here, so every surface
      // (list card, calendar, logger) reads the same value: coach override
      // → stored day estimate → block estimate → computed from rows.
      const estRows = rowsByDay.get(d.id) ?? [];
      const estimatedMinutes =
        d.duration_override_min ??
        d.duration_estimate_min ??
        (b as any)?.estimated_minutes ??
        (estRows.length > 0 ? estimateDayMinutes(estRows) : null);
      return {
        day: d,
        week: w,
        block: b,
        completion: null,
        logged_sets_count: 0,
        ...(estimatedMinutes != null ? { estimated_minutes: estimatedMinutes } : {}),
      };
    });
  });
  const items = mergeScheduledInstances({
    items: baseItems,
    instances: (scheduledInstances ?? []) as any[],
    completions: (completions ?? []) as any[],
    feedbackCompletionIds: feedbackSet,
    loggedSetsByDay,
  });
  // Scheduled chronology is the canonical client-facing order. The shared
  // comparator falls back to program order only for genuinely unscheduled days.
  items.sort(compareWorkoutItemsBySchedule);
  return items;
}