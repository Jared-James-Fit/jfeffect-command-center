/**
 * A weekly check-in's plan, worked out once from the client's records and
 * kept on the check-in (messenger_checkins.plan), so the client sees the same
 * steps on every device and the coach sees exactly what was asked and why.
 * Best-effort: a table that can't be read leaves that part out, never the
 * check-in itself.
 */
import { NUTRITION_REQUEST_FORM_ID } from "@/lib/nutrition-ai-prompts";
import { planCheckin, type CheckinPlan, type PlanInput, type ProgressSchedule } from "@/lib/checkin-coordination/plan";

async function safe<T>(run: () => PromiseLike<{ data: T | null; error?: unknown }>, fallback: T): Promise<T> {
  try {
    const r = await run();
    return r && !r.error && r.data != null ? r.data : fallback;
  } catch {
    return fallback;
  }
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function loadPlanInput(sb: any, clientId: string, due: string): Promise<PlanInput | null> {
  const { data: c } = await sb.from("clients").select("id, user_id, bodyweight_goal_type, bodyweight_goal_date").eq("id", clientId).maybeSingle();
  if (!c) return null;
  const uid: string | null = c.user_id ?? null;
  const [bw, preps, photos, tape, schedules, asked, answered] = await Promise.all([
    uid ? safe<any[]>(() => sb.from("progress_bodyweight").select("logged_date").eq("user_id", uid).lte("logged_date", due).order("logged_date", { ascending: false }).limit(14), []) : Promise.resolve([]),
    safe<any[]>(() => sb.from("pl_preps").select("event_name, title, event_date, weight_class, archived, status").eq("client_id", clientId).gte("event_date", due).order("event_date").limit(3), []),
    uid ? safe<any[]>(() => sb.from("progress_submissions").select("submission_date").eq("user_id", uid).eq("submission_type", "photo").order("submission_date", { ascending: false }).limit(1), []) : Promise.resolve([]),
    uid ? safe<any[]>(() => sb.from("progress_measurements").select("measured_date").eq("user_id", uid).order("measured_date", { ascending: false }).limit(1), []) : Promise.resolve([]),
    uid ? safe<any[]>(() => sb.from("progress_check_in_schedules").select("kind, enabled, frequency, custom_days").eq("user_id", uid), []) : Promise.resolve([]),
    safe<any[]>(
      () =>
        sb
          .from("messages")
          .select("created_at")
          .eq("client_id", clientId)
          .gte("created_at", `${addDays(due, -14)}T00:00:00Z`)
          .contains("attachments", [{ kind: "form_request", form_id: NUTRITION_REQUEST_FORM_ID }])
          .order("created_at", { ascending: false })
          .limit(1),
      [],
    ),
    safe<any[]>(() => sb.from("nf_submissions").select("submitted_at").eq("client_id", clientId).eq("form_id", NUTRITION_REQUEST_FORM_ID).neq("status", "in_progress").gte("submitted_at", `${addDays(due, -14)}T00:00:00Z`).limit(1), []),
  ]);
  const meet = preps.find((p) => !p.archived && !/cancel/i.test(String(p.status ?? ""))) ?? null;
  const askedAt: string | null = asked[0]?.created_at ?? null;
  const answeredAfter = askedAt && answered.some((s) => String(s.submitted_at) >= askedAt);
  return {
    due,
    lastWeighIn: bw[0]?.logged_date ?? null,
    weighInsLast7: bw.filter((b) => b.logged_date > addDays(due, -7)).length,
    meet: meet ? { date: String(meet.event_date).slice(0, 10), weightClass: meet.weight_class ?? null, name: meet.event_name || meet.title || null } : null,
    goal: c.bodyweight_goal_type ? { type: c.bodyweight_goal_type, date: c.bodyweight_goal_date ?? null } : null,
    lastPhotos: photos[0]?.submission_date ? String(photos[0].submission_date).slice(0, 10) : null,
    lastMeasurements: tape[0]?.measured_date ? String(tape[0].measured_date).slice(0, 10) : null,
    schedules: schedules.map((s) => ({ kind: s.kind, enabled: !!s.enabled, frequency: s.frequency, customDays: s.custom_days ?? null })) as ProgressSchedule[],
    nutritionPendingSince: askedAt && !answeredAfter ? askedAt.slice(0, 10) : null,
  };
}

/**
 * The check-in's plan: the stored one when it has one, else worked out now
 * and stored (only on a pending check-in: a submitted one keeps what it asked).
 * `due` is the occurrence's local due date, else the day it was sent.
 */
export async function ensureCheckinPlan(admin: any, row: { id: string; client_id: string; status: string; plan?: CheckinPlan | null; created_at: string; occurrence_id?: string | null }): Promise<CheckinPlan | null> {
  if (row.plan && (row.plan as CheckinPlan).version) return row.plan as CheckinPlan;
  if (row.status !== "pending") return null;
  let due = String(row.created_at).slice(0, 10);
  if (row.occurrence_id) {
    const { data: occ } = await admin.from("client_task_occurrences").select("due_local_date").eq("id", row.occurrence_id).maybeSingle();
    if (occ?.due_local_date) due = String(occ.due_local_date).slice(0, 10);
  }
  const input = await loadPlanInput(admin, row.client_id, due);
  if (!input) return null;
  const plan = planCheckin(input);
  // first writer wins: a second device opening it at the same moment reads the stored one
  const { data: saved } = await admin.from("messenger_checkins").update({ plan }).eq("id", row.id).is("plan", null).select("plan").maybeSingle();
  if (saved?.plan) return saved.plan as CheckinPlan;
  const { data: again } = await admin.from("messenger_checkins").select("plan").eq("id", row.id).maybeSingle();
  return (again?.plan as CheckinPlan | null) ?? plan;
}
