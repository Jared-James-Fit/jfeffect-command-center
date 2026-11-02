/**
 * Patterns across training cycles: what keeps happening for this athlete
 * from block to block. A pattern needs repeated evidence:
 *   - established: the coach confirmed it in the athlete's memory;
 *   - recurring: seen in 2+ blocks with at least one block that went the
 *     other way, consistent in direction (an association, not a cause);
 *   - single: seen once (shown so the coach knows it isn't a pattern yet).
 * Correlation is never presented as causation. Deterministic.
 */
import { fmtLoad, mean, round, sum } from "./core";
import { trend } from "./analyze";
import type { IntelRecords, IntelReport, Lift } from "./types";
import { LIFTS } from "./types";

export type Pattern = {
  id: string;
  level: "established" | "recurring" | "single";
  subject: string;
  statement: string;
  evidence: string[];
  caveat: string;
};

const LIFT_NAME: Record<Lift, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };
const CAVEAT = "An association across blocks that differed in other ways too (phase, life, fatigue): a lead to test, not proof of cause.";

type BlockLift = { block: number; name: string; change: number; freq: number; sets: number; rpe: number | null; lowerSets: number };

function perBlockLift(h: IntelReport, lift: Lift): BlockLift[] {
  const out: BlockLift[] = [];
  for (const b of h.blocks) {
    const ch = b.liftChange[lift].changePct;
    const ws = h.weeks.filter((w) => w.blockId === b.blockId && w.completedDays + w.partialDays > 0);
    const exposures = (h.lifts.find((l) => l.lift === lift)?.exposures ?? []).filter((e) => e.competition && e.e1rm != null && ws.some((w) => w.key === e.weekKey));
    if (ch == null || exposures.length < 3 || ws.length < 2) continue;
    const rpes = ws.map((w) => w.lifts[lift].avgRpe).filter((n): n is number => n != null);
    out.push({
      block: b.number,
      name: b.name,
      change: ch,
      freq: round(sum(ws.map((w) => w.lifts[lift].sessions)) / ws.length, 1),
      sets: round(sum(ws.map((w) => w.lifts[lift].sets)) / ws.length, 1),
      rpe: rpes.length ? round(mean(rpes) as number, 1) : null,
      lowerSets: round(sum(ws.map((w) => w.lifts.squat.sets + w.lifts.deadlift.sets)) / ws.length, 1),
    });
  }
  return out;
}

export function findPatterns(h: IntelReport, rec: IntelRecords): Pattern[] {
  const out: Pattern[] = [];
  const u = h.client.unit;

  // Coach-confirmed memory is the only "established" knowledge.
  for (const o of rec.observations.filter((x) => (x.status === "approved" || x.status === "corrected") && x.kind !== "decision"))
    out.push({ id: `memory:${o.id}`, level: "established", subject: o.category ?? "athlete", statement: o.corrected_statement ?? o.statement, evidence: [`Confirmed by the coach ${String(o.reviewed_at ?? o.created_at).slice(0, 10)}`], caveat: o.confidence === "fact" ? "" : "Confirmed as a working belief; still an interpretation." });

  // Each main lift: what differed between the blocks it progressed in and the ones it didn't.
  for (const lift of LIFTS) {
    const bl = perBlockLift(h, lift);
    if (bl.length < 2) continue;
    const up = bl.filter((b) => b.change >= 2);
    const flat = bl.filter((b) => b.change < 1);
    const line = (b: BlockLift) => `B${b.block} "${b.name}": ${b.change > 0 ? "+" : ""}${b.change}% e1RM, ${b.freq}×/wk, ${b.sets} sets/wk${b.rpe != null ? `, RPE ${b.rpe}` : ""}`;
    if (up.length && flat.length) {
      const diffs: string[] = [];
      const fUp = mean(up.map((b) => b.freq)) as number;
      const fFlat = mean(flat.map((b) => b.freq)) as number;
      const sUp = mean(up.map((b) => b.sets)) as number;
      const sFlat = mean(flat.map((b) => b.sets)) as number;
      const consistentFreq = fUp > fFlat ? Math.min(...up.map((b) => b.freq)) > Math.max(...flat.map((b) => b.freq)) : Math.max(...up.map((b) => b.freq)) < Math.min(...flat.map((b) => b.freq));
      const consistentSets = sUp > sFlat ? Math.min(...up.map((b) => b.sets)) > Math.max(...flat.map((b) => b.sets)) : Math.max(...up.map((b) => b.sets)) < Math.min(...flat.map((b) => b.sets));
      if (Math.abs(fUp - fFlat) >= 0.5 && consistentFreq) diffs.push(`${fUp > fFlat ? "higher" : "lower"} frequency (${round(fUp, 1)} vs ${round(fFlat, 1)}×/week)`);
      if (Math.abs(sUp - sFlat) >= 2 && consistentSets) diffs.push(`${sUp > sFlat ? "more" : "fewer"} weekly sets (${round(sUp, 1)} vs ${round(sFlat, 1)})`);
      if (diffs.length)
        out.push({
          id: `lift:${lift}:dose`,
          level: up.length >= 2 ? "recurring" : "single",
          subject: lift,
          statement: `${LIFT_NAME[lift]} progressed in ${up.length} of ${bl.length} blocks; those blocks had ${diffs.join(" and ")} than the ${flat.length} where it didn't.`,
          evidence: bl.map(line),
          caveat: CAVEAT,
        });
    } else if (bl.length >= 2) {
      out.push({ id: `lift:${lift}:trend`, level: bl.length >= 3 ? "recurring" : "single", subject: lift, statement: up.length === bl.length ? `${LIFT_NAME[lift]} progressed in every one of the ${bl.length} blocks with enough data.` : `${LIFT_NAME[lift]} didn't progress in any of the ${bl.length} blocks with enough data.`, evidence: bl.map(line), caveat: up.length === bl.length ? "What those blocks had in common is a candidate to keep." : "Look at what those blocks shared before changing one variable." });
    }
  }
  // Deadlift and the combined lower-body load.
  const dl = perBlockLift(h, "deadlift");
  if (dl.length >= 3) {
    const flat = dl.filter((b) => b.change < 1);
    const up = dl.filter((b) => b.change >= 2);
    if (flat.length && up.length && Math.min(...flat.map((b) => b.lowerSets)) > Math.max(...up.map((b) => b.lowerSets)))
      out.push({ id: "lift:deadlift:lower-load", level: flat.length >= 2 ? "recurring" : "single", subject: "deadlift", statement: `Deadlift stalled in the blocks with the most combined squat + deadlift sets (${round(mean(flat.map((b) => b.lowerSets)) as number, 1)} vs ${round(mean(up.map((b) => b.lowerSets)) as number, 1)} a week where it progressed).`, evidence: dl.map((b) => `B${b.block}: deadlift ${b.change > 0 ? "+" : ""}${b.change}%, squat + deadlift ${b.lowerSets} sets/wk`), caveat: CAVEAT });
  }

  // Exercises across blocks: consistently progressing, or stalling every time.
  const byExBlock = new Map<string, Map<string, Array<{ date: string | null; value: number | null }>>>();
  const names = new Map<string, string>();
  for (const d of h.days) {
    const blockId = d.weekKey.split(":")[0];
    for (const r of d.rows) {
      if (r.bestE1rm == null) continue;
      const k = r.exerciseId ?? `name:${r.exercise.toLowerCase()}`;
      names.set(k, r.exercise);
      const m = byExBlock.get(k) ?? new Map();
      m.set(blockId, [...(m.get(blockId) ?? []), { date: d.date, value: r.bestE1rm }]);
      byExBlock.set(k, m);
    }
  }
  const blockNo = new Map(h.blocks.map((b) => [b.blockId, b.number]));
  for (const [k, blocks] of byExBlock) {
    const per = [...blocks.entries()].map(([bid, pts]) => ({ block: blockNo.get(bid) ?? 0, t: trend(pts) })).filter((x) => x.t.points.length >= 3 && x.t.changePct != null);
    if (per.length < 2) continue;
    const ups = per.filter((x) => (x.t.changePct as number) >= 3);
    const flats = per.filter((x) => (x.t.changePct as number) < 1);
    const ev = per.map((x) => `B${x.block}: ${fmtLoad(x.t.first as number, u)} → ${fmtLoad(x.t.last as number, u)} e1RM (${(x.t.changePct as number) > 0 ? "+" : ""}${x.t.changePct}%)`);
    if (ups.length >= 2 && !flats.length) out.push({ id: `ex:${k}:progresses`, level: "recurring", subject: names.get(k) as string, statement: `${names.get(k)} progressed in each of the ${ups.length} blocks it was programmed in.`, evidence: ev, caveat: "A reliable exercise for this athlete so far; keep unless something else changed." });
    else if (flats.length >= 2 && !ups.length) out.push({ id: `ex:${k}:stalls`, level: "recurring", subject: names.get(k) as string, statement: `${names.get(k)} stalled in each of the ${flats.length} blocks it was programmed in.`, evidence: ev, caveat: "Worth asking why (setup, discomfort, dose, placement in the session) before programming it again." });
  }

  // Pain reported after sessions with the same exercise, more than once.
  const painDays = h.days.filter((d) => d.feedback?.pain && d.feedback.pain_area);
  const co = new Map<string, { n: number; area: string; ex: string; dates: string[] }>();
  for (const d of painDays) for (const r of d.rows.filter((x) => x.setsDone > 0)) {
    const key = `${(d.feedback!.pain_area as string).toLowerCase()}|${r.exerciseId ?? r.exercise}`;
    const cur = co.get(key) ?? { n: 0, area: (d.feedback!.pain_area as string).toLowerCase(), ex: r.exercise, dates: [] };
    cur.n++;
    cur.dates.push(d.date ?? "?");
    co.set(key, cur);
  }
  for (const v of co.values()) {
    if (v.n < 2) continue;
    const trainedWith = h.days.filter((d) => d.rows.some((r) => r.exercise === v.ex && r.setsDone > 0)).length;
    out.push({ id: `pain:${v.area}:${v.ex}`, level: "recurring", subject: v.ex, statement: `${v.area} pain was reported after ${v.n} of ${trainedWith} sessions that included ${v.ex}.`, evidence: v.dates.map((x) => `${x}: ${v.area} pain reported`), caveat: "The exercise was in those sessions; whether it caused the pain is unknown." });
  }

  // Adherence against the number of days programmed.
  const progs = h.blocks.map((b) => {
    const ws = h.weeks.filter((w) => w.blockId === b.blockId && w.dueDays > 0);
    const days = ws.length ? round(mean(ws.map((w) => w.plannedDays)) as number, 1) : null;
    return { b, days };
  }).filter((x) => x.days != null && x.b.sessionAdherencePct != null);
  if (progs.length >= 3) {
    const hi = progs.filter((x) => (x.days as number) >= 4);
    const lo = progs.filter((x) => (x.days as number) < 4);
    if (hi.length && lo.length) {
      const aHi = mean(hi.map((x) => x.b.sessionAdherencePct as number)) as number;
      const aLo = mean(lo.map((x) => x.b.sessionAdherencePct as number)) as number;
      if (Math.abs(aHi - aLo) >= 12)
        out.push({ id: "adherence:frequency", level: hi.length + lo.length >= 4 ? "recurring" : "single", subject: "adherence", statement: `Adherence was ${aHi < aLo ? "lower" : "higher"} in blocks with 4+ days a week (${Math.round(aHi)}% vs ${Math.round(aLo)}% with fewer days).`, evidence: progs.map((x) => `B${x.b.number}: ${x.days} days/wk, ${x.b.sessionAdherencePct}% trained`), caveat: CAVEAT });
    }
  }
  return out;
}
