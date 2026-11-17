/**
 * After a weekly check-in that answered this month's Nutrition Update inside
 * it (nutrition-fold.ts): the submission the form would have made, written
 * with the service role, linked to the check-in (messenger_checkins.
 * nutrition_submission_id), and the AI targets and meal plan queued exactly as
 * for the form. Nothing here changes a plan: the coach still reviews and
 * publishes. Never throws; a fold that can't happen leaves the check-in sent,
 * and the Nutrition Update sender offers the form itself instead.
 */
import { NUTRITION_REQUEST_FORM_ID } from "@/lib/nutrition-ai-prompts";
import { answeredNutrition, foldNutritionAnswers, type FoldAnswer, type FoldQuestion } from "@/lib/checkin-coordination/nutrition-fold";
import { loadNutritionSide } from "@/lib/checkin-coordination/plan.server";
import type { PrefillProfile } from "@/lib/form-prefill";


function localDay(tz: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "America/Winnipeg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const daysApart = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);

export async function foldNutritionUpdate(
  admin: any,
  row: { id: string; client_id: string; created_at: string; nutrition_requested_at?: string | null },
  answers: Record<string, unknown>,
): Promise<string | null> {
  try {
    if (!answeredNutrition(answers)) return null;
    // only while one is actually waiting: a stale screen never makes an update nobody asked for
    const side = await loadNutritionSide(admin, row.client_id, String(row.created_at).slice(0, 10), row.nutrition_requested_at ?? null);
    if (!side.nutritionPendingSince || !side.nutritionLastAnswered) return null;

    const [{ data: client }, { data: questions }, { data: lastSubs }] = await Promise.all([
      admin.from("clients").select("id, user_id, sex, height_cm, preferred_height_unit, preferred_weight_unit, committed_training_days, timezone").eq("id", row.client_id).maybeSingle(),
      admin.from("nf_questions").select("id, label, question_type, options, validation, order_index").eq("form_id", NUTRITION_REQUEST_FORM_ID).is("archived_at", null).order("order_index"),
      admin.from("nf_submissions").select("id").eq("client_id", row.client_id).eq("form_id", NUTRITION_REQUEST_FORM_ID).neq("status", "in_progress").not("submitted_at", "is", null).order("submitted_at", { ascending: false }).limit(1),
    ]);
    const last = (lastSubs ?? [])[0];
    if (!client || !questions?.length || !last) return null;
    const { data: lastAnswers } = await admin.from("nf_answers").select("question_id, value_text, value_number, value_json").eq("submission_id", last.id);

    // this week's weigh-in (the check-in asks for one when there's none): last month's weight is never carried
    const today = localDay(client.timezone);
    const [{ data: bw }, { data: legacy }] = await Promise.all([
      client.user_id
        ? admin.from("progress_bodyweight").select("logged_date, weight_value, weight_unit").eq("user_id", client.user_id).order("logged_date", { ascending: false }).limit(1).maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from("progress_metrics").select("entry_date, bodyweight, bodyweight_unit").eq("client_id", row.client_id).not("bodyweight", "is", null).order("entry_date", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const a = bw?.weight_value != null ? { date: String(bw.logged_date).slice(0, 10), value: Number(bw.weight_value), unit: bw.weight_unit === "kg" ? "kg" : "lb" } : null;
    const b = legacy?.bodyweight != null ? { date: String(legacy.entry_date).slice(0, 10), value: Number(legacy.bodyweight), unit: legacy.bodyweight_unit === "kg" ? "kg" : "lb" } : null;
    const latest = a && b ? (b.date > a.date ? b : a) : a ?? b;
    const fresh = latest && daysApart(latest.date, today) <= 7 && daysApart(latest.date, today) >= 0;
    const profile: PrefillProfile = {
      sex: client.sex ?? null,
      height_cm: client.height_cm ?? null,
      preferred_height_unit: client.preferred_height_unit ?? null,
      has_nutrition_plan: true,
      bodyweight: latest && fresh ? { value: latest.value, unit: latest.unit as "kg" | "lb", date: latest.date, fresh: true } : null,
    };
    const days = Array.isArray(client.committed_training_days) ? client.committed_training_days.length : null;

    const rows: FoldAnswer[] = foldNutritionAnswers({
      questions: questions as FoldQuestion[],
      last: (lastAnswers ?? []) as FoldAnswer[],
      profile,
      trainingDays: days && days > 0 ? days : null,
      checkin: answers,
      day: today,
    });
    if (!rows.length) return null;

    // one copy: a draft they started on the form itself becomes this one
    const { data: drafts } = await admin.from("nf_submissions").select("id").eq("client_id", row.client_id).eq("form_id", NUTRITION_REQUEST_FORM_ID).eq("status", "in_progress").order("created_at", { ascending: false }).limit(1);
    let submissionId: string | null = (drafts ?? [])[0]?.id ?? null;
    if (!submissionId) {
      const { data: v } = await admin.from("nf_form_versions").select("id, version_number").eq("form_id", NUTRITION_REQUEST_FORM_ID).order("version_number", { ascending: false }).limit(1).maybeSingle();
      const { data: created, error } = await admin
        .from("nf_submissions")
        .insert({ form_id: NUTRITION_REQUEST_FORM_ID, client_id: row.client_id, period_start: null, status: "in_progress", form_version_id: v?.id ?? null, form_version_number: v?.version_number ?? null })
        .select("id")
        .single();
      if (error || !created) throw new Error(error?.message ?? "couldn't start the submission");
      submissionId = created.id as string;
    }
    const { error: ansErr } = await admin.from("nf_answers").upsert(
      rows.map((r) => ({ ...r, submission_id: submissionId })),
      { onConflict: "submission_id,question_id" },
    );
    if (ansErr) throw new Error(ansErr.message);
    const now = new Date().toISOString();
    const { error: subErr } = await admin.from("nf_submissions").update({ status: "pending_review", submitted_at: now }).eq("id", submissionId);
    if (subErr) throw new Error(subErr.message);
    await admin.from("messenger_checkins").update({ nutrition_submission_id: submissionId }).eq("id", row.id);

    // the AI targets and meal plan, queued the same way the form queues them (nothing applies itself)
    try {
      const { startNutritionPlan } = await import("@/lib/nutrition-ai-plans.server");
      await startNutritionPlan(admin, submissionId);
    } catch (e) {
      console.error("[nutrition fold] couldn't queue the plan", e);
    }
    return submissionId;
  } catch (e) {
    console.error("[nutrition fold] failed", e);
    return null;
  }
}
