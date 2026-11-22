/**
 * What the strength chart and "Your total" read besides the logged sets:
 * meet results, the coach's training maxes and the athlete's sex (for the
 * typical split), read with the viewer's own login (RLS decides).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { compLiftFromName } from "@/lib/analytics/sbd-split";
import {
  meetsFromRows,
  type CompLift,
  type MeetResult,
} from "@/lib/analytics/competition-strength";
import { maxesFromRows, type MaxOnFile } from "@/lib/analytics/analytics-areas";
import { asAthleteSex, type AthleteSex } from "@/lib/athlete-sex";

const LB_PER_KG = 2.2046226;

export type CompetitionData = {
  meets: MeetResult[];
  /**
   * The coach's training max per lift (`pl_client_maxes.training_max`, the
   * number % loads read): never a 1RM and never an estimate of the athlete.
   */
  trainingMaxes: Partial<Record<CompLift, { lb: number; date: string | null }>>;
  /** Every competition-lift max on file, each said for what it is (tested / entered / training max). */
  maxes: MaxOnFile[];
  sex: "male" | "female" | null;
  profileSex: AthleteSex | null;
};

async function loadCompetitionData(clientId: string): Promise<CompetitionData> {
  const [athleteRes, maxRes, clientRes] = await Promise.all([
    supabase
      .from("powerlifting_athletes")
      .select("id, sex")
      .eq("client_id", clientId)
      .maybeSingle(),
    supabase
      .from("pl_client_maxes")
      .select("lift, one_rm, training_max, source, unit, tested_at, updated_at")
      .eq("client_id", clientId)
      .eq("active", true),
    supabase.from("clients").select("sex").eq("id", clientId).maybeSingle(),
  ]);
  const athlete = athleteRes.data as { id: string; sex: string | null } | null;
  const { data: meetRows } = await supabase
    .from("athlete_powerlifting_results")
    .select("squat_kg, bench_kg, deadlift_kg, total_kg, bodyweight_kg, meet_date, meet_name, sex")
    .or(
      athlete ? `client_id.eq.${clientId},athlete_id.eq.${athlete.id}` : `client_id.eq.${clientId}`,
    )
    .not("meet_date", "is", null)
    .order("meet_date", { ascending: false })
    .limit(60);

  // Three kinds of number live in pl_client_maxes and they're never the same thing:
  // a tested 1RM (source "tested" or a test date), a 1RM a coach typed in with no
  // test date, and the training max the program reads % loads from. Before Nov 22
  // 2026 the screen called whichever was newest "Training max" (Jared's "600"
  // deadlift was an entered 1RM; his real training max column was empty).
  const trainingMaxes: CompetitionData["trainingMaxes"] = {};
  const maxes = maxesFromRows((maxRes.data ?? []) as any[], compLiftFromName);
  for (const m of maxes) if (m.kind === "training_max") trainingMaxes[m.lift] = { lb: m.lb, date: m.date };
  const profileSex = asAthleteSex((clientRes.data as any)?.sex);
  const asSex = (v: unknown) => {
    const s = String(v ?? "").toLowerCase();
    return s.startsWith("f") ? "female" : s.startsWith("m") ? "male" : null;
  };
  const meets = meetsFromRows(meetRows ?? []);
  return {
    meets,
    trainingMaxes,
    maxes,
    sex:
      profileSex === "male" || profileSex === "female"
        ? profileSex
        : profileSex === "unspecified"
          ? null
          : ((asSex(athlete?.sex) ?? asSex((meetRows as any[] | null)?.[0]?.sex)) as
              | "male"
              | "female"
              | null),
    profileSex,
  };
}

export function useCompetitionData(clientId: string, enabled = true) {
  return useQuery({
    queryKey: ["competition-data", clientId],
    enabled: !!clientId && enabled,
    staleTime: 5 * 60_000,
    queryFn: () => loadCompetitionData(clientId),
  });
}
