/**
 * The form library's reads (the coach's own session: RLS decides what they
 * see). Shared by the Forms page and the chat's form picker so a star or a
 * new form shows in both at once.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formSuggestions, type LibraryForm, type RecentSend, type Suggestion } from "@/lib/form-library";
import { COMPETITION_FORM_ID } from "@/lib/competition-plan";
import { MEET_CHECKLIST_FORM_ID } from "@/lib/meet-checklist";

const db = supabase as any;

export const FORM_LIBRARY_KEY = ["form-library"] as const;

export function useLibraryForms(enabled = true) {
  return useQuery({
    queryKey: FORM_LIBRARY_KEY,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<LibraryForm[]> => {
      const { data, error } = await db
        .from("nf_forms")
        .select("id, title, description, category, kind, active, archived, owner_id, shared, is_template, form_type, allow_updates, settings, created_at, updated_at")
        .order("title");
      if (error) throw error;
      return (data ?? []) as LibraryForm[];
    },
  });
}

export function useFormFavorites(userId: string | null | undefined) {
  return useQuery({
    queryKey: ["form-favorites", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db.from("nf_form_favorites").select("form_id").eq("user_id", userId);
      if (error) throw error;
      return new Set(((data ?? []) as Array<{ form_id: string }>).map((r) => r.form_id));
    },
  });
}

/** Star or unstar a form; the cache flips at once and puts itself back if the save fails. */
export function useToggleFavorite(userId: string | null | undefined) {
  const qc = useQueryClient();
  return async (formId: string, on: boolean) => {
    const key = ["form-favorites", userId];
    const prev = qc.getQueryData<Set<string>>(key);
    const next = new Set(prev ?? []);
    if (on) next.add(formId);
    else next.delete(formId);
    qc.setQueryData(key, next);
    const { error } = on
      ? await db.from("nf_form_favorites").insert({ form_id: formId, user_id: userId })
      : await db.from("nf_form_favorites").delete().eq("form_id", formId).eq("user_id", userId);
    if (error && !(on && error.code === "23505")) {
      qc.setQueryData(key, prev);
      throw error;
    }
  };
}

/** What this coach sent most recently (their own sends, newest first). */
export function useRecentSends(userId: string | null | undefined) {
  return useQuery({
    queryKey: ["form-recent-sends", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<RecentSend[]> => {
      const { data, error } = await db
        .from("nf_assignments")
        .select("form_id, last_sent_at")
        .eq("last_sent_by", userId)
        .order("last_sent_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as RecentSend[];
    },
  });
}

/**
 * nf_form_library_stats(): per form, the people it's out with on the responses
 * viewer's rule (form-response-status.ts): sent = answered (done) + in_progress
 * + waiting; responses and to_review count every response sent in.
 */
export type FormStats = {
  questions: number;
  sent: number;
  done: number;
  waiting: number;
  in_progress?: number;
  responses?: number;
  to_review?: number;
  last_sent_at: string | null;
  last_response_at?: string | null;
};

export function useFormLibraryStats(enabled = true) {
  return useQuery({
    queryKey: ["form-library-stats"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("nf_form_library_stats");
      if (error) throw error;
      return new Map<string, FormStats>(((data ?? []) as any[]).map((r) => [r.form_id, r]));
    },
  });
}

/**
 * What to suggest sending this client now (form-library.ts formSuggestions):
 * read from their next meet, what was already sent and their competition plan.
 */
export function useFormSuggestions(clientId: string | null | undefined, forms: LibraryForm[]) {
  return useQuery({
    queryKey: ["form-suggestions", clientId, forms.length],
    enabled: !!clientId && forms.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Suggestion[]> => {
      const today = new Date().toLocaleDateString("en-CA");
      const [{ data: client }, { data: preps }, { data: plans }, { data: sent }] = await Promise.all([
        db.from("clients").select("status, is_powerlifter").eq("id", clientId).maybeSingle(),
        db.from("pl_preps").select("event_date, archived, status").eq("client_id", clientId).gte("event_date", today).order("event_date").limit(3),
        db.from("athlete_competition_plans").select("plan, status, created_at").eq("client_id", clientId).neq("status", "dismissed").order("created_at", { ascending: false }).limit(1),
        db.from("nf_assignments").select("form_id, last_sent_at, updated_at, created_at").eq("client_id", clientId).in("form_id", [MEET_CHECKLIST_FORM_ID, COMPETITION_FORM_ID]),
      ]);
      const plan = (plans ?? [])[0];
      const planMeets = [plan?.plan?.primary, ...((plan?.plan?.meets ?? []) as any[])]
        .map((m: any) => m?.date)
        .filter((d: unknown): d is string => typeof d === "string" && d >= today)
        .sort();
      const prep = ((preps ?? []) as any[]).find((p) => !p.archived && p.status !== "Archived");
      const nextMeetDate = prep?.event_date ?? planMeets[0] ?? null;
      const sentRow = ((sent ?? []) as any[]).find((r) => r.form_id === MEET_CHECKLIST_FORM_ID);
      const recentPlan = plan && Date.now() - Date.parse(plan.created_at) < 365 * 86_400_000;
      return formSuggestions({
        today,
        nextMeetDate,
        meetChecklistSentAt: sentRow ? sentRow.last_sent_at ?? sentRow.updated_at ?? sentRow.created_at : null,
        hasCompetitionPlan: !!recentPlan || ((sent ?? []) as any[]).some((r) => r.form_id === COMPETITION_FORM_ID && Date.now() - Date.parse(r.updated_at ?? r.created_at) < 60 * 86_400_000),
        competes: !!client?.is_powerlifter || !!nextMeetDate,
        isLead: client?.status === "Lead",
        forms,
      });
    },
  });
}

/** Upcoming meets to pick from when sending a meet checklist: their meet preps and competition plan. */
export function useUpcomingMeets(clientId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["form-upcoming-meets", clientId],
    enabled: !!clientId && enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const today = new Date().toLocaleDateString("en-CA");
      const [{ data: preps }, { data: plans }] = await Promise.all([
        db.from("pl_preps").select("title, event_name, event_date, weight_class, archived, status").eq("client_id", clientId).gte("event_date", today).order("event_date").limit(5),
        db.from("athlete_competition_plans").select("plan").eq("client_id", clientId).neq("status", "dismissed").order("created_at", { ascending: false }).limit(1),
      ]);
      const out: Array<{ name: string; date: string | null; weight_class: string | null; from: string }> = [];
      for (const p of (preps ?? []) as any[]) {
        if (p.archived || p.status === "Archived") continue;
        out.push({ name: (p.event_name || p.title || "Meet").trim(), date: p.event_date, weight_class: p.weight_class ?? null, from: "Meet prep" });
      }
      const plan = (plans ?? [])[0]?.plan;
      for (const m of [plan?.primary, ...((plan?.meets ?? []) as any[])]) {
        if (!m?.date || m.date < today) continue;
        const name = (m.name || m.level || "Meet").trim();
        if (out.some((o) => o.date === m.date && o.name.toLowerCase() === name.toLowerCase())) continue;
        out.push({ name, date: m.date, weight_class: plan?.weightClass ?? null, from: "Competition plan" });
      }
      return out.sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 5);
    },
  });
}

export function usePrepCompetitions(clientId: string | null | undefined, enabled: boolean) {
  return useQuery({queryKey:["prep-form-competitions",clientId],enabled:!!clientId&&enabled,staleTime:60_000,queryFn:async()=>{
    const {data,error}=await db.from("competitions").select("id,name,meet_date").eq("client_id",clientId).order("meet_date",{ascending:false}).limit(30);
    if(error)throw error;
    return (data??[]) as {id:string;name:string;meet_date:string|null}[];
  }});
}
