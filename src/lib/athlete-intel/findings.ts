/**
 * What the handler reads after information comes in (pure, tested): a few
 * findings that matter for the meet, read the way an experienced powerlifting
 * coach would (recent heavy work against what was prescribed, effort drifting
 * at the same loads, how much of the plan got done, heavy singles, the taper,
 * their meets, their coach's plan, current pain), the recommendations that
 * change the gameplan (each needs the coach's approval), and a one-line
 * summary per file. Nothing is said for the sake of it: no findings is a
 * valid answer.
 */
import { setE1rm, strengthSet, type GameplanIntel } from "./engine-input";
import type { Fact, Lift, SourceSummary, TrainingData, MeetData, FactKind, RiskData } from "./types";
import { PROVIDER_LABEL } from "./types";

const LIFTS: Lift[] = ["squat", "bench", "deadlift"];
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
const kgText = (x: number) => `${Math.round(x * 10) / 10} kg`;
const who = (f: Fact) => f.provider_name || PROVIDER_LABEL[f.provider].toLowerCase();

export type Finding = {
  key: string;
  text: string;
  /** what it's read from, folded under it */
  detail: string | null;
  importance: number;
  lift: Lift | null;
  factIds: string[];
  sourceIds: string[];
};

const t = (f: Fact) => f.data as TrainingData;

export function buildFindings(facts: Fact[], today: string, opts: { meetDate?: string | null } = {}): Finding[] {
  const out: Finding[] = [];
  const six = addDays(today, -42);
  const four = addDays(today, -28);
  const src = (fs: Fact[]) => [...new Set(fs.map((f) => f.source_id).filter(Boolean) as string[])];

  for (const lift of LIFTS) {
    const done = facts.filter((f) => f.lift === lift && strengthSet(f) && f.date! >= six && f.date! <= today);
    if (done.length) {
      const best = [...done].sort((a, b) => (setE1rm(t(b)) ?? 0) - (setE1rm(t(a)) ?? 0))[0];
      const bt = t(best);
      const e = setE1rm(bt);
      out.push({
        key: `best:${lift}`,
        text: `${lift[0].toUpperCase()}${lift.slice(1)}: best recent ${kgText(bt.loadKg!)} × ${bt.reps}${bt.rpe != null ? ` @ ${bt.rpe}` : ""} on ${fmtDay(best.date!)}${e ? ` (≈ ${kgText(e)} max)` : ""}`,
        detail: `From ${who(best)}'s ${done.length} completed ${lift} set${done.length === 1 ? "" : "s"} in the last 6 weeks${bt.rpe == null ? ". No RPE on it, so it's read as a hard set" : ""}`,
        importance: 70,
        lift,
        factIds: [best.id],
        sourceIds: src([best]),
      });
      // effort drifting at the same load and reps
      const byLoad = new Map<string, Fact[]>();
      for (const f of done) if (t(f).rpe != null) {
        const k = `${t(f).loadKg}|${t(f).reps}`;
        (byLoad.get(k) ?? byLoad.set(k, []).get(k)!).push(f);
      }
      for (const [, list] of byLoad) {
        if (list.length < 2) continue;
        const s = [...list].sort((a, b) => a.date!.localeCompare(b.date!));
        const first = s[0];
        const last = s[s.length - 1];
        const gap = (Date.parse(last.date!) - Date.parse(first.date!)) / 86_400_000;
        const d = (t(last).rpe ?? 0) - (t(first).rpe ?? 0);
        if (gap >= 7 && Math.abs(d) >= 1) {
          out.push({
            key: `rpe:${lift}`,
            text:
              d > 0
                ? `${lift[0].toUpperCase()}${lift.slice(1)} at ${kgText(t(first).loadKg!)} × ${t(first).reps} went from RPE ${t(first).rpe} to ${t(last).rpe}: fatigue, or a harder day`
                : `${lift[0].toUpperCase()}${lift.slice(1)} at ${kgText(t(first).loadKg!)} × ${t(first).reps} went from RPE ${t(first).rpe} to ${t(last).rpe}: moving better`,
            detail: `${fmtDay(first.date!)} and ${fmtDay(last.date!)}`,
            importance: d > 0 ? 62 : 50,
            lift,
            factIds: [first.id, last.id],
            sourceIds: src([first, last]),
          });
          break;
        }
      }
    }
    // heavy singles in the last 6 weeks
    const singles = done.filter((f) => t(f).reps <= 2 && (t(f).rpe ?? 9) >= 8);
    if (singles.length >= 2)
      out.push({
        key: `singles:${lift}`,
        text: `${singles.length} heavy ${lift} single${singles.length === 1 ? "" : "s"} or doubles in the last 6 weeks`,
        detail: singles.map((f) => `${fmtDay(f.date!)} ${kgText(t(f).loadKg!)} × ${t(f).reps}${t(f).rpe != null ? ` @ ${t(f).rpe}` : ""}`).join(" · "),
        importance: 45,
        lift,
        factIds: singles.map((f) => f.id),
        sourceIds: src(singles),
      });
  }

  // prescribed against completed: how much of the last 4 weeks' plan got done
  const planned = facts.filter((f) => f.kind === "training" && f.date && f.date >= four && f.date <= today && (t(f).completion === "prescribed" || t(f).planned));
  const withPlan = planned.filter((f) => t(f).planned || t(f).completion === "prescribed");
  if (withPlan.length >= 8) {
    const sets = (fs: Fact[]) => fs.reduce((s, f) => s + (t(f).planned?.sets ?? t(f).sets), 0);
    const doneSets = sets(withPlan.filter((f) => t(f).completion === "completed"));
    const all = sets(withPlan);
    const pct = Math.round((doneSets / Math.max(1, all)) * 100);
    if (all >= 8 && doneSets > 0)
      out.push({
        key: "adherence",
        text: `Completed ${doneSets} of ${all} prescribed sets in the last 4 weeks (${pct}%)`,
        detail: pct < 80 ? "Below 80%: read the forecast as optimistic until the gaps are explained" : null,
        importance: pct < 80 ? 66 : 35,
        lift: null,
        factIds: [],
        sourceIds: src(withPlan),
      });
    // lifts done heavier than prescribed
    const over = withPlan.filter((f) => t(f).completion === "completed" && t(f).planned?.rpe != null && t(f).rpe != null && t(f).rpe! - t(f).planned!.rpe! >= 1);
    if (over.length >= 2)
      out.push({
        key: "over_rpe",
        text: `${over.length} sets ran at least a full RPE over what was prescribed`,
        detail: over.slice(0, 4).map((f) => `${fmtDay(f.date!)} ${t(f).exercise} ${t(f).loadKg ?? "?"} kg × ${t(f).reps} @ ${t(f).rpe} (planned ${t(f).planned!.rpe})`).join(" · "),
        importance: 58,
        lift: null,
        factIds: over.map((f) => f.id),
        sourceIds: src(over),
      });
  }

  // the taper: the plan's competition-lift sets in the last two weeks before the meet against the two before
  if (opts.meetDate && opts.meetDate > today) {
    const comp = facts.filter((f) => f.kind === "training" && f.date && t(f).standard === "competition");
    const w = (from: number, to: number) =>
      comp.filter((f) => f.date! >= addDays(opts.meetDate!, from) && f.date! < addDays(opts.meetDate!, to)).reduce((s, f) => s + t(f).sets * t(f).reps, 0);
    const last2 = w(-14, 0);
    const prior2 = w(-28, -14);
    if (prior2 >= 20 && last2 > 0) {
      const drop = Math.round((1 - last2 / prior2) * 100);
      out.push({
        key: "taper",
        text: drop >= 25 ? `Their program tapers: competition-lift reps drop ${drop}% in the final two weeks` : `Their program barely tapers in the final two weeks (${drop >= 0 ? `-${drop}` : `+${-drop}`}% reps)`,
        detail: null,
        importance: drop >= 25 ? 30 : 55,
        lift: null,
        factIds: [],
        sourceIds: src(comp),
      });
    }
  }

  // meets
  const meets = facts.filter((f) => f.kind === "meet" && f.date).sort((a, b) => b.date!.localeCompare(a.date!));
  if (meets.length) {
    const best = [...meets].sort((a, b) => ((b.data as MeetData).total ?? 0) - ((a.data as MeetData).total ?? 0))[0];
    const m = best.data as MeetData;
    out.push({
      key: "meets",
      text: `${meets.length} past meet${meets.length === 1 ? "" : "s"} uploaded; best total ${m.total != null ? kgText(m.total) : "–"}${best.date ? ` (${fmtDay(best.date)})` : ""}`,
      detail: meets.slice(0, 4).map((f) => `${f.date} ${(f.data as MeetData).name ?? "Meet"}: ${(f.data as MeetData).squat}/${(f.data as MeetData).bench}/${(f.data as MeetData).deadlift}`).join(" · "),
      importance: 40,
      lift: null,
      factIds: meets.map((f) => f.id),
      sourceIds: src(meets),
    });
  }

  // their coach's plan for the meet
  const plans = facts.filter((f) => f.kind === "attempt_plan" && f.lift);
  if (plans.length) {
    const by = plans[0];
    const parts = LIFTS.map((l) => plans.find((p) => p.lift === l)).filter(Boolean) as Fact[];
    out.push({
      key: "attempt_plan",
      text: `${who(by)[0].toUpperCase()}${who(by).slice(1)}'s openers: ${parts.map((p) => `${p.lift} ${(p.data as any).opener ?? "–"}`).join(", ")} kg`,
      detail: parts.map((p) => `${p.lift}: ${[(p.data as any).opener, (p.data as any).second, (p.data as any).third].map((x: any) => x ?? "–").join(" / ")}`).join(" · "),
      importance: 75,
      lift: null,
      factIds: parts.map((p) => p.id),
      sourceIds: src(parts),
    });
  }

  // pain
  for (const f of facts.filter((x) => x.kind === "risk" && (x.data as RiskData).status !== "resolved")) {
    const r = f.data as RiskData;
    const when = f.date ?? f.received_at.slice(0, 10);
    if (when < six) continue;
    out.push({
      key: `risk:${f.id}`,
      text: `${r.place ? `${r.place[0].toUpperCase()}${r.place.slice(1)}` : "Pain"} noted${f.date ? ` ${fmtDay(f.date)}` : ""}${f.lift ? ` (affects the ${f.lift})` : ""}`,
      detail: r.text,
      importance: 72,
      lift: f.lift,
      factIds: [f.id],
      sourceIds: src([f]),
    });
  }

  // technique
  const tech = facts.filter((f) => f.kind === "technique");
  if (tech.length)
    out.push({
      key: "technique",
      text: `${tech.length} technical note${tech.length === 1 ? "" : "s"} from ${who(tech[0])}${tech[0].lift ? ` (${tech[0].lift})` : ""}`,
      detail: tech.slice(0, 4).map((f) => (f.data as { text: string }).text).join(" · "),
      importance: 38,
      lift: null,
      factIds: tech.map((f) => f.id),
      sourceIds: src(tech),
    });
  return out.sort((a, b) => b.importance - a.importance);
}

/* ------------------------------------------------------------------ */
/* Recommendations                                                    */

export type Recommendation = {
  key: string;
  area: "attempts" | "warmups" | "equipment" | "cues" | "instructions";
  text: string;
  detail: string | null;
  lift: Lift | null;
};

type PlanLike = {
  attempts: Partial<Record<Lift, { opener: number | null; second: number | null; third: number | null; source?: string } | undefined>>;
  warmups: Partial<Record<Lift, { rows: Array<{ kg: number; reps: number }> } | undefined>>;
  equipment: { racks: Partial<Record<Lift, { height: string | null; safety: string | null; footBlocks?: string | null } | undefined>>; gear: string[] };
  cues?: Partial<Record<Lift, string[]>>;
  instructions?: string[];
};

/**
 * What the uploaded information would change in an approved gameplan: a new
 * version for the coach to approve, never a change to the approved one. With
 * no approved plan the draft already reads the information, so nothing is
 * recommended.
 */
export function buildRecommendations(intel: GameplanIntel, approved: PlanLike | null): Recommendation[] {
  if (!approved) return [];
  const out: Recommendation[] = [];
  for (const lift of LIFTS) {
    const c = intel.attempts[lift];
    const a = approved.attempts[lift];
    if (c && c.opener != null && (!a || a.opener !== c.opener || (c.second != null && a.second !== c.second) || (c.third != null && a.third !== c.third)) && (c.by === "primary_coach" || c.by === "athlete")) {
      out.push({
        key: `attempts:${lift}`,
        area: "attempts",
        lift,
        text: `Use ${c.label}'s ${lift} attempts: ${[c.opener, c.second, c.third].map((x) => x ?? "–").join(" / ")} kg`,
        detail: a ? `The approved plan has ${[a.opener, a.second, a.third].map((x) => x ?? "–").join(" / ")} kg` : null,
      });
    }
    const w = intel.warmups[lift];
    if (w && w.rows.length >= 2 && !(approved.warmups[lift]?.rows.length) && w.rows.every((r) => r.kg != null)) {
      out.push({ key: `warmups:${lift}`, area: "warmups", lift, text: `Use ${w.label}'s ${lift} warm-ups`, detail: w.rows.map((r) => `${r.kg}×${r.reps}`).join(", ") });
    }
    const rk = intel.racks[lift as "squat" | "bench"];
    const ak = approved.equipment.racks[lift];
    if (rk && (rk.height || rk.safety) && (!ak || ak.height !== rk.height || ak.safety !== rk.safety)) {
      out.push({ key: `rack:${lift}`, area: "equipment", lift, text: `Add the ${lift} rack settings: ${[rk.height ? `height ${rk.height}` : null, rk.safety ? `safeties ${rk.safety}` : null].filter(Boolean).join(", ")}`, detail: null });
    }
    const cues = intel.cues[lift] ?? [];
    const have = approved.cues?.[lift] ?? [];
    const fresh = cues.filter((c) => !have.includes(c));
    if (fresh.length) out.push({ key: `cues:${lift}`, area: "cues", lift, text: `Add ${fresh.length} ${lift} cue${fresh.length === 1 ? "" : "s"}`, detail: fresh.join(" · ") });
  }
  const fresh = intel.instructions.filter((i) => !(approved.instructions ?? []).includes(i));
  if (fresh.length) out.push({ key: "instructions", area: "instructions", lift: null, text: `Add ${fresh.length} note${fresh.length === 1 ? "" : "s"} from their coach to the gameplan`, detail: fresh.join(" · ") });
  return out;
}

/* ------------------------------------------------------------------ */
/* One file's summary                                                 */

const NOUN: Partial<Record<FactKind, [string, string]>> = {
  meet: ["meet", "meets"],
  attempt_plan: ["attempt plan", "attempt plans"],
  warmup: ["warm-up ladder", "warm-up ladders"],
  cue: ["cue", "cues"],
  technique: ["technical note", "technical notes"],
  instruction: ["coach instruction", "coach instructions"],
  equipment: ["equipment note", "equipment notes"],
  bodyweight: ["bodyweight", "bodyweights"],
  risk: ["pain note", "pain notes"],
  preference: ["preference", "preferences"],
  taper: ["taper note", "taper notes"],
};

export function summarize(facts: Array<Pick<Fact, "kind" | "data">>, method: SourceSummary["method"], notes: string[] = []): SourceSummary {
  const counts: Partial<Record<FactKind, number>> = {};
  let completed = 0;
  let prescribed = 0;
  let unknown = 0;
  for (const f of facts) {
    counts[f.kind] = (counts[f.kind] ?? 0) + 1;
    if (f.kind === "training") {
      const d = f.data as TrainingData;
      if (d.completion === "completed") completed += d.sets;
      else if (d.completion === "prescribed") prescribed += d.sets;
      else unknown += d.sets;
    }
  }
  const parts: string[] = [];
  if (completed) parts.push(`${completed} completed set${completed === 1 ? "" : "s"}`);
  if (prescribed) parts.push(`${prescribed} prescribed`);
  if (unknown) parts.push(`${unknown} not marked done or planned`);
  for (const [k, [one, many]] of Object.entries(NOUN) as Array<[FactKind, [string, string]]>) {
    const n = counts[k];
    if (n) parts.push(`${n} ${n === 1 ? one : many}`);
  }
  const line = parts.length ? `Read ${parts.join(", ")}` : method === "none" ? "Kept for reference" : "Nothing new for the meet in it";
  return { line, counts, completedSets: completed, prescribedSets: prescribed, unknownSets: unknown, method, notes };
}

/* ------------------------------------------------------------------ */
/* For Cleo across coaching                                           */

/** What uploaded information says about the athlete, attributed, for any Cleo workflow (facts, never instructions). */
export function intelText(facts: Fact[], today: string): string | null {
  const active = facts.filter((f) => f.status === "active");
  if (!active.length) return null;
  const lines: string[] = [];
  for (const f of buildFindings(active, today).slice(0, 6)) lines.push(`- ${f.text}`);
  const by = (k: FactKind) => active.filter((f) => f.kind === k);
  for (const f of [...by("instruction"), ...by("preference"), ...by("technique"), ...by("cue")].slice(0, 10))
    lines.push(`- ${f.kind} from ${who(f)}${f.lift ? ` (${f.lift})` : ""}: ${(f.data as { text: string }).text}`);
  return lines.length ? lines.join("\n") : null;
}

/** One fact in a line, as the handler reads it. */
export function factLine(f: Fact): string {
  const d: any = f.data;
  switch (f.kind) {
    case "training": {
      const t = d as TrainingData;
      const load = t.loadKg != null ? `${t.loadKg} kg` : t.load != null ? `${t.load}${t.unit ? ` ${t.unit}` : " (unit?)"}` : t.pct != null ? `${t.pct}%` : "";
      return `${t.exercise}: ${t.sets > 1 ? `${t.sets} × ` : ""}${t.reps}${load ? ` @ ${load}` : ""}${t.rpe != null ? ` RPE ${t.rpe}` : ""} · ${t.completion === "completed" ? "done" : t.completion === "prescribed" ? "prescribed" : "not marked"}${t.standard === "variation" ? " · variation" : ""}`;
    }
    case "meet":
      return `${d.name ?? "Meet"}: ${d.squat}/${d.bench}/${d.deadlift} = ${d.total ?? "–"} kg${d.bodyweightKg ? ` at ${d.bodyweightKg} kg` : ""}`;
    case "attempt_plan":
      return `${f.lift} attempts: ${[d.opener, d.second, d.third].map((x: number | null) => x ?? "–").join(" / ")} kg`;
    case "warmup":
      return `${f.lift} warm-ups: ${(d.rows ?? []).map((r: any) => `${r.kg ?? `${r.pct}%`}×${r.reps}`).join(", ")}`;
    case "equipment":
      return [f.lift ? `${f.lift}:` : null, d.rackHeight ? `rack ${d.rackHeight}` : null, d.safety ? `safeties ${d.safety}` : null, d.footBlocks ? `blocks ${d.footBlocks}` : null, (d.gear ?? []).join(", ") || null, d.text]
        .filter(Boolean)
        .join(" ");
    case "bodyweight":
      return `Bodyweight ${d.kg} kg`;
    case "risk":
      return `${d.place ? `${d.place}: ` : ""}${d.text}${d.status === "resolved" ? " (resolved)" : ""}`;
    default:
      return `${f.lift ? `${f.lift}: ` : ""}${d.text ?? ""}`;
  }
}
