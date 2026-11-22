/**
 * The roadmap as text: for the nutrition AI (so a Nutrition Update plan
 * follows the approved roadmap instead of guessing its own direction), for
 * the explanation writer, and the short lines the coach's board shows. Every
 * number is the engine's. Pure.
 */
import { fmtDay, fmtRate, fmtWeight } from "@/lib/weight-management/units";
import { BLOCK_LABEL, GOAL_KIND_LABEL, STATUS_LABEL, type Block, type Macros, type RoadmapRead } from "@/lib/nutrition-roadmap/types";
import { WEIGH_IN_RULE } from "@/lib/nutrition-roadmap/safety";

export const macroLine = (m: Macros) => `${m.kcal} kcal · ${m.proteinG} g protein · ${m.carbsG} g carbs · ${m.fatG} g fat`;

export function blockLine(b: Block, unit: "kg" | "lb", today: string): string {
  const w = b.weight && b.rate.kgPerWeek !== 0 ? ` · ${fmtWeight(b.weight.startKg, unit)} → ${fmtWeight(b.weight.targetKg, unit)} (${fmtRate(b.rate.kgPerWeek, unit)})` : "";
  return `${b.title}: ${fmtDay(b.start, today)} – ${fmtDay(b.end, today)}${w} · about ${b.energy.engine.kcal} kcal a day`;
}

/** The roadmap for a model to follow: never recompute or contradict these numbers. */
export function roadmapText(r: RoadmapRead, opts: { approved: boolean }): string {
  const p = r.plan;
  const u = p.unit;
  const L: string[] = [`NUTRITION ROADMAP (${opts.approved ? "approved" : "a draft, not yet approved"}; computed in the app: follow it, never contradict its numbers)`];
  if (p.goal) L.push(`Goal: ${GOAL_KIND_LABEL[p.goal.kind]}${p.goal.kg != null ? ` to ${fmtWeight(p.goal.kg, u)}` : ""}${p.goal.date ? ` by ${fmtDay(p.goal.date, p.madeOn)}` : ""}${p.goal.eventName ? ` (${p.goal.eventName})` : ""}`);
  L.push(`Feasibility: ${p.feasibility.verdict.replace("_", " ")}. ${p.feasibility.headline}.`);
  L.push(`Maintenance estimate: ${p.energy.kcal} kcal (${p.energy.lowKcal}–${p.energy.highKcal}, ${p.energy.confidence} confidence). Lowest planned intake: ${p.energy.floorKcal} kcal.`);
  if (r.currentBlock) {
    const b = r.currentBlock;
    L.push(`Current block: ${b.title} (${fmtDay(b.start, p.madeOn)} – ${fmtDay(b.end, p.madeOn)}). ${b.objective}`);
    L.push(`The block calls for: ${macroLine(b.energy.engine)}${b.energy.training && b.energy.rest ? `; training days ${b.energy.training.kcal}, rest days ${b.energy.rest.kcal}` : ""}.`);
  }
  const next = p.blocks.filter((b) => b.status === "upcoming").slice(0, 3);
  if (next.length) L.push(`Then: ${next.map((b) => `${BLOCK_LABEL[b.kind]} from ${fmtDay(b.start, p.madeOn)}`).join("; ")}.`);
  const head = r.progress.headline === STATUS_LABEL[r.progress.status] ? "" : ` ${r.progress.headline}.`;
  L.push(`Status: ${STATUS_LABEL[r.progress.status]}.${head} ${r.progress.detail}`);
  L.push(`Recommendation: ${r.decision.headline}.`);
  if (p.safety.flags.length) L.push(`Safety: ${p.safety.flags.map((f) => f.text).join(" ")}`);
  if (p.goal?.kind === "weight_class") L.push(WEIGH_IN_RULE);
  return L.join("\n");
}

/** One line for the coach's board. */
export function boardLine(r: RoadmapRead): string {
  const b = r.currentBlock;
  return [STATUS_LABEL[r.progress.status], b ? b.title : null, r.decision.action !== "hold" ? r.decision.headline : null].filter(Boolean).join(" · ");
}
