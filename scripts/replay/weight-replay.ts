/**
 * Replays the weight-management read (loadWeightManagement → buildAssessment)
 * on a read-only snapshot of production rows, one client at a time, through
 * the real loader and engine (memory-sb.ts stands in for the database).
 *
 *   npx tsx scripts/replay/weight-replay.ts <snapshot.json> [today]
 *
 * The snapshot is a query_database result: rows[0].dump = { <client>: { <table>: rows } }.
 * It holds client data: keep it outside the repository.
 */
import { readFileSync } from "node:fs";
import { memorySb } from "./memory-sb";
import { loadWeightManagement } from "@/lib/weight-management/load.server";

const [file, todayArg] = process.argv.slice(2);
const dump = JSON.parse(readFileSync(file, "utf8")).rows[0].dump as Record<string, Record<string, any[] | null>>;
const today = todayArg ?? new Date().toISOString().slice(0, 10);

const r1 = (n: number | null | undefined) => (n == null ? "—" : Math.round(n * 10) / 10);

for (const [key, tables] of Object.entries(dump)) {
  const t: Record<string, any[]> = {};
  // as of a day: nothing logged after it (dated rows only; plans and goals as they are now)
  const DATED: Record<string, string> = { progress_bodyweight: "logged_date", progress_metrics: "entry_date", messenger_checkins: "submitted_at", cardio_completions: "completed_date", progress_water_entries: "entry_date", progress_measurements: "measured_date", pl_row_results: "completed_at", nutrition_targets: "start_date" };
  for (const [name, rows] of Object.entries(tables)) t[name] = (rows ?? []).filter((r) => !DATED[name] || r[DATED[name]] == null || String(r[DATED[name]]).slice(0, 10) <= today);
  const clientId = t.clients[0].id;
  try {
    const { assessment: a } = await loadWeightManagement(memorySb(t), clientId, { today });
    const tr = a.trajectory;
    const rec = a.recommendation;
    console.log(
      JSON.stringify({
        client: key,
        context: a.context,
        dir: a.direction,
        goal: a.goal ? `${a.goal.source} ${r1(a.goal.kg)}kg ${a.goal.date ?? ""}` : null,
        meetWeeks: r1(a.meetWeeksOut),
        status: tr.status,
        trendPctWk: r1((tr as any).trend?.pctPerWeek ?? null),
        noiseKg: r1((tr as any).trend?.noiseKg ?? null),
        stale: (tr as any).stale ?? null,
        fluct: (tr as any).fluctuation ? (tr as any).fluctuation.kind ?? true : null,
        verdict: rec.verdict,
        limiting: rec.limiting,
        material: rec.material,
        headline: rec.headline,
        actions: rec.actions.map((x: any) => `${x.kind}${x.kcalPerDay ? `:${x.kcalPerDay}` : ""}`),
        reasons: rec.reasons.slice(0, 3),
        water: a.hydration.restricted ? "restricted" : `${a.hydration.restMl}/${a.hydration.trainingMl}ml`,
        cardio: a.cardio.modality,
        digestion: a.digestion.summary ?? null,
        checkins: { n: (a.checkins as any).count ?? null, adherence: r1((a.checkins as any).adherence ?? null) },
      }),
    );
  } catch (e: any) {
    console.log(JSON.stringify({ client: key, error: String(e?.message ?? e) }));
  }
}
