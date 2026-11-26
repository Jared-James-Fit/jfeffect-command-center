/**
 * The gameplan in plain text (pure): what goes to an athlete's own coach when
 * the athlete said they may see it, and the words under a copied plan. Weights
 * are kilograms with pounds beside them; times are the timeline's, each said as
 * confirmed or estimated.
 */
import { clock, type Timeline } from "./event-timeline";
import { rackText, type GameplanDoc, LIFTS } from "./gameplan";
import { toLb } from "./rules";

const WORD = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" } as const;
const kg = (x: number | null | undefined) => (x == null ? "–" : `${x}`);

export function gameplanText(o: { athlete: string; meet: string; date: string; plan: GameplanDoc; timeline?: Timeline | null }): string {
  const lines: string[] = [`${o.athlete} · ${o.meet} · ${o.date}`, ""];
  const att = LIFTS.filter((l) => o.plan.attempts[l]?.opener != null);
  if (att.length) {
    lines.push("Attempts (kg)");
    for (const l of att) {
      const a = o.plan.attempts[l]!;
      lines.push(`${WORD[l]}: ${kg(a.opener)} / ${kg(a.second)} / ${kg(a.third)}${a.opener ? ` (opener ${toLb(a.opener)} lb)` : ""}`);
    }
    lines.push("");
  }
  for (const l of LIFTS) {
    const rows = o.plan.warmups[l]?.rows ?? [];
    if (!rows.length) continue;
    lines.push(`${WORD[l]} warm-ups: ${rows.map((r) => `${r.kg}×${r.reps}`).join(", ")}`);
  }
  const racks = LIFTS.filter((l) => o.plan.equipment.racks[l]).map((l) => `${WORD[l]}: ${rackText(o.plan.equipment.racks[l])}`);
  if (racks.length) lines.push("", `Racks: ${racks.join(" · ")}`);
  const times = (o.timeline?.entries ?? []).filter((e) => e.at != null && ["weigh_in", "squat_1", "bench_1", "deadlift_1"].includes(e.key));
  if (times.length) {
    lines.push("", "Timing");
    for (const e of times) lines.push(`${e.label}: ${clock(e.at)}${e.status === "confirmed" ? "" : " (estimated)"}`);
  }
  return lines.join("\n").trim();
}
