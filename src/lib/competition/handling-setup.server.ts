import { infoComplete, readAthleteInfo, stepsFor, STEP_LABEL } from "./athlete-info";

/** Read only after the caller's access to clientId has been checked. No AI or writes. */
export async function loadHandlingSetup(db: any, clientId: string) {
  const { data: handling, error } = await db.from("competition_handling")
    .select("competition_id, status, terms_accepted_at, cancelled_at, completed_at")
    .eq("client_id", clientId).is("cancelled_at", null).is("completed_at", null);
  if (error) throw new Error("Could not load competition setup");
  const active = (handling ?? []).filter((h: any) => !["cancelled", "completed"].includes(h.status));
  if (!active.length) return [];
  const { data: meets, error: meetError } = await db.from("competitions")
    .select("id, name, meet_date, sport, athlete_info, internal_test")
    .eq("client_id", clientId).eq("status", "upcoming").in("id", active.map((h: any) => h.competition_id))
    .order("meet_date", { ascending: true });
  if (meetError) throw new Error("Could not load competition setup");
  return (meets ?? []).filter((m: any) => !m.internal_test).map((m: any) => {
    const h = active.find((r: any) => r.competition_id === m.id);
    const info = readAthleteInfo(m.athlete_info);
    const steps = stepsFor({ sport: m.sport ?? "powerlifting", handled: true });
    const intakeDone = infoComplete(info, steps);
    const termsDone = !!h?.terms_accepted_at;
    return {
      id: String(m.id), name: String(m.name), date: String(m.meet_date),
      intakeDone, termsDone, done: intakeDone && termsDone,
      remaining: steps.filter(s => s === "confirm" ? !termsDone || (!intakeDone && !info.steps?.[s]) : !intakeDone && !info.steps?.[s]).map(s => STEP_LABEL[s]),
    };
  }) as { id: string; name: string; date: string; intakeDone: boolean; termsDone: boolean; done: boolean; remaining: string[] }[];
}
