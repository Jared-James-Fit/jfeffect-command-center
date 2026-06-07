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

export async function createPrep(input: { client_id: string; title: string; goal_type?: string; event_name?: string | null; event_date?: string | null; total_weeks?: number | null; status?: PrepStatus; client_visible?: boolean }) {
  const { data, error } = await sb.from("pl_preps").insert(input).select("*").single();
  if (error) throw error;
  return data;
}

export async function createBlock(input: { client_id: string; prep_id?: string | null; name: string; weeks: number; training_focus?: string | null; week_start_index?: number | null }) {
  const { data: block, error } = await sb.from("pl_blocks").insert(input).select("*").single();
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

export async function listTemplates(opts: { type?: TemplateType | "all"; style?: TrainingStyle | "all"; q?: string }) {
  let q = sb.from("pl_templates").select("*").eq("archived", false);
  if (opts.type && opts.type !== "all") q = q.eq("template_type", opts.type);
  if (opts.style && opts.style !== "all") q = q.eq("training_style", opts.style);
  if (opts.q) q = q.ilike("name", `%${opts.q}%`);
  const { data, error } = await q.order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createTemplate(input: { name: string; template_type: TemplateType; training_style: TrainingStyle; training_focus?: string; goal?: string; notes?: string; weeks?: number; days_per_week?: number; payload?: any }) {
  const { data, error } = await sb.from("pl_templates").insert(input).select("*").single();
  if (error) throw error;
  return data;
}

export async function applyTemplateToClient(opts: { templateId: string; clientId: string; prepId?: string | null; name?: string }) {
  const { data: tpl, error: te } = await sb.from("pl_templates").select("*").eq("id", opts.templateId).maybeSingle();
  if (te) throw te;
  if (!tpl) throw new Error("Template not found");
  const payload = tpl.payload || {};
  const block = await createBlock({
    client_id: opts.clientId,
    prep_id: opts.prepId ?? null,
    name: opts.name ?? tpl.name,
    weeks: tpl.weeks ?? payload.weeks ?? 4,
    training_focus: tpl.training_focus ?? null,
  });
  // If payload has a structured tree, copy it. For MVP: empty seeded block + library can be enhanced later.
  if (Array.isArray(payload.weeks_data)) {
    // Replace seeded weeks
    await sb.from("pl_weeks").delete().eq("block_id", block.id);
    for (const w of payload.weeks_data) {
      const { data: newWeek } = await sb.from("pl_weeks").insert({ block_id: block.id, week_index: w.week_index, notes: w.notes ?? null }).select("*").single();
      for (const d of (w.days || [])) {
        const { data: newDay } = await sb.from("pl_days").insert({ week_id: newWeek.id, day_index: d.day_index, title: d.title ?? null, focus: d.focus ?? null, notes: d.notes ?? null }).select("*").single();
        for (const r of (d.rows || [])) {
          await sb.from("pl_exercise_rows").insert({
            day_id: newDay.id, sort_order: r.sort_order ?? 0, exercise_id: r.exercise_id ?? null,
            exercise_name_override: r.exercise_name_override ?? null, sets: r.sets ?? null, reps_text: r.reps_text ?? null,
            rpe: r.rpe ?? null, rir: r.rir ?? null, percentage: r.percentage ?? null, percentage_basis: r.percentage_basis ?? null,
            load_kg: r.load_kg ?? null, load_lb: r.load_lb ?? null, rest_seconds: r.rest_seconds ?? null,
            tempo: r.tempo ?? null, time_profile: r.time_profile ?? "accessory_compound", notes: r.notes ?? null,
          });
        }
      }
    }
  }
  return block;
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
  const { data: blocks } = await sb.from("pl_blocks").select("*").eq("client_id", clientId).eq("client_visible", true).neq("status", "Archived").order("created_at", { ascending: false });
  const blockIds = (blocks ?? []).map((b: any) => b.id);
  if (!blockIds.length) return [];
  const { data: weeks } = await sb.from("pl_weeks").select("*").in("block_id", blockIds).order("week_index");
  const weekIds = (weeks ?? []).map((w: any) => w.id);
  const { data: days } = weekIds.length ? await sb.from("pl_days").select("*").in("week_id", weekIds).order("day_index") : { data: [] };
  const dayIds = (days ?? []).map((d: any) => d.id);
  const { data: completions } = dayIds.length ? await sb.from("pl_day_completions").select("*").in("day_id", dayIds) : { data: [] };
  return (days ?? []).map((d: any) => {
    const w = (weeks ?? []).find((x: any) => x.id === d.week_id);
    const b = (blocks ?? []).find((x: any) => x.id === w?.block_id);
    const c = (completions ?? []).find((x: any) => x.day_id === d.id);
    return { day: d, week: w, block: b, completion: c };
  });
}