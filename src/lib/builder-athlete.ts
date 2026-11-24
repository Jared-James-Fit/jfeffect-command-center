/**
 * What the program editor knows about the athlete whose block it's editing
 * (client side, the coach's own login, so RLS decides): their session limit
 * (booked PT hour or Goals & Setup, session-limit.ts), their equipment (the
 * coach-confirmed profile, else Goals & Setup), pain reported after workouts
 * in the last 12 weeks read once per place (pain-read.ts), and what kind of
 * program they're on. Small reads only: Program Intelligence's full history
 * isn't needed to check a block. Every part is best-effort: one that can't be
 * read is left out, never guessed.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { bookedSessionLength } from "@/lib/program-intel/context";
import { itemsFromGoals } from "@/lib/program-intel/equipment";
import { consolidatePain, type PainPlace } from "@/lib/program-intel/pain-read";
import { sessionLimit, type SessionLimit } from "@/lib/program-intel/session-limit";
import type { EquipmentItem } from "@/lib/program-intel/types";
import type { ProgramStyle } from "@/lib/program-check";

export type BuilderAthlete = {
  sessionLimit: SessionLimit;
  equipment: { items: EquipmentItem[]; confidence: "confirmed" | "stated" | "unknown" } | null;
  pain: PainPlace[];
  style: ProgramStyle;
};

const sb = supabase as any;

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function styleFrom(brain: string | null | undefined, words: string): ProgramStyle {
  const b = (brain ?? "").toLowerCase();
  if (b === "powerlifting" || b === "powerbuilding" || b === "bodybuilding") return b;
  if (b === "general_strength") return "strength";
  if (b === "general_fitness" || b === "hybrid") return "general";
  const t = words.toLowerCase();
  if (/powerbuild/.test(t)) return "powerbuilding";
  if (/powerlift|compet|meet/.test(t)) return "powerlifting";
  if (/bodybuild|physique|hypertroph|build muscle|muscle|glute/.test(t)) return "bodybuilding";
  if (/run|marathon|\b5k\b|\b10k\b/.test(t)) return "running";
  if (/rehab|injur/.test(t)) return "rehab";
  if (/strength|strong/.test(t)) return "strength";
  return t.trim() ? "general" : null;
}

/** `db`: the coach's own client (default) or, on the server, the service role after an access check. */
export async function loadBuilderAthlete(clientId: string, today = new Date().toISOString().slice(0, 10), db: any = sb): Promise<BuilderAthlete> {
  const [goals, profile, pt, feedback] = await Promise.all([
    safe(async () => {
      const { data } = await db.from("client_goals_setup").select("workout_length_minutes, equipment, training_styles, main_goal, main_goal_other").eq("client_id", clientId).maybeSingle();
      return data ?? null;
    }, null as any),
    safe(async () => {
      const { data } = await db.from("program_intel_profiles").select("brain_override, equipment_profile").eq("client_id", clientId).maybeSingle();
      return data ?? null;
    }, null as any),
    safe(async () => {
      const { data } = await db.from("pt_sessions").select("starts_at, ends_at, status").eq("client_id", clientId).gte("starts_at", `${addDays(today, -56)}T00:00:00Z`).lte("starts_at", `${addDays(today, 28)}T23:59:59Z`).limit(200);
      return data ?? [];
    }, [] as any[]),
    safe(async () => {
      const { data } = await db.from("pl_workout_feedback").select("created_at, pain_area, pain_level, pain_note, client_note").eq("client_id", clientId).eq("pain", true).gte("created_at", `${addDays(today, -84)}T00:00:00Z`).order("created_at").limit(300);
      return data ?? [];
    }, [] as any[]),
  ]);
  const booked = bookedSessionLength(pt);
  const prof = profile?.equipment_profile ?? null;
  let equipment: BuilderAthlete["equipment"] = null;
  if (prof?.items?.length && prof.confirmedAt) equipment = { items: prof.items, confidence: "confirmed" };
  else {
    const g = itemsFromGoals(goals?.equipment ?? null);
    if (g.items.length) equipment = { items: g.items, confidence: "stated" };
  }
  const pain = consolidatePain(
    feedback.map((f: any) => ({ date: String(f.created_at).slice(0, 10), area: f.pain_area ?? null, level: f.pain_level ?? null, note: [f.pain_note, f.client_note].filter(Boolean).join(" · ") || null })),
  );
  const words = [...(goals?.training_styles ?? []), goals?.main_goal, goals?.main_goal_other].filter(Boolean).join(" ");
  return {
    sessionLimit: sessionLimit({ goalsMinutes: goals?.workout_length_minutes ?? null, ptMinutes: booked.minutes }),
    equipment,
    pain,
    style: styleFrom(profile?.brain_override, words),
  };
}

export function useBuilderAthlete(clientId: string | null | undefined) {
  return useQuery({
    queryKey: ["builder-athlete", clientId],
    queryFn: () => loadBuilderAthlete(clientId as string),
    enabled: !!clientId,
    staleTime: 5 * 60_000,
  });
}

/** A template's style, from its training style setting. */
export function templateStyle(trainingStyle: string | null | undefined): ProgramStyle {
  const t = (trainingStyle ?? "").toLowerCase();
  if (t === "powerlifting" || t === "bodybuilding" || t === "rehab") return t;
  if (t === "strength") return "strength";
  if (t === "hybrid" || t === "lifestyle" || t === "conditioning") return "general";
  return null;
}
