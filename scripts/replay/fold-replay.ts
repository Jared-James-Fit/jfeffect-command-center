/**
 * Runs the check-in's Nutrition Update fold (foldNutritionUpdate, the real
 * server code) on a snapshot of one client's records, in memory: prints what
 * it would write and never touches a database. The snapshot holds client
 * data: keep it outside the repository.
 *
 *   npx tsx scripts/replay/fold-replay.ts <snapshot.json>
 */
import { readFileSync } from "node:fs";
import { memorySb } from "./memory-sb";
import { foldNutritionUpdate } from "@/lib/checkin-coordination/nutrition-fold.server";
import { roleOf } from "@/lib/checkin-coordination/nutrition-fold";

const dump = JSON.parse(readFileSync(process.argv[2], "utf8")).rows[0].dump as Record<string, any[] | null>;

async function run(name: string, answers: Record<string, unknown>) {
  const tables: Record<string, any[]> = {};
  for (const [k, v] of Object.entries(dump)) if (k !== "pad") tables[k] = JSON.parse(JSON.stringify(v ?? []));
  const client = tables.clients[0];
  const checkin = { id: "checkin-1", client_id: client.id, created_at: new Date().toISOString(), status: "completed", nutrition_requested_at: new Date().toISOString() };
  tables.messenger_checkins = [checkin];
  const sb = memorySb(tables);
  const id = await foldNutritionUpdate(sb, checkin, answers);
  const q = new Map((tables.nf_questions ?? []).map((x: any) => [x.id, x]));
  const answersWritten = sb.writes.filter((w) => w.table === "nf_answers").flatMap((w) => w.rows);
  console.log(`\n== ${name}: submission ${id ? "written" : "NOT written"}`);
  for (const w of sb.writes) console.log(`  ${w.op} ${w.table} ${w.op === "update" ? JSON.stringify(w.rows[0]) + " " + w.where : `(${w.rows.length})`}`);
  const show = new Set(["meals", "swap", "goal", "goalDetail", "health", "allergies", "freeMeal", "freeMealPick", "trainingDays", "missed"]);
  for (const a of answersWritten) {
    const qq: any = q.get(a.question_id);
    const role = roleOf(qq?.label);
    const pre = qq?.validation?.prefill;
    if ((role && show.has(role)) || pre === "bodyweight") console.log(`   ${role ?? pre}: ${JSON.stringify(a.value_text ?? a.value_number ?? a.value_json)}`);
  }
  const carried = answersWritten.length;
  const total = (tables.nf_questions ?? []).filter((x: any) => !x.archived_at).length;
  console.log(`  answers: ${carried} of ${total} questions`);
}

await run("nothing changed, keep the meals", { nu_meals: "Keep my meals (just update the numbers)", nu_changed: ["Nothing else changed"], help: "" });
await run("swap + goal + free meal changed", {
  nu_meals: "Swap some foods or meals", nu_swap: "Less rice, more potatoes",
  nu_changed: ["Goal or target", "Free meal"], nu_goal: "Maintenance", nu_goal_detail: "Hold for the holidays", nu_free_meal: "No free meal, just a planned High Day",
  help: "Away Dec 20-27",
});
await run("old app: no monthly answers", { week_rating: 4 });
