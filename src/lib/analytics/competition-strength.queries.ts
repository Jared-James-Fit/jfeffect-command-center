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
import { asAthleteSex, type AthleteSex } from "@/lib/athlete-sex";

const LB_PER_KG = 2.2046226;

export type CompetitionData = {
  meets: MeetResult[];
  trainingMaxes: Partial<Record<CompLift, { lb: number; date: string | null }>>;
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
      .select("lift, one_rm, estimated_1rm, unit, tested_at, updated_at")
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

  const trainingMaxes: CompetitionData["trainingMaxes"] = {};
  for (const m of (maxRes.data ?? []) as any[]) {
    const lift = compLiftFromName(m.lift);
    const raw = Number(m.one_rm ?? m.estimated_1rm);
    if (!lift || !(raw > 0)) continue;
    const lb = m.unit === "kg" ? raw * LB_PER_KG : raw;
    const date = m.tested_at ?? m.updated_at ?? null;
    const cur = trainingMaxes[lift];
    // the most recently set one: a training max is the coach's current number
    if (!cur || (date ?? "") > (cur.date ?? "")) trainingMaxes[lift] = { lb, date };
  }
  const profileSex = asAthleteSex((clientRes.data as any)?.sex);
  const asSex = (v: unknown) => {
    const s = String(v ?? "").toLowerCase();
    return s.startsWith("f") ? "female" : s.startsWith("m") ? "male" : null;
  };
  const meets = meetsFromRows(meetRows ?? []);
  return {
    meets,
    trainingMaxes,
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
