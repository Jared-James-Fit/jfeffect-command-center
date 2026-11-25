/**
 * A weekly check-in's plan, worked out once from the client's records and
 * kept on the check-in (messenger_checkins.plan), so the client sees the same
 * steps on every device and the coach sees exactly what was asked and why.
 * Best-effort: a table that can't be read leaves that part out, never the
 * check-in itself.
 */
import { NUTRITION_REQUEST_FORM_ID } from "@/lib/nutrition-request";
import { planCheckin, type CheckinPlan, type PlanInput, type ProgressSchedule } from "@/lib/checkin-coordination/plan";
import { foldGaps, foldOptions, type FoldQuestion } from "@/lib/checkin-coordination/nutrition-fold";
import { checkinProfileAsk, keyForLabel, normalizeLifestyle, type ChoiceField } from "@/lib/client-context/lifestyle";
import { PROFILE_ASK_KEY } from "@/lib/checkin-coordination/steps";

async function safe<T>(run: () => PromiseLike<{ data: T | null; error?: unknown }>, fallback: T): Promise<T> {
  try {
    const r = await run();
    return r && !r.error && r.data != null ? r.data : fallback;
  } catch {
    return fallback;
  }
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The Nutrition Update side of a check-in's plan: asked when, answered last when, and the form's options. */
export async function loadNutritionSide(sb: any, clientId: string, due: string, foldedAt: string | null) {
  const [asked, lastSub, questions] = await Promise.all([
    safe<any[]>(
      () =>
        sb
          .from("messages")
          .select("created_at")
          .eq("client_id", clientId)
          .gte("created_at", `${addDays(due, -14)}T00:00:00Z`)
          .contains("attachments", JSON.stringify([{ kind: "form_request", form_id: NUTRITION_REQUEST_FORM_ID }]))
          .order("created_at", { ascending: false })
          .limit(1),
      [],
    ),
    safe<any[]>(() => sb.from("nf_submissions").select("id, submitted_at").eq("client_id", clientId).eq("form_id", NUTRITION_REQUEST_FORM_ID).neq("status", "in_progress").not("submitted_at", "is", null).order("submitted_at", { ascending: false }).limit(1), []),
    safe<FoldQuestion[]>(() => sb.from("nf_questions").select("id, label, question_type, options, validation, required").eq("form_id", NUTRITION_REQUEST_FORM_ID).is("archived_at", null), []),
  ]);
  // what their last one answered: it can carry this month's only when nothing required is missing
  const lastAnswered = lastSub[0]?.id
    ? await safe<any[]>(() => sb.from("nf_answers").select("question_id").eq("submission_id", lastSub[0].id), [])
    : [];
  const gaps = lastSub[0] ? foldGaps(questions, lastAnswered.map((a) => String(a.question_id))) : { foldable: false, askFreeMeal: false };
  // asked: a request in their chat, or this month's folded into this very check-in
  const askedAt = [asked[0]?.created_at, foldedAt].filter(Boolean).map(String).sort().pop() ?? null;
  const lastAt: string | null = lastSub[0]?.submitted_at ?? null;
  const answeredAfter = !!(askedAt && lastAt && String(lastAt) >= askedAt);
  return {
    nutritionPendingSince: askedAt && !answeredAfter ? askedAt.slice(0, 10) : null,
    nutritionLastAnswered: lastAt && gaps.foldable ? String(lastAt).slice(0, 10) : null,
    nutritionOptions: questions.length ? foldOptions(questions) : null,
    nutritionAskFreeMeal: gaps.foldable && gaps.askFreeMeal,
  };
}

export async function loadPlanInput(sb: any, clientId: string, due: string, foldedAt: string | null = null): Promise<PlanInput | null> {
  const { data: c } = await sb.from("clients").select("id, user_id, sex, bodyweight_goal_type, bodyweight_goal_date").eq("id", clientId).maybeSingle();
  if (!c) return null;
  const uid: string | null = c.user_id ?? null;
  const [bw, preps, photos, tape, schedules, nutrition, plans, roadmap, lifestyle] = await Promise.all([
    uid ? safe<any[]>(() => sb.from("progress_bodyweight").select("logged_date").eq("user_id", uid).lte("logged_date", due).order("logged_date", { ascending: false }).limit(14), []) : Promise.resolve([]),
    safe<any[]>(() => sb.from("pl_preps").select("event_name, title, event_date, weight_class, archived, status").eq("client_id", clientId).gte("event_date", due).order("event_date").limit(3), []),
    uid ? safe<any[]>(() => sb.from("progress_submissions").select("submission_date").eq("user_id", uid).eq("submission_type", "photo").order("submission_date", { ascending: false }).limit(1), []) : Promise.resolve([]),
    uid ? safe<any[]>(() => sb.from("progress_measurements").select("measured_date").eq("user_id", uid).order("measured_date", { ascending: false }).limit(1), []) : Promise.resolve([]),
    uid ? safe<any[]>(() => sb.from("progress_check_in_schedules").select("kind, enabled, frequency, custom_days").eq("user_id", uid), []) : Promise.resolve([]),
    loadNutritionSide(sb, clientId, due, foldedAt),
    safe<any[]>(() => sb.from("nutrition_targets").select("phase, status, start_date").eq("client_id", clientId).neq("status", "Archived").order("start_date", { ascending: false }).limit(1), []),
    // the roadmap's follow-ups, only once the coach approved a roadmap
    safe<any>(() => sb.from("nutrition_roadmaps").select("asks, next_checkin_reason, active_revision_id").eq("client_id", clientId).maybeSingle(), null),
    // their work & lifestyle profile: one missing answer may ride on the check-in (null when unreadable: nothing asked)
    safe<any>(() => sb.from("client_lifestyle").select("*").eq("client_id", clientId).maybeSingle().then((r: any) => (r?.error ? r : { data: r?.data ?? {} })), null),
  ]);
  const ask = lifestyle ? checkinProfileAsk(normalizeLifestyle(lifestyle)) : null;
  const meet = preps.find((p) => !p.archived && !/cancel/i.test(String(p.status ?? ""))) ?? null;
  return {
    due,
    phase: plans[0]?.phase ?? null,
    nutritionLastAnswered: nutrition.nutritionLastAnswered,
    nutritionOptions: nutrition.nutritionOptions,
    lastWeighIn: bw[0]?.logged_date ?? null,
    weighInsLast7: bw.filter((b) => b.logged_date > addDays(due, -7)).length,
    meet: meet ? { date: String(meet.event_date).slice(0, 10), weightClass: meet.weight_class ?? null, name: meet.event_name || meet.title || null } : null,
    goal: c.bodyweight_goal_type ? { type: c.bodyweight_goal_type, date: c.bodyweight_goal_date ?? null } : null,
    lastPhotos: photos[0]?.submission_date ? String(photos[0].submission_date).slice(0, 10) : null,
    lastMeasurements: tape[0]?.measured_date ? String(tape[0].measured_date).slice(0, 10) : null,
    schedules: schedules.map((s) => ({ kind: s.kind, enabled: !!s.enabled, frequency: s.frequency, customDays: s.custom_days ?? null })) as ProgressSchedule[],
    nutritionPendingSince: nutrition.nutritionPendingSince,
    profileAsk: ask?.options ? { field: ask.field, prompt: ask.prompt, options: ask.options } : null,
    roadmap: roadmap?.active_revision_id && Array.isArray(roadmap.asks) && roadmap.asks.length ? { asks: roadmap.asks.map(String), reason: roadmap.next_checkin_reason ?? null, sex: /^f/i.test(String(c.sex ?? "")) ? "F" : /^m/i.test(String(c.sex ?? "")) ? "M" : null } : null,
  };
}

/**
 * The check-in's plan: the stored one when it has one, else worked out now
 * and stored (only on a pending check-in: a submitted one keeps what it asked).
 * `due` is the occurrence's local due date, else the day it was sent.
 */
export async function ensureCheckinPlan(admin: any, row: { id: string; client_id: string; status: string; plan?: CheckinPlan | null; created_at: string; occurrence_id?: string | null; nutrition_requested_at?: string | null }): Promise<CheckinPlan | null> {
  if (row.plan && (row.plan as CheckinPlan).version) {
    // An open check-in keeps its steps, but this month's Nutrition Update can be folded in after it was
    // first opened (the sender runs a few minutes after the card): the nutrition part is read again.
    if (row.status !== "pending") return row.plan as CheckinPlan;
    return refreshNutrition(admin, row, row.plan as CheckinPlan);
  }
  if (row.status !== "pending") return null;
  let due = String(row.created_at).slice(0, 10);
  if (row.occurrence_id) {
    const { data: occ } = await admin.from("client_task_occurrences").select("due_local_date").eq("id", row.occurrence_id).maybeSingle();
    if (occ?.due_local_date) due = String(occ.due_local_date).slice(0, 10);
  }
  const input = await loadPlanInput(admin, row.client_id, due, row.nutrition_requested_at ?? null);
  if (!input) return null;
  const plan = planCheckin(input);
  // first writer wins: a second device opening it at the same moment reads the stored one
  const { data: saved } = await admin.from("messenger_checkins").update({ plan }).eq("id", row.id).is("plan", null).select("plan").maybeSingle();
  if (saved?.plan) return saved.plan as CheckinPlan;
  const { data: again } = await admin.from("messenger_checkins").select("plan").eq("id", row.id).maybeSingle();
  return (again?.plan as CheckinPlan | null) ?? plan;
}

/** The stored plan with its Nutrition Update part read again (added, made inline, or dropped once answered). */
async function refreshNutrition(admin: any, row: { id: string; client_id: string; created_at: string; nutrition_requested_at?: string | null }, plan: CheckinPlan): Promise<CheckinPlan> {
  const due = String(row.created_at).slice(0, 10);
  const side = await loadNutritionSide(admin, row.client_id, due, row.nutrition_requested_at ?? null).catch(() => null);
  if (!side) return plan;
  const fresh = planCheckin({ due, lastWeighIn: due, weighInsLast7: 1, meet: null, goal: null, lastPhotos: null, lastMeasurements: null, schedules: [], ...side });
  const next = fresh.extras.find((e) => e.key === "nutrition_update") ?? null;
  const prev = plan.extras.find((e) => e.key === "nutrition_update") ?? null;
  if (JSON.stringify(next) === JSON.stringify(prev)) return plan;
  const updated: CheckinPlan = { ...plan, extras: [...plan.extras.filter((e) => e.key !== "nutrition_update"), ...(next ? [next] : [])] };
  await admin.from("messenger_checkins").update({ plan: updated }).eq("id", row.id).eq("status", "pending");
  return updated;
}

/**
 * A submitted check-in's one profile question: an answer is saved to their
 * profile as theirs (client_reported, history kept by the database), and a skip
 * rests it (CHECKIN_DISMISS_DAYS; two
 * skips and the check-in never asks it again). Best-effort: the check-in itself
 * never fails over it. Service role, after the submit handler checked the client.
 */
export async function applyCheckinProfileAnswer(admin: any, row: { client_id: string; plan?: CheckinPlan | null }, answers: Record<string, unknown>): Promise<void> {
  const extra = (row.plan as CheckinPlan | null)?.extras?.find((e) => e.key === "profile");
  if (!extra?.field) return;
  const field = extra.field as ChoiceField;
  try {
    const { data: cur } = await admin.from("client_lifestyle").select("*").eq("client_id", row.client_id).maybeSingle();
    const l = normalizeLifestyle(cur ?? {});
    const now = new Date().toISOString();
    const st = l.prompt_state[field] ?? {};
    const value = keyForLabel(field, answers[PROFILE_ASK_KEY]);
    const body: Record<string, unknown> = { last_source: "client_reported" };
    // "Prefer not to say" is employment's own answer: stored as given, so it's never asked again
    if (value) body[field] = value;
    body.prompt_state = {
      ...l.prompt_state,
      [field]: value ? { ...st, asked_at: now } : { ...st, asked_at: now, dismissed_at: now, dismissals: (st.dismissals ?? 0) + 1 },
    };
    if (cur) await admin.from("client_lifestyle").update(body).eq("client_id", row.client_id);
    else await admin.from("client_lifestyle").insert({ client_id: row.client_id, ...body });
  } catch (e: any) {
    console.warn("[checkin] profile answer not saved", e?.message);
  }
}
