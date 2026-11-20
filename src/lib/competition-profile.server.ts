// Server-only: a sent form's competition answers (the age classes and weight
// class questions it synced, validation.prefill) written back to the athlete's
// competition profile, so the coach has what they said and the next form
// starts from it. Called with the service role after the submission is checked
// as the athlete's own (app-events.functions.ts). Only what the form answered
// changes; a form that asked neither leaves the profile alone. Never throws.
import type { SupabaseClient } from "@supabase/supabase-js";
import { profileFromAnswers } from "@/lib/competition-profile";

type Db = SupabaseClient<any, any, any>;

const SYNCED = new Set(["age_class", "weight_class", "meet_weight_class"]);

export async function syncCompetitionProfile(db: Db, submissionId: string): Promise<{ weightClass?: string; ageClasses?: string[] } | null> {
  try {
    const { data: s } = await db.from("nf_submissions").select("id, client_id, form_id, status").eq("id", submissionId).maybeSingle();
    if (!s || (s as any).status === "in_progress") return null;
    const sub = s as { id: string; client_id: string; form_id: string };
    const { data: qs } = await db.from("nf_questions").select("id, question_type, validation").eq("form_id", sub.form_id).is("archived_at", null);
    const synced = ((qs ?? []) as any[]).filter((q) => SYNCED.has(String(q.validation?.prefill ?? "")));
    if (!synced.length) return null;
    const { data: as } = await db
      .from("nf_answers")
      .select("question_id, value_text, value_number, value_json")
      .eq("submission_id", sub.id)
      .in("question_id", synced.map((q) => q.id));
    const found = profileFromAnswers(synced, (as ?? []) as any[]);
    if (found.weightClass == null && found.ageClasses == null) return null;
    const row: Record<string, unknown> = { client_id: sub.client_id, source: "form", source_submission_id: sub.id };
    if (found.weightClass != null) row.weight_class = found.weightClass;
    if (found.ageClasses != null) row.age_classes = found.ageClasses;
    const { error } = await db.from("athlete_competition_profiles" as any).upsert(row, { onConflict: "client_id" });
    if (error) throw new Error(error.message);
    return found;
  } catch (e) {
    console.error("[competition profile] couldn't write back", e);
    return null;
  }
}
