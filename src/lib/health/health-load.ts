/**
 * Reads what a client's health profile is built from (health-profile.ts), with
 * whatever session it's given: the coach's own (RLS decides) in the app, the
 * service role in a background worker. Every read is optional: one that fails
 * is left out, never stops a plan or a program.
 *
 * `forms: true` also reads their Nutrition Updates' health answers (health,
 * allergies, "anything I missed", supplements, budget) and the coach's
 * "no longer applies" marks, for callers without a food history of their own
 * (Program Intelligence). The nutrition AI passes its own food history instead.
 */
import { NUTRITION_REQUEST_FORM_ID, type QA } from "@/lib/nutrition-ai-prompts";
import { formAnswerText } from "@/lib/form-answer-text";
import { buildFoodHistory, type FoodHistory } from "@/lib/nutrition-targets/food-history";
import { buildHealthProfile, PAIN_WEEKS, type HealthItem, type HealthProfile, type HealthSettings } from "@/lib/health/health-profile";

export type HealthRecords = {
  items: HealthItem[];
  settings: HealthSettings | null;
  goals: {
    injuries_has: boolean | null;
    injuries_details: string | null;
    food_restrictions_has: boolean | null;
    food_restrictions_details: string | null;
    updated_at: string | null;
    completed_at: string | null;
  } | null;
  clientInjuries: Array<string | null>;
  pain: Array<{ date: string | null; area: string | null; level: number | null }>;
  /** With `forms`: every Nutrition Update's health-related answers, oldest first. */
  updates: Array<{ at: string; answers: QA[] }>;
  dismissed: Array<{ kind: "allergy" | "diet" | "health"; key: string; at: string }>;
};

const HEALTH_QUESTION = /allerg|health|medication|anything|missed|need to know|supplement|spend/i;

export async function loadHealthRecords(sb: any, clientId: string, opts: { forms?: boolean; today?: string } = {}): Promise<HealthRecords> {
  const ok = <T,>(r: { data: T | null; error?: unknown } | null | undefined, fallback: T): T => (r && !r.error && r.data != null ? r.data : fallback);
  const safe = async <T,>(run: () => PromiseLike<{ data: T | null; error?: unknown }>, fallback: T): Promise<T> => {
    try {
      return ok(await run(), fallback);
    } catch {
      return fallback;
    }
  };
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const painSince = new Date(Date.parse(`${today}T00:00:00Z`) - PAIN_WEEKS * 7 * 86_400_000).toISOString();

  const [items, settings, goals, client, pain] = await Promise.all([
    safe<any[]>(() => sb.from("client_health_items").select("*").eq("client_id", clientId).order("updated_at", { ascending: false }).limit(300), []),
    safe<any>(() => sb.from("client_health_profiles").select("drug_tested, federation, supplement_budget").eq("client_id", clientId).maybeSingle(), null),
    safe<any>(
      () =>
        sb
          .from("client_goals_setup")
          .select("injuries_has, injuries_details, food_restrictions_has, food_restrictions_details, updated_at, completed_at")
          .eq("client_id", clientId)
          .maybeSingle(),
      null,
    ),
    safe<any>(() => sb.from("clients").select("injuries, intake_injuries").eq("id", clientId).maybeSingle(), null),
    safe<any[]>(
      () =>
        sb
          .from("pl_workout_feedback")
          .select("created_at, pain_area, pain_level")
          .eq("client_id", clientId)
          .eq("pain", true)
          .gte("created_at", painSince)
          .order("created_at", { ascending: false })
          .limit(200),
      [],
    ),
  ]);

  let updates: HealthRecords["updates"] = [];
  let dismissed: HealthRecords["dismissed"] = [];
  if (opts.forms) {
    const [subs, questions, marks] = await Promise.all([
      safe<any[]>(
        () =>
          sb
            .from("nf_submissions")
            .select("id, submitted_at")
            .eq("client_id", clientId)
            .eq("form_id", NUTRITION_REQUEST_FORM_ID)
            .neq("status", "in_progress")
            .not("submitted_at", "is", null)
            .order("submitted_at", { ascending: true })
            .limit(200),
        [],
      ),
      safe<any[]>(() => sb.from("nf_questions").select("id, label").eq("form_id", NUTRITION_REQUEST_FORM_ID), []),
      safe<any[]>(() => sb.from("client_food_history_dismissals").select("kind, key, created_at").eq("client_id", clientId), []),
    ]);
    const wanted = questions.filter((q) => HEALTH_QUESTION.test(String(q.label ?? "")));
    const ids = subs.map((s) => s.id);
    const answers: any[] = [];
    if (wanted.length) {
      for (let i = 0; i < ids.length; i += 100) {
        answers.push(
          ...(await safe<any[]>(
            () =>
              sb
                .from("nf_answers")
                .select("submission_id, question_id, value_text, value_number, value_json")
                .in("submission_id", ids.slice(i, i + 100))
                .in(
                  "question_id",
                  wanted.map((q) => q.id),
                ),
            [],
          )),
        );
      }
    }
    updates = subs.map((s) => {
      const mine = new Map(answers.filter((a) => a.submission_id === s.id).map((a) => [a.question_id, a]));
      return { at: String(s.submitted_at), answers: wanted.map((q) => ({ label: String(q.label), value: mine.has(q.id) ? formAnswerText(mine.get(q.id)) : "" })) };
    });
    dismissed = marks.map((d) => ({ kind: d.kind, key: d.key, at: d.created_at }));
  }

  return {
    items: items as HealthItem[],
    settings: settings ? { drug_tested: settings.drug_tested ?? null, federation: settings.federation ?? null, supplement_budget: settings.supplement_budget ?? null } : null,
    goals: goals ?? null,
    clientInjuries: [client?.injuries ?? null, client?.intake_injuries ?? null],
    pain: pain.map((p) => ({ date: String(p.created_at ?? "").slice(0, 10) || null, area: p.pain_area ?? null, level: p.pain_level ?? null })),
    updates,
    dismissed,
  };
}

/** Active allergy and condition items, as the food history reads them. */
export function profileItemsForFood(items: HealthItem[]) {
  return items
    .filter((i) => i.status !== "resolved" && (i.kind === "allergy" || i.kind === "condition"))
    .map((i) => ({ kind: i.kind, label: i.label, details: i.details, at: i.updated_at || i.created_at, source: i.source }));
}

/**
 * The profile from what loadHealthRecords read, with the food history it
 * brings (or the caller's own, which already holds every Nutrition Update).
 */
export function healthProfileFromRecords(
  rec: HealthRecords,
  today: string,
  own: { food?: FoodHistory | null; latest?: { at: string; answers: QA[] } | null } = {},
): HealthProfile {
  const history =
    own.food ??
    buildFoodHistory({
      updates: rec.updates,
      goals: rec.goals ? { food_restrictions_has: rec.goals.food_restrictions_has, food_restrictions_details: rec.goals.food_restrictions_details, updated_at: rec.goals.updated_at } as any : null,
      dismissed: rec.dismissed,
      profileItems: profileItemsForFood(rec.items),
      today,
    });
  return buildHealthProfile({
    items: rec.items,
    settings: rec.settings,
    food: history,
    goals: rec.goals,
    clientInjuries: rec.clientInjuries,
    latest: own.latest !== undefined ? own.latest : rec.updates.length ? rec.updates[rec.updates.length - 1] : null,
    pain: rec.pain,
    today,
  });
}
