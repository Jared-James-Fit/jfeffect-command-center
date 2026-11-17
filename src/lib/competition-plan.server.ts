// Server-only: a submitted Competition Calendar + Strategy form becomes the
// athlete's structured plan (athlete_competition_plans) for the coach to
// approve. Called with the service role after the submission is checked as
// the athlete's own (app-events.functions.ts). Never touches a program.
import type { SupabaseClient } from "@supabase/supabase-js";
import { COMPETITION_FORM_TYPE, competitionPlanFromAnswers, planChanges, type CompetitionPlan } from "@/lib/competition-plan";

type Db = SupabaseClient<any, any, any>;

/** True when the form is a competition strategy form. */
export async function isCompetitionForm(db: Db, formId: string): Promise<boolean> {
  const { data } = await db.from("nf_forms").select("form_type").eq("id", formId).maybeSingle();
  return (data as any)?.form_type === COMPETITION_FORM_TYPE;
}

/**
 * Read the submission into a plan and keep it (once per submission: a second
 * call refreshes the same row while the coach hasn't reviewed it). What
 * changed is against their last approved plan, else their last one.
 */
export async function recordCompetitionPlan(db: Db, submissionId: string): Promise<{ id: string; changes: string[] } | null> {
  const { data: s } = await db.from("nf_submissions").select("id, client_id, form_id, status").eq("id", submissionId).maybeSingle();
  if (!s || (s as any).status === "in_progress") return null;
  const sub = s as { id: string; client_id: string; form_id: string };
  if (!(await isCompetitionForm(db, sub.form_id))) return null;
  const [{ data: qs, error: qe }, { data: as, error: ae }] = await Promise.all([
    db.from("nf_questions").select("id, validation").eq("form_id", sub.form_id),
    db.from("nf_answers").select("question_id, value_text, value_number, value_json").eq("submission_id", sub.id),
  ]);
  if (qe || ae) throw new Error((qe ?? ae)!.message);
  const plan = competitionPlanFromAnswers((qs ?? []) as any[], (as ?? []) as any[]);

  const { data: earlier } = await db
    .from("athlete_competition_plans" as any)
    .select("plan, status, created_at, submission_id")
    .eq("client_id", sub.client_id)
    .neq("status", "dismissed")
    .order("created_at", { ascending: false })
    .limit(10);
  const others = ((earlier ?? []) as any[]).filter((r) => r.submission_id !== sub.id);
  const base = others.find((r) => r.status === "approved") ?? others[0] ?? null;
  const changes = planChanges((base?.plan as CompetitionPlan | undefined) ?? null, plan);

  const { data: existing } = await db
    .from("athlete_competition_plans" as any)
    .select("id, status")
    .eq("submission_id", sub.id)
    .maybeSingle();
  if (existing) {
    if ((existing as any).status !== "submitted") return { id: (existing as any).id, changes };
    const { error } = await db.from("athlete_competition_plans" as any).update({ plan, changes }).eq("id", (existing as any).id);
    if (error) throw new Error(error.message);
    return { id: (existing as any).id, changes };
  }
  const { data: row, error } = await db
    .from("athlete_competition_plans" as any)
    .insert({ client_id: sub.client_id, submission_id: sub.id, plan, changes, status: "submitted" })
    .select("id")
    .single();
  if (error) {
    // Two submits at once: the other one wrote it.
    if ((error as any).code === "23505") return null;
    throw new Error(error.message);
  }
  return { id: (row as any).id, changes };
}
