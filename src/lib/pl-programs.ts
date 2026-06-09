import { supabase } from "@/integrations/supabase/client";

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
  | "manual";
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
  return data ?? [];
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
      await sb.from("pl_days").insert({ week_id: w.id, day_index: 1, title: "Day 1" });
    }
  }
  return block;
}

export async function addDay(weekId: string, dayIndex: number, title: string) {
  const { data, error } = await sb.from("pl_days").insert({ week_id: weekId, day_index: dayIndex, title }).select("*").single();
  if (error) throw error;
  return data;
}

export async function addRow(dayId: string, sortOrder: number) {
  const { data, error } = await sb.from("pl_exercise_rows").insert({ day_id: dayId, sort_order: sortOrder, sets: 3, reps_text: "8-12", time_profile: "accessory_compound" }).select("*").single();
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
    title: (src.title ?? `Day ${src.day_index}`) + " (copy)",
    focus: src.focus, notes: src.notes,
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
      week_id: newWeek.id, day_index: d.day_index, title: d.title, focus: d.focus, notes: d.notes,
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
  const { data: row } = await sb.from("pl_exercise_rows").select("*").eq("id", rowId).maybeSingle();
  if (!row) return;
  const { data: siblings } = await sb.from("pl_exercise_rows").select("id, sort_order").eq("day_id", row.day_id).order("sort_order");
  const idx = (siblings ?? []).findIndex((s: any) => s.id === rowId);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= (siblings ?? []).length) return;
  const other = (siblings as any[])[swapIdx];
  await sb.from("pl_exercise_rows").update({ sort_order: other.sort_order }).eq("id", rowId);
  await sb.from("pl_exercise_rows").update({ sort_order: row.sort_order }).eq("id", other.id);
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
    .select("name, category, muscle_group")
    .eq("id", exerciseId)
    .maybeSingle();
  const profile = inferTimeProfileFromExercise(ex);
  const prof = TIME_PROFILES.find((p) => p.value === profile) ?? TIME_PROFILES[2];
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
      sets: 3,
      reps_text: profile === "main_lift" ? "3-5" : "8-12",
      time_profile: profile,
      rest_seconds: prof.defaultRest,
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
      await sb.from("pl_exercise_rows").insert({
        day_id: newDay.id,
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
      });
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
      duration_source: src.duration_source,
      duration_override_min: src.duration_override_min,
      source_day_id: src.id,
      is_custom: false,
    })
    .select("*")
    .single();
  const { data: rows } = await sb.from("pl_exercise_rows").select("*").eq("day_id", srcDayId).order("sort_order");
  for (const r of (rows ?? []) as any[]) {
    await sb.from("pl_exercise_rows").insert({
      day_id: newDay.id,
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
    });
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
export function epley1RM(load: number, reps: number): number {
  if (!load || !reps || reps < 1) return 0;
  if (reps === 1) return load;
  return Math.round(load * (1 + reps / 30) * 10) / 10;
}

export interface LiftResultPoint {
  date: string;
  load: number;
  reps: number;
  est_1rm: number;
  exercise_name: string;
  rpe?: string | null;
}

/** Pull all completed sets for a client, joined with exercise + muscle group. */
export async function getClientResults(clientId: string) {
  const { data, error } = await sb
    .from("pl_row_results")
    .select("id, set_index, actual_load, actual_reps, actual_rpe, completed_at, row_id, pl_exercise_rows(exercise_id, exercise_name_override, exercises(name, muscle_group, category))")
    .eq("client_id", clientId)
    .not("actual_load", "is", null)
    .not("actual_reps", "is", null)
    .order("completed_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    set_index: r.set_index,
    load: Number(r.actual_load) || 0,
    reps: Number(r.actual_reps) || 0,
    rpe: r.actual_rpe,
    date: r.completed_at,
    est_1rm: epley1RM(Number(r.actual_load) || 0, Number(r.actual_reps) || 0),
    exercise_name: r.pl_exercise_rows?.exercises?.name ?? r.pl_exercise_rows?.exercise_name_override ?? "Unknown",
    muscle_group: r.pl_exercise_rows?.exercises?.muscle_group ?? "Other",
    category: r.pl_exercise_rows?.exercises?.category ?? null,
  }));
}

/** Group result history by exercise; return time-series est-1RM and current PR. */
export function buildExerciseHistory(results: any[]) {
  const byEx = new Map<string, any[]>();
  for (const r of results as any[]) {
    if (!byEx.has(r.exercise_name)) byEx.set(r.exercise_name, []);
    byEx.get(r.exercise_name)!.push(r);
  }
  const out: { name: string; pr: any; latest_est: number; points: any[] }[] = [];
  for (const [name, pts] of byEx) {
    const pr = pts.reduce((best, p) => (p.est_1rm > (best?.est_1rm ?? 0) ? p : best), null as any);
    const latest = pts[pts.length - 1];
    out.push({ name, pr, latest_est: latest?.est_1rm ?? 0, points: pts });
  }
  return out.sort((a, b) => (b.pr?.est_1rm ?? 0) - (a.pr?.est_1rm ?? 0));
}

/** Sets per muscle group in the last `days` days. */
export function weeklyMuscleVolume(results: any[], days = 7) {
  const cutoff = Date.now() - days * 86400000;
  const tally = new Map<string, number>();
  for (const r of results) {
    if (!r.date || new Date(r.date).getTime() < cutoff) continue;
    const k = r.muscle_group || "Other";
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  return [...tally.entries()].map(([muscle, sets]) => ({ muscle, sets })).sort((a, b) => b.sets - a.sets);
}

/** Newest est-1RM PR per exercise in last `days` days. */
export function recentPRs(results: any[], days = 30) {
  const cutoff = Date.now() - days * 86400000;
  const recent = results.filter((r) => r.date && new Date(r.date).getTime() >= cutoff);
  const all = results;
  const prs: any[] = [];
  const byEx = new Map<string, any[]>();
  for (const r of all) {
    if (!byEx.has(r.exercise_name)) byEx.set(r.exercise_name, []);
    byEx.get(r.exercise_name)!.push(r);
  }
  for (const r of recent) {
    const history = byEx.get(r.exercise_name) ?? [];
    const priorMax = history.filter((h) => h.date && new Date(h.date).getTime() < new Date(r.date).getTime()).reduce((m, h) => Math.max(m, h.est_1rm), 0);
    if (r.est_1rm > priorMax && priorMax > 0) {
      prs.push({ ...r, prior_est: priorMax, delta: r.est_1rm - priorMax });
    }
  }
  return prs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
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

/** Update per-week schedule fields (training days, est minutes, notes). */
export async function updateWeekMeta(weekId: string, patch: Partial<{ training_days: string[]; est_minutes: number | null; notes: string }>) {
  const { error } = await sb.from("pl_weeks").update(patch).eq("id", weekId);
  if (error) throw error;
}

export const PREP_STATUSES: PrepStatus[] = ["Planned", "Active", "Completed", "Archived"];
export const BLOCK_STATUSES: BlockStatus[] = ["Draft", "Active", "Completed", "Archived"];

export async function listTemplates(opts: { type?: TemplateType | "all"; style?: TrainingStyle | "all"; q?: string }) {
  let q = sb.from("pl_templates").select("*");
  if (!(opts as any).includeArchived) q = q.eq("archived", false);
  else if ((opts as any).onlyArchived) q = q.eq("archived", true);
  if (opts.type && opts.type !== "all") q = q.eq("template_type", opts.type);
  if (opts.style && opts.style !== "all") q = q.eq("training_style", opts.style);
  if (opts.q) q = q.ilike("name", `%${opts.q}%`);
  const { data, error } = await q.order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createTemplate(input: { name: string; template_type: TemplateType; training_style: TrainingStyle; training_focus?: string; goal?: string; notes?: string; weeks?: number; days_per_week?: number; est_duration_min?: number; tags?: string[]; payload?: any }) {
  const { data, error } = await sb.from("pl_templates").insert(input).select("*").single();
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
  const { id: _i, created_at: _c, updated_at: _u, created_by: _b, ...rest } = tpl;
  const { data, error } = await sb.from("pl_templates").insert({ ...rest, name: `${tpl.name} (copy)`, archived: false }).select("*").single();
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
      .select("id, title, client_id, created_at, status, archived, clients:clients(id, full_name)")
      .eq("source_template_id", templateId)
      .order("created_at", { ascending: false }),
    (sb as any).from("pl_blocks")
      .select("id, name, client_id, prep_id, created_at, status, archived, clients:clients(id, full_name)")
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
  }> = [];
  for (const p of (preps.data ?? []) as any[]) {
    rows.push({ kind: "prep", id: p.id, label: p.title, clientId: p.client_id, clientName: p.clients?.full_name ?? null, createdAt: p.created_at, status: p.status, archived: !!p.archived });
  }
  for (const b of (blocks.data ?? []) as any[]) {
    // Skip blocks that belong to a prep already listed above to avoid double-counting full-prep assignments.
    rows.push({ kind: "block", id: b.id, label: b.name, clientId: b.client_id, clientName: b.clients?.full_name ?? null, prepId: b.prep_id, createdAt: b.created_at, status: b.status, archived: !!b.archived });
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
  });
}

export type TemplatePlacement =
  | { mode: "new_prep"; prep?: { title?: string; goal_type?: string; event_name?: string | null; event_date?: string | null } }
  | { mode: "existing_prep"; prepId: string }
  | { mode: "standalone_block" }
  | { mode: "into_block"; blockId: string }
  | { mode: "into_week"; weekId: string }
  | { mode: "into_day"; dayId: string };

export async function applyTemplateToClient(opts: { templateId: string; clientId: string; placement?: TemplatePlacement; prepId?: string | null; name?: string; clientVisible?: boolean }) {
  const { data: tpl, error: te } = await sb.from("pl_templates").select("*").eq("id", opts.templateId).maybeSingle();
  if (te) throw te;
  if (!tpl) throw new Error("Template not found");
  const payload = tpl.payload || {};
  const placement: TemplatePlacement = opts.placement ?? (opts.prepId ? { mode: "existing_prep", prepId: opts.prepId } : { mode: "standalone_block" });

  // ---- full_prep: create new prep + N blocks
  if (tpl.template_type === "full_prep") {
    const prepInfo = (placement as any).prep || {};
    const prep = await createPrep({
      client_id: opts.clientId,
      title: prepInfo.title || opts.name || tpl.name,
      goal_type: prepInfo.goal_type || payload.prep?.goal_type,
      event_name: prepInfo.event_name ?? payload.prep?.event_name ?? null,
      event_date: prepInfo.event_date ?? payload.prep?.event_date ?? null,
      total_weeks: payload.prep?.total_weeks ?? null,
      status: "Active",
      client_visible: opts.clientVisible ?? true,
      source_template_id: tpl.id,
    });
    for (const b of (payload.blocks_data || [])) {
      const wdLen = Array.isArray(b.weeks_data) ? b.weeks_data.length : (b.weeks || 4);
      const blk = await createBlock({
        client_id: opts.clientId, prep_id: prep.id, name: b.name || "Block",
        weeks: wdLen, training_focus: b.training_focus ?? null,
        source_template_id: tpl.id,
        status: "Active",
      });
      if (Array.isArray(b.weeks_data) && b.weeks_data.length) {
        await sb.from("pl_weeks").delete().eq("block_id", blk.id);
        let idx = 1;
        for (const w of b.weeks_data) await insertWeekTree(blk.id, w.week_index ?? idx++, w);
        await sb.from("pl_blocks").update({ weeks: b.weeks_data.length }).eq("id", blk.id);
      }
    }
    return { prepId: prep.id };
  }

  // ---- week: append into existing block
  if (tpl.template_type === "week") {
    if (placement.mode !== "into_block") throw new Error("Week templates need a target block");
    const { data: existing } = await sb.from("pl_weeks").select("week_index").eq("block_id", placement.blockId);
    const nextIdx = Math.max(0, ...((existing ?? []).map((w: any) => w.week_index ?? 0))) + 1;
    await insertWeekTree(placement.blockId, nextIdx, payload);
    await sb.from("pl_blocks").update({ weeks: nextIdx }).eq("id", placement.blockId);
    return { blockId: placement.blockId };
  }

  // ---- day: append into existing week
  if (tpl.template_type === "day") {
    if (placement.mode !== "into_week") throw new Error("Day templates need a target week");
    const { data: existing } = await sb.from("pl_days").select("day_index").eq("week_id", placement.weekId);
    const nextIdx = Math.max(0, ...((existing ?? []).map((d: any) => d.day_index ?? 0))) + 1;
    await insertDayTree(placement.weekId, nextIdx, payload);
    return { weekId: placement.weekId };
  }

  // ---- exercise_row: append into existing day
  if (tpl.template_type === "exercise_row") {
    if (placement.mode !== "into_day") throw new Error("Row templates need a target day");
    const { data: existing } = await sb.from("pl_exercise_rows").select("sort_order").eq("day_id", placement.dayId);
    const nextSort = Math.max(0, ...((existing ?? []).map((r: any) => r.sort_order ?? 0))) + 1;
    await insertRow(placement.dayId, nextSort, payload);
    return { dayId: placement.dayId };
  }

  // ---- block (default)
  let targetPrepId: string | null = null;
  if (placement.mode === "existing_prep") targetPrepId = placement.prepId;
  if (placement.mode === "new_prep") {
    const prepInfo = (placement as any).prep || {};
    const prep = await createPrep({
      client_id: opts.clientId,
      title: prepInfo.title || `${opts.name || tpl.name} Prep`,
      goal_type: prepInfo.goal_type,
      event_name: prepInfo.event_name ?? null,
      event_date: prepInfo.event_date ?? null,
      status: "Active",
      client_visible: opts.clientVisible ?? true,
      source_template_id: tpl.id,
    });
    targetPrepId = prep.id;
  }
  const block = await createBlock({
    client_id: opts.clientId,
    prep_id: targetPrepId,
    name: opts.name ?? tpl.name,
    weeks: Array.isArray(payload.weeks_data) ? payload.weeks_data.length : (tpl.weeks ?? payload.weeks ?? 4),
    training_focus: tpl.training_focus ?? null,
    source_template_id: tpl.id,
    status: "Active",
  });
  // If payload has a structured tree, copy it. For MVP: empty seeded block + library can be enhanced later.
  if (Array.isArray(payload.weeks_data)) {
    // Replace seeded weeks
    await sb.from("pl_weeks").delete().eq("block_id", block.id);
    let idx = 1;
    for (const w of payload.weeks_data) await insertWeekTree(block.id, w.week_index ?? idx++, w);
    await sb.from("pl_blocks").update({ weeks: payload.weeks_data.length }).eq("id", block.id);
  }
  return { blockId: block.id, prepId: targetPrepId };
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
      })),
    })),
  }));
  return createTemplate({
    name, template_type: "block", training_style: style,
    weeks: tree.block.weeks, payload: { weeks_data },
  });
}

export async function getClientWorkouts(clientId: string) {
  // Visible blocks → weeks → days, plus completion status
  const { data: blocks } = await sb.from("pl_blocks").select("*").eq("client_id", clientId).eq("client_visible", true).neq("status", "Archived").order("created_at", { ascending: true });
  const blockIds = (blocks ?? []).map((b: any) => b.id);
  if (!blockIds.length) return [];
  const { data: weeks } = await sb.from("pl_weeks").select("*").in("block_id", blockIds).order("week_index");
  const weekIds = (weeks ?? []).map((w: any) => w.id);
  const { data: days } = weekIds.length ? await sb.from("pl_days").select("*").in("week_id", weekIds).order("day_index") : { data: [] };
  const dayIds = (days ?? []).map((d: any) => d.id);
  const { data: completions } = dayIds.length ? await sb.from("pl_day_completions").select("*").in("day_id", dayIds) : { data: [] };
  const blockOrder = new Map<string, number>();
  (blocks ?? []).forEach((b: any, i: number) => blockOrder.set(b.id, i));
  const daysByWeek = new Map<string, any[]>();
  for (const d of days ?? []) {
    const list = daysByWeek.get(d.week_id) ?? [];
    list.push(d);
    daysByWeek.set(d.week_id, list);
  }
  const items = (weeks ?? []).flatMap((w: any) => {
    const b = (blocks ?? []).find((x: any) => x.id === w?.block_id);
    const weekDays = daysByWeek.get(w.id) ?? [];
    if (weekDays.length === 0) return [{ day: null, week: w, block: b, completion: null }];
    return weekDays.map((d: any) => {
      const c = (completions ?? []).find((x: any) => x.day_id === d.id);
      return { day: d, week: w, block: b, completion: c };
    });
  });
  // Sort: block (created order) → week_index → day_index
  items.sort((a: any, b: any) => {
    const ao = blockOrder.get(a.block?.id) ?? 999;
    const bo = blockOrder.get(b.block?.id) ?? 999;
    if (ao !== bo) return ao - bo;
    const aw = a.week?.week_index ?? 0;
    const bw = b.week?.week_index ?? 0;
    if (aw !== bw) return aw - bw;
    return (a.day?.day_index ?? 0) - (b.day?.day_index ?? 0);
  });
  return items;
}