/**
 * "Change it with AI" on the coach's Current plan card, server side: queue the
 * coach's words against the client's current nutrition plan, write the change
 * in the background (the nutrition-plans-tick hook, the same OpenAI writer and
 * prompts as a Nutrition Update's "Change something"), and apply or undo it.
 * Nothing reaches the client until the coach applies it, and applying refuses
 * when the plan changed since the AI read it. Server only (service role, after
 * the caller's staff check in nutrition-ai-plans.functions.ts).
 */
import {
  MEAL_PLAN_PROMPT,
  NUTRITION_REQUEST_FORM_ID,
  REVISE_TARGETS_PROMPT,
  cleanAiText,
  reviseMealPlanUserPrompt,
  reviseTargetsUserPrompt,
  revisionLooksRight,
  type QA,
} from "@/lib/nutrition-ai-prompts";
import { WaitingForModel, type CallState } from "@/lib/ai/staged-call.server";
import { parseMealPlan } from "@/lib/nutrition-targets/meal-plan-parse";
import { plainOrNull } from "@/lib/nutrition-targets/plain-paste";
import {
  planAsMealPlanText,
  planAsTargetsText,
  planDays,
  readEditedPlan,
  type PlanEditDay,
} from "@/lib/nutrition-targets/plan-edit";
import {
  STALE_RUN_MS,
  loadFoodContext,
  loadQAs,
  loadTrainingPattern,
  nutritionCall,
  withShelfFix,
} from "@/lib/nutrition-ai-plans.server";

const DAY_COLUMNS =
  "day_label, calories, protein, carbs, fats, fibre, notes, sort_order, use_on, weekdays, steps";

async function loadPlan(sb: any, targetId: string) {
  const { data, error } = await sb
    .from("nutrition_targets")
    .select(
      `id, client_id, status, phase, custom_phase, food_weighing_rules, last_updated_at, nutrition_target_days(${DAY_COLUMNS})`,
    )
    .eq("id", targetId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as
    | (Parameters<typeof planDays>[0] & {
        id: string;
        client_id: string;
        status: string;
        last_updated_at: string | null;
      })
    | null;
}

/** The client's answers on their latest Nutrition Update, so a change keeps to their allergies and foods (none is fine). */
async function latestAnswers(sb: any, clientId: string): Promise<QA[]> {
  try {
    const { data } = await sb
      .from("nf_submissions")
      .select("id")
      .eq("client_id", clientId)
      .eq("form_id", NUTRITION_REQUEST_FORM_ID)
      .not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(1);
    const id = data?.[0]?.id;
    return id ? (await loadQAs(sb, id)).qas : [];
  } catch {
    return [];
  }
}

/** Queue the coach's change against the plan as it is now; an earlier unapplied answer for this plan is put away. */
export async function queuePlanEdit(
  sb: any,
  input: { clientId: string; targetId: string; instructions: string; userId: string },
): Promise<{ id: string }> {
  const plan = await loadPlan(sb, input.targetId);
  if (!plan || plan.client_id !== input.clientId) throw new Error("That plan wasn't found");
  if (plan.status === "Archived") throw new Error("That plan isn't the current one any more");
  if (!planDays(plan).length) throw new Error("This plan has no days to change yet");
  const stale = new Date(Date.now() - STALE_RUN_MS).toISOString();
  const { data: busy } = await sb
    .from("nutrition_plan_edits")
    .select("id")
    .eq("target_id", input.targetId)
    .or(`status.eq.pending,and(status.eq.generating,updated_at.gt."${stale}")`)
    .limit(1);
  if (busy?.length) throw new Error("The AI is already writing a change to this plan");
  await sb
    .from("nutrition_plan_edits")
    .update({ status: "discarded", updated_at: new Date().toISOString() })
    .eq("target_id", input.targetId)
    .in("status", ["ready", "error", "generating"]);
  const { data, error } = await sb
    .from("nutrition_plan_edits")
    .insert({
      client_id: input.clientId,
      target_id: input.targetId,
      instructions: input.instructions.trim(),
      status: "pending",
      before_targets_text: planAsTargetsText(plan),
      before_meal_plan_text: planAsMealPlanText(plan),
      created_by: input.userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't ask the AI");
  return { id: data.id };
}

/**
 * Write one change (the background writer, never a request): the targets
 * first, changed only if the words are about numbers, then the meals as asked
 * with everything else kept. An answer that doesn't read as this plan (no
 * menus, a different number of days) is an error the coach sees; a model
 * still thinking hands the run back as "pending" with its progress kept.
 */
export async function runPlanEdit(sb: any, editId: string) {
  const { data: row } = await sb
    .from("nutrition_plan_edits")
    .select("*")
    .eq("id", editId)
    .maybeSingle();
  if (!row) return { status: "missing" as const };
  const progress: CallState = row.progress ?? { calls: {}, pending: {} };
  const save = async () => {
    await sb.from("nutrition_plan_edits").update({ progress }).eq("id", editId);
  };
  try {
    const [qas, history, food] = await Promise.all([
      latestAnswers(sb, row.client_id),
      loadTrainingPattern(sb, row.client_id).catch(() => null),
      loadFoodContext(sb, row.client_id),
    ]);
    const foodNotes = food.text;
    const before = String(row.before_targets_text ?? "");
    const t = await nutritionCall(
      sb,
      progress,
      save,
      "nutrition_write",
      "edit_targets",
      REVISE_TARGETS_PROMPT,
      reviseTargetsUserPrompt(before, row.instructions),
    );
    const next = cleanAiText(t.text);
    const targetsText = revisionLooksRight("targets", before, next) ? next : before;
    const phase =
      String(row.before_meal_plan_text)
        .match(/^PHASE:\s*(.+)$/m)?.[1]
        ?.trim() ?? null;
    const mealPrompt = reviseMealPlanUserPrompt({
      qas,
      targetsText,
      mealPlanText: row.before_meal_plan_text,
      instructions: row.instructions,
      phase,
      workoutMeals: null,
      history,
      foodNotes,
      foodRestrictions: food.restrictions,
    });
    const m = await nutritionCall(
      sb,
      progress,
      save,
      "nutrition_write",
      "edit_meals",
      MEAL_PLAN_PROMPT,
      mealPrompt,
    );
    const answered = cleanAiText(m.text);
    if (!revisionLooksRight("meals", row.before_meal_plan_text, answered))
      throw new Error(
        "The AI's answer didn't come back as a meal plan. Try wording the change differently",
      );
    // the coach's words win, but a specialty food the AI brought in on its own goes back once
    const mealPlanText = await withShelfFix(
      row.before_meal_plan_text,
      answered,
      mealPrompt,
      (prompt) =>
        nutritionCall(
          sb,
          progress,
          save,
          "nutrition_write",
          "edit_shelf",
          MEAL_PLAN_PROMPT,
          prompt,
        ).then((r) => r.text),
      [...qas, { value: row.instructions }, ...(foodNotes ? [{ value: foodNotes }] : [])],
      food.allergens,
    );
    const want = parseMealPlan(row.before_meal_plan_text).length;
    const got = parseMealPlan(mealPlanText).length;
    if (want !== got)
      throw new Error(
        `The AI's answer has ${got} ${got === 1 ? "day" : "days"} where the plan has ${want}. Try wording the change differently`,
      );
    const now = new Date().toISOString();
    await sb
      .from("nutrition_plan_edits")
      .update({
        status: "ready",
        targets_text: targetsText,
        meal_plan_text: mealPlanText,
        model: `targets ${t.model} · meals ${m.model}`,
        progress: null,
        error: null,
        updated_at: now,
      })
      .eq("id", editId)
      .eq("status", "generating");
    return { status: "ready" as const };
  } catch (e: any) {
    if (e instanceof WaitingForModel) {
      await sb
        .from("nutrition_plan_edits")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("id", editId)
        .eq("status", "generating");
      return { status: "pending" as const };
    }
    const msg = String(e?.message ?? e).slice(0, 500);
    await sb
      .from("nutrition_plan_edits")
      .update({ status: "error", error: msg, progress: null, updated_at: new Date().toISOString() })
      .eq("id", editId)
      .eq("status", "generating");
    return { status: "error" as const, error: msg };
  }
}

/**
 * The background writer's turn for plan changes: claim one (by id, or the
 * oldest waiting or cut-off one from the last 2 days) with a single
 * conditional update, so two runs never write the same change.
 */
export async function runQueuedPlanEdit(sb: any, editId?: string | null) {
  const stale = new Date(Date.now() - STALE_RUN_MS).toISOString();
  let id = editId ?? null;
  if (!id) {
    const since = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
    const { data } = await sb
      .from("nutrition_plan_edits")
      .select("id")
      .gte("updated_at", since)
      .or(`status.eq.pending,and(status.eq.generating,updated_at.lt."${stale}")`)
      .order("updated_at", { ascending: true })
      .limit(1);
    id = data?.[0]?.id ?? null;
  }
  if (!id) return { status: "idle" as const };
  const { data: claimed } = await sb
    .from("nutrition_plan_edits")
    .update({ status: "generating", error: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .or(`status.eq.pending,and(status.eq.generating,updated_at.lt."${stale}")`)
    .select("id")
    .maybeSingle();
  if (!claimed) return { status: "skipped" as const, editId: id };
  return { ...(await runPlanEdit(sb, id)), editId: id };
}

/** The plan's days without ids, as they'd be inserted again. */
function dayRows(days: PlanEditDay[], targetId: string) {
  return days.map((d, i) => ({
    target_id: targetId,
    day_label: d.day_label,
    calories: d.calories ?? null,
    protein: d.protein ?? null,
    carbs: d.carbs ?? null,
    fats: d.fats ?? null,
    fibre: d.fibre ?? null,
    notes: plainOrNull(d.notes ?? null),
    sort_order: i,
    use_on: d.use_on ?? null,
    weekdays: d.weekdays ?? null,
    steps: d.steps ?? null,
  }));
}

async function writeDays(
  sb: any,
  targetId: string,
  days: PlanEditDay[],
  rules: string | null,
  now: string,
) {
  const { error: delError } = await sb
    .from("nutrition_target_days")
    .delete()
    .eq("target_id", targetId);
  if (delError) throw new Error(delError.message);
  const { error } = await sb.from("nutrition_target_days").insert(dayRows(days, targetId));
  if (error) throw new Error(error.message);
  const { error: planError } = await sb
    .from("nutrition_targets")
    .update({ food_weighing_rules: plainOrNull(rules), last_updated_at: now })
    .eq("id", targetId);
  if (planError) throw new Error(planError.message);
}

/**
 * Apply a written change to the plan, in place (like Edit this plan): only
 * while the plan is still the client's and reads exactly as it did when the
 * AI read it, so a change never lands on a plan someone edited since. The
 * days and weighing rules from before are kept on the change for Undo.
 */
export async function applyPlanEdit(sb: any, editId: string, userId: string) {
  const { data: edit } = await sb
    .from("nutrition_plan_edits")
    .select("*")
    .eq("id", editId)
    .maybeSingle();
  if (!edit) throw new Error("That change wasn't found");
  if (edit.status === "applied") throw new Error("That change is already on the plan");
  if (edit.status !== "ready") throw new Error("That change isn't ready");
  const plan = await loadPlan(sb, edit.target_id);
  if (!plan || plan.status === "Archived")
    throw new Error(
      "That plan isn't the client's current plan any more. Ask again on the current one",
    );
  if (
    planAsMealPlanText(plan) !== edit.before_meal_plan_text ||
    planAsTargetsText(plan) !== edit.before_targets_text
  )
    throw new Error(
      "The plan changed since you asked. Ask again so the AI works from the plan as it is now",
    );
  const edited = readEditedPlan(plan, edit.meal_plan_text, edit.targets_text);
  const restore = { days: planDays(plan), food_weighing_rules: plan.food_weighing_rules ?? null };
  const now = new Date().toISOString();
  try {
    await writeDays(sb, plan.id, edited.days, edited.foodWeighingRules, now);
  } catch (e: any) {
    // put the plan back as it was before saying it failed
    await writeDays(
      sb,
      plan.id,
      restore.days,
      restore.food_weighing_rules,
      plan.last_updated_at ?? now,
    ).catch(() => undefined);
    throw new Error(`The plan wasn't changed: ${e?.message ?? "error"}`);
  }
  await sb
    .from("nutrition_plan_edits")
    .update({ status: "applied", applied_at: now, applied_by: userId, restore, updated_at: now })
    .eq("id", editId);
  return { clientId: plan.client_id as string, targetId: plan.id };
}

/** Put the plan back as it was before an applied change, while nothing else has changed it since. */
export async function undoPlanEdit(sb: any, editId: string) {
  const { data: edit } = await sb
    .from("nutrition_plan_edits")
    .select("*")
    .eq("id", editId)
    .maybeSingle();
  if (!edit || edit.status !== "applied" || !edit.restore) throw new Error("Nothing to undo");
  const plan = await loadPlan(sb, edit.target_id);
  if (!plan || plan.status === "Archived")
    throw new Error("That plan isn't the client's current plan any more");
  const at = (v: string | null | undefined) => (v ? new Date(v).getTime() : 0);
  if (Math.abs(at(plan.last_updated_at) - at(edit.applied_at)) > 1000)
    throw new Error(
      "The plan changed after the AI's change, so it can't be undone here. Edit the plan instead",
    );
  await writeDays(
    sb,
    plan.id,
    edit.restore.days ?? [],
    edit.restore.food_weighing_rules ?? null,
    new Date().toISOString(),
  );
  await sb
    .from("nutrition_plan_edits")
    .update({ status: "undone", updated_at: new Date().toISOString() })
    .eq("id", editId);
  return { clientId: plan.client_id as string, targetId: plan.id };
}

/** Put a written (or failed) change away without applying it. */
export async function discardPlanEdit(sb: any, editId: string) {
  const { error } = await sb
    .from("nutrition_plan_edits")
    .update({ status: "discarded", updated_at: new Date().toISOString() })
    .eq("id", editId)
    .in("status", ["ready", "error", "pending", "generating"]);
  if (error) throw new Error(error.message);
  return { ok: true };
}
