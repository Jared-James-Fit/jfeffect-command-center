/**
 * Putting a nutrition plan live for a client (the coach's own login, RLS):
 * the AI's one-tap Update plan, Use again on an earlier plan, and the
 * editor's save all go through here, so a new current plan always archives
 * the one before it (dated, never deleted) and moves the client's cardio with it.
 */
import { supabase } from "@/integrations/supabase/client";
import type { PlanSupplements } from "@/lib/nutrition-targets/supplements";
import { PHASE_GOAL } from "@/lib/nutrition-cardio";
import { resolveTrainingWeekdays } from "@/lib/cardio-prescription";
import { cardioDraftsFor, parseAiCardio, planCardioSync, type CardioDraft } from "@/lib/nutrition-cardio-sync";
import { plainOrNull } from "@/lib/nutrition-targets/plain-paste";
import { withoutCoachNotes } from "@/lib/nutrition-targets/nutrition-intel";
import { todayLocalISO } from "@/lib/today";
import {
  aiPlanDays,
  copyPlanDays,
  nextPlanDates,
  replacedEndDate,
  reusePlanPayload,
  type AiDay,
  type PlanRow,
} from "@/lib/nutrition-targets/plan-history";

const db = supabase as any;

export type CardioContext = { rows: any[]; prefs: any };

/** `client`: the database as the person acting (the server passes its own login; the app's default otherwise). */
export async function loadCardioContext(clientId: string, client: any = db): Promise<CardioContext> {
  const db = client;
  const [rows, prefs] = await Promise.all([
    db
      .from("cardio_targets")
      .select("id, day_type, status, enabled, program_name, cardio_type, duration_minutes, frequency_per_week, calorie_target_min, calorie_target_mode, updated_at")
      .eq("client_id", clientId),
    db.from("clients").select("committed_training_days, preferred_training_days, preferred_high_days").eq("id", clientId).maybeSingle(),
  ]);
  return { rows: (rows.data ?? []) as any[], prefs: (prefs.data ?? null) as any };
}

/** Each day type's cardio onto cardio_targets (only what changed). Returns what it wrote. */
export async function syncPlanCardio(
  clientId: string,
  days: Array<{ label: string; draft: CardioDraft | undefined }>,
  ctx: CardioContext,
  client: any = db,
): Promise<{ updated: number; inserted: number }> {
  const db = client;
  const sync = planCardioSync({
    clientId,
    days,
    rows: ctx.rows,
    today: todayLocalISO(),
    trainingDays: resolveTrainingWeekdays(ctx.prefs),
    highDay: Array.isArray(ctx.prefs?.preferred_high_days) ? ctx.prefs.preferred_high_days[0] ?? null : null,
  });
  // the nutrition plan's cardio outranks any other (a program's proposal, one read from the program);
  // the database then puts its training-day session on every upcoming workout (program_cardio_sync)
  if (sync.inserts.length) {
    const { error } = await db.from("cardio_targets").insert(sync.inserts.map((r: Record<string, unknown>) => ({ ...r, source: "nutrition" })));
    if (error) throw new Error(error.message);
  }
  for (const u of sync.updates) {
    const { error } = await db.from("cardio_targets").update({ ...u.patch, source: "nutrition" }).eq("id", u.id);
    if (error) throw new Error(error.message);
  }
  return { updated: sync.updates.length, inserted: sync.inserts.length };
}

/**
 * The client's other live plans become Previous plans, their end date the
 * day before the new one starts. "Updated" stays when they were last written.
 */
export async function archiveReplacedPlans(clientId: string, keepId: string, newStart: string): Promise<number> {
  const { data, error } = await db
    .from("nutrition_targets")
    .select("id, start_date, end_date, last_updated_at, updated_at")
    .eq("client_id", clientId)
    .neq("id", keepId)
    .neq("status", "Archived");
  if (error) throw new Error(error.message);
  for (const t of (data ?? []) as PlanRow[]) {
    const { error: e } = await db
      .from("nutrition_targets")
      .update({
        status: "Archived",
        end_date: replacedEndDate(t.start_date, t.end_date, newStart),
        last_updated_at: t.last_updated_at ?? t.updated_at ?? null,
      })
      .eq("id", t.id);
    if (e) throw new Error(e.message);
  }
  return (data ?? []).length;
}

/** A plan and its days, or nothing at all (a day that can't be written takes the plan back out). */
async function insertPlan(payload: Record<string, any>, days: Array<Record<string, any>>): Promise<string> {
  const { data, error } = await db.from("nutrition_targets").insert(payload).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't save the plan");
  if (days.length) {
    const rows = days.map((d, i) => ({ ...d, notes: plainOrNull(d.notes ?? null), target_id: data.id, sort_order: i }));
    const { error: e } = await db.from("nutrition_target_days").insert(rows);
    if (e) {
      await db.from("nutrition_targets").delete().eq("id", data.id);
      throw new Error(e.message);
    }
  }
  return data.id as string;
}

/** The plan the client is on now (newest live one), with its days. */
export async function loadCurrentPlan(clientId: string): Promise<PlanRow | null> {
  const { data } = await db
    .from("nutrition_targets")
    .select("*, nutrition_target_days(*)")
    .eq("client_id", clientId)
    .neq("status", "Archived")
    .order("start_date", { ascending: false })
    .limit(1);
  return (data?.[0] ?? null) as PlanRow | null;
}

export type PublishResult = { targetId: string; archived: number; cardio: { updated: number; inserted: number } | null; cardioError: string | null };

/**
 * One tap: the AI plan becomes the client's plan from today for a month. It
 * keeps what belongs to the client rather than the plan (water, notes to
 * them, the coach on it, when each day is used), and the plan before it is
 * archived with its dates.
 */
export async function publishAiPlan(input: {
  clientId: string;
  phase: string | null;
  structure: string;
  days: AiDay[];
  targetsText: string | null;
  foodWeighingRules: string | null;
  /** The supplements the coach kept in the review (supplements.ts); none = the plan before keeps its own. */
  supplements?: PlanSupplements | null;
}): Promise<PublishResult> {
  const [current, ctx] = await Promise.all([loadCurrentPlan(input.clientId), loadCardioContext(input.clientId)]);
  const now = new Date().toISOString();
  const dates = nextPlanDates(todayLocalISO());
  const phase = input.phase ?? current?.phase ?? "Maintenance";
  const payload = {
    client_id: input.clientId,
    phase,
    custom_phase: phase === "Custom" ? current?.custom_phase ?? null : null,
    goal: phase === "Custom" ? "Custom" : PHASE_GOAL[phase] ?? current?.goal ?? null,
    custom_goal: phase === "Custom" ? current?.custom_goal ?? null : null,
    structure: input.structure,
    ...dates,
    status: "Active",
    ending_soon_days: current?.ending_soon_days ?? 7,
    client_notes: current?.client_notes ?? null,
    food_weighing_rules: plainOrNull(input.foodWeighingRules),
    // COACH NOTES (the AI's reasoning and health flags) stays on the coach-only AI plan: clients can read this row.
    admin_notes: withoutCoachNotes(input.targetsText),
    visible_to_client: true,
    pdf_url: null,
    pdf_name: null,
    water: current?.water ?? "3.5 L",
    // the AI plan's supplements as reviewed, else the ones they're taking on the plan before
    supplements: input.supplements ?? current?.supplements ?? null,
    ...(current?.assigned_coach_id ? { assigned_coach_id: current.assigned_coach_id } : {}),
    last_updated_at: now,
  };
  const days = aiPlanDays(input.days, input.targetsText, current?.nutrition_target_days);
  const targetId = await insertPlan(payload, days);
  const archived = await archiveReplacedPlans(input.clientId, targetId, dates.start_date);

  // Cardio and steps move with the calories (the same sync as the editor's save).
  let cardio: PublishResult["cardio"] = null;
  let cardioError: string | null = null;
  try {
    const drafts = cardioDraftsFor({
      labels: days.map((d) => d.day_label),
      rows: ctx.rows,
      ai: parseAiCardio(input.targetsText),
      trainingDays: resolveTrainingWeekdays(ctx.prefs).length,
    });
    cardio = await syncPlanCardio(input.clientId, days.map((d) => ({ label: d.day_label, draft: drafts[d.day_label] })), ctx);
  } catch (e: any) {
    cardioError = e?.message ?? "Cardio didn't sync";
  }
  return { targetId, archived, cardio, cardioError };
}

/** Use again: an earlier plan becomes the current one from today (a copy, so the old one keeps its own dates). */
export async function reuseEarlierPlan(clientId: string, old: PlanRow): Promise<{ targetId: string; archived: number }> {
  const now = new Date().toISOString();
  const dates = nextPlanDates(todayLocalISO());
  const targetId = await insertPlan(reusePlanPayload(old, dates, now), copyPlanDays(old.nutrition_target_days));
  const archived = await archiveReplacedPlans(clientId, targetId, dates.start_date);
  return { targetId, archived };
}

/** Every plan a client has had, with its days: one cache entry for the Nutrition Plan and Plans panels. */
export function clientPlansQuery(clientId: string) {
  return {
    queryKey: ["nutrition-targets", clientId],
    queryFn: async (): Promise<PlanRow[]> => {
      const { data, error } = await db
        .from("nutrition_targets")
        .select("*, nutrition_target_days(*)")
        .eq("client_id", clientId)
        .order("start_date", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as PlanRow[];
    },
  };
}
