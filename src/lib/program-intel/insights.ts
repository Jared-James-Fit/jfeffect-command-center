/**
 * Program Intelligence, read for the coach in a few cards (pure, tested).
 *
 * The engine says the same underlying thing in several places: a stalled
 * exercise is a "main weakness", a "worth adjusting" and a "back off" in the
 * development read; a pain place is a finding, a recovery line and a fatigue
 * sign. Here each underlying issue becomes ONE card (its sources merged, its
 * evidence kept), ranked by what the coach should look at first, each saying
 * whether it's a verified fact, an interpretation (hypothesis), something the
 * records can't tell (missing) or something the coach already confirmed
 * (approved). Comparisons stay within like with like: an exercise against
 * itself, a lift against its own competition variation; nothing compares one
 * exercise's numbers with another's.
 *
 * Also the athlete overview's pictures: the adherence heatmap and the
 * sparklines, from the same records.
 */
import type { GeneratorIntel } from "./intelligence";
import { painNeedsLook, painPlaceLine, painPlaceName } from "./pain-read";
import { overLimit, sessionLimit } from "./session-limit";
import type { DayCompare, IntelReport } from "./types";

export type InsightKind = "fact" | "hypothesis" | "missing" | "approved";
export type InsightTone = "risk" | "watch" | "win" | "gap";
export type Insight = {
  id: string;
  /** 1 look now · 2 worth a look · 3 good to know */
  priority: 1 | 2 | 3;
  tone: InsightTone;
  kind: InsightKind;
  title: string;
  detail: string;
  evidence: string[];
  /** Where it was read from ("Previous program review", "Athlete development"…). */
  sources: string[];
  /** A line the coach can add to the next program's instructions. */
  suggestion?: string;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const TONE_ORDER: Record<InsightTone, number> = { risk: 0, watch: 1, win: 2, gap: 3 };

/** The subject a review line is about: its own subject, else the exercise before the colon. */
function subjectOf(x: { subject?: string; title: string }): string {
  return norm(x.subject ?? x.title.split(":")[0]);
}

export function buildInsights(intel: GeneratorIntel, approved: Array<{ statement: string; date?: string | null; category?: string | null }> = []): Insight[] {
  const out = new Map<string, Insight>();
  const add = (key: string, i: Insight) => {
    const cur = out.get(key);
    if (!cur) {
      out.set(key, i);
      return;
    }
    // the same issue from another source: one card, evidence and sources merged, the stronger read kept
    cur.priority = Math.min(cur.priority, i.priority) as Insight["priority"];
    if (TONE_ORDER[i.tone] < TONE_ORDER[cur.tone]) cur.tone = i.tone;
    if (i.detail && !cur.detail.includes(i.detail)) cur.detail = cur.detail ? `${cur.detail} ${i.detail}` : i.detail;
    for (const e of i.evidence) if (!cur.evidence.includes(e)) cur.evidence.push(e);
    for (const s of i.sources) if (!cur.sources.includes(s)) cur.sources.push(s);
    if (!cur.suggestion && i.suggestion) cur.suggestion = i.suggestion;
  };
  const { ctx, review, development: dev } = intel;

  // ── look now: pain on a place, sessions past their limit, consistency ──
  for (const p of ctx.injuries.pain ?? []) {
    if (!painNeedsLook(p)) continue;
    const name = painPlaceName(p);
    add(`pain:${p.key}`, {
      id: `pain:${p.key}`,
      priority: p.trend === "worse" || (p.worst ?? 0) >= 7 ? 1 : 2,
      tone: "risk",
      kind: "fact",
      title: `${name} pain: ${painPlaceLine(p)}`,
      detail: "Reported in post-workout check-outs. Which exercises load it is worth reviewing before the next block; why it hurts is not something the records can say.",
      evidence: p.evidence.slice(0, 4),
      sources: ["Check-outs"],
      suggestion: `Be careful with ${name.toLowerCase()}: ${p.reports} pain report${p.reports === 1 ? "" : "s"}${p.trend === "worse" ? ", getting worse" : ""}. Pick exercises that load it less.`,
    });
  }
  const lim = sessionLimit(ctx.session);
  if (lim.minutes != null && ctx.session.observedMedian != null && ctx.session.entries >= 4 && overLimit(ctx.session.observedMedian, lim.minutes)) {
    add("session-length", {
      id: "session-length",
      priority: 1,
      tone: "risk",
      kind: "fact",
      title: `Sessions take ${ctx.session.observedMedian} min; the limit is ${lim.minutes} (${lim.source === "pt" ? "PT session" : "Goals & Setup"})`,
      detail: `Median of ${ctx.session.entries} logged sessions${ctx.session.observedP80 ? `, 1 in 5 over ${ctx.session.observedP80} min` : ""}. The next program is built to the limit.`,
      evidence: [],
      sources: ["Logged sessions"],
      suggestion: `Keep every session within ${lim.minutes} minutes including the warm-up.`,
    });
  }
  const prevC = intel.prev?.coverage;
  if (prevC && prevC.dueDays >= 4) {
    const pct = Math.round(((prevC.completedDays + prevC.partialDays) / prevC.dueDays) * 100);
    if (pct < 80)
      add("adherence", {
        id: "adherence",
        priority: pct < 65 ? 1 : 2,
        tone: "risk",
        kind: "fact",
        title: `Trained ${prevC.completedDays + prevC.partialDays} of ${prevC.dueDays} workouts (${pct}%)`,
        detail: "With this many missed sessions the program's design can't be judged fully; fitting the plan to the days they can train may matter more than any variable.",
        evidence: (dev?.adherence.missed ?? []).slice(0, 4).map((m) => `${m.workout}: missed ${m.missed} of ${m.due}`),
        sources: ["Previous program"],
        suggestion: "Plan for the days they actually train; keep the most important work on the days they rarely miss.",
      });
  }
  if (dev?.adherence.trend === "declining")
    add("adherence", { id: "adherence", priority: 2, tone: "risk", kind: "fact", title: `Adherence down to ${dev.adherence.recentPct}% (from ${dev.adherence.earlierPct}%)`, detail: "", evidence: [], sources: ["Athlete development"] });
  if (dev?.fatigue.possible)
    add("fatigue", { id: "fatigue", priority: 2, tone: "risk", kind: "hypothesis", title: "Possible accumulated fatigue", detail: `${dev.fatigue.signs.join("; ")}. An interpretation to check with them, not a measurement.`, evidence: [], sources: ["Athlete development"], suggestion: "Start the next block with a lighter week before pushing load." });

  // ── worth a look: exercises that stalled or went back (review + development + adjust as one card each) ──
  for (const w of review?.weaknesses ?? []) {
    const key = `ex:${subjectOf(w)}`;
    add(key, { id: key, priority: 2, tone: "watch", kind: "fact", title: w.title, detail: w.detail, evidence: [...w.evidence], sources: ["Previous program"] });
  }
  for (const a of review?.adjust ?? []) {
    const key = `ex:${subjectOf(a)}`;
    if (!out.has(key)) continue; // adjust repeats a weakness or a workload read; on its own it's already said there
    add(key, { id: key, priority: 2, tone: "watch", kind: "fact", title: a.title, detail: a.detail, evidence: [], sources: ["Worth adjusting"] });
  }
  for (const p of dev?.progression ?? []) {
    if (p.decision !== "regress") continue;
    const key = `ex:${norm(p.exercise)}`;
    add(key, { id: key, priority: 2, tone: "watch", kind: "fact", title: `${p.exercise}: back off`, detail: p.why, evidence: [], sources: ["Athlete development"], suggestion: `${p.exercise}: back off before progressing it again (${p.why}).` });
  }
  for (const w of review?.workload ?? []) {
    if (w.kind !== "hypothesis") continue;
    const key = `workload:${norm(w.title).slice(0, 40)}`;
    add(key, { id: key, priority: 2, tone: "watch", kind: "hypothesis", title: w.title, detail: w.detail, evidence: [...w.evidence], sources: ["Workload"] });
  }

  // many stalled accessories are one card ("6 accessories didn't progress"); a main lift keeps its own
  const mainNames = new Set(intel.history.exercises.filter((e) => e.competition || e.lift).map((e) => norm(e.name)));
  const stalledAcc = [...out.values()].filter((i) => i.id.startsWith("ex:") && i.tone === "watch" && !mainNames.has(i.id.slice(3)) && !/\b(squat|bench|deadlift)\b/.test(i.id));
  if (stalledAcc.length > 2) {
    for (const i of stalledAcc) out.delete(i.id);
    add("ex:accessories", {
      id: "ex:accessories",
      priority: 2,
      tone: "watch",
      kind: "fact",
      title: `${stalledAcc.length} accessories didn't progress`,
      detail: "Each one compared with its own earlier sessions. Before replacing any, check whether the dose, the effort or the exercise is the limiter.",
      evidence: stalledAcc.map((i) => i.title),
      sources: [...new Set(stalledAcc.flatMap((i) => i.sources))],
      suggestion: `Accessories that stalled: ${stalledAcc.map((i) => i.title.split(":")[0]).slice(0, 6).join(", ")}. Change the rep range, effort or variation rather than adding sets.`,
    });
  }

  // ── good to know: what worked ──
  for (const i of (review?.improvements ?? []).slice(0, 3)) {
    const key = `ex:${subjectOf(i)}`;
    if (out.has(key)) continue;
    add(key, { id: key, priority: 3, tone: "win", kind: "fact", title: i.title, detail: i.detail, evidence: [...i.evidence], sources: ["Previous program"], suggestion: `Keep what worked for ${i.subject ?? i.title.split(":")[0]}.` });
  }
  // the competition lifts that weren't programmed: context, said once
  const notProgrammed = intel.history.findings.find((f) => f.id === "pl:comp-not-programmed");
  if (notProgrammed) add("comp-not-programmed", { id: "comp-not-programmed", priority: 3, tone: "gap", kind: "fact", title: notProgrammed.title, detail: notProgrammed.detail, evidence: [], sources: ["Program history"] });

  // ── patterns across programs and what the coach confirmed ──
  // patterns: a subject once (Squat and Competition Squat are one), what kept working reads as a win
  const seenSubjects: string[] = [];
  let patterns = 0;
  for (const p of intel.patterns.filter((x) => x.level !== "single")) {
    const subj = norm(p.subject || p.statement.split(" ").slice(0, 2).join(" "));
    if (seenSubjects.some((x) => x.includes(subj) || subj.includes(x))) continue;
    seenSubjects.push(subj);
    if (++patterns > 3) break;
    const win = /\bprogressed\b/i.test(p.statement) && !/didn't|not|at most/i.test(p.statement);
    // the same exercise already has a card: the pattern is more evidence for it
    const exKey = [...out.keys()].find((k) => k.startsWith("ex:") && (k.slice(3) === subj || norm(out.get(k)!.title).startsWith(subj)));
    if (exKey) {
      add(exKey, { id: exKey, priority: 3, tone: out.get(exKey)!.tone, kind: out.get(exKey)!.kind, title: "", detail: p.statement, evidence: [], sources: ["Patterns across programs"] });
      continue;
    }
    add(`pattern:${p.id}`, { id: `pattern:${p.id}`, priority: 3, tone: win ? "win" : "watch", kind: p.level === "established" ? "approved" : "hypothesis", title: p.statement, detail: p.level === "established" ? "You confirmed this pattern." : p.caveat, evidence: p.evidence.slice(0, 4), sources: ["Patterns across programs"] });
  }
  for (const a of approved.slice(0, 6))
    add(`approved:${norm(a.statement).slice(0, 48)}`, { id: `approved:${norm(a.statement).slice(0, 48)}`, priority: 2, tone: "watch", kind: "approved", title: a.statement, detail: `You confirmed this${a.date ? ` on ${a.date}` : ""}.`, evidence: [], sources: ["Athlete memory"] });

  // ── what the records can't tell: one card, not one per gap ──
  const gaps = [
    ...(intel.quality?.confidence ?? []).filter((c) => c.level === "none" || c.level === "low").map((c) => `${c.topic}: ${c.why}`),
    ...(review?.missing ?? []).map((m) => m.title),
  ];
  const uniq = [...new Set(gaps)];
  if (uniq.length)
    add("data-gaps", {
      id: "data-gaps",
      priority: 3,
      tone: "gap",
      kind: "missing",
      title: `${uniq.length} thing${uniq.length === 1 ? "" : "s"} the records can't tell`,
      detail: intel.quality?.tracking?.[0] ?? "Conclusions that would rest on these are left out or marked as estimates.",
      evidence: uniq.slice(0, 8),
      sources: ["Data quality"],
    });

  return [...out.values()].sort((a, b) => a.priority - b.priority || TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}

// ─── the athlete overview's pictures ─────────────────────────────────────────

export type HeatCell = { date: string; status: "done" | "partial" | "missed" | "planned" | "rest" | "future" };
export type HeatWeek = { start: string; cells: HeatCell[] };

const DAY_MS = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const mondayOf = (d: string) => {
  const t = Date.parse(`${d}T12:00:00Z`);
  const wd = (new Date(t).getUTCDay() + 6) % 7;
  return iso(t - wd * DAY_MS);
};

/** The last `weeks` weeks (Monday to Sunday) of their workouts, one cell a day: done, logged but not finished, missed, planned, rest. */
export function adherenceGrid(days: Array<Pick<DayCompare, "date" | "status">>, today: string, weeks = 12): HeatWeek[] {
  const byDate = new Map<string, HeatCell["status"]>();
  const rank: Record<string, number> = { done: 4, partial: 3, missed: 2, planned: 1 };
  for (const d of days) {
    if (!d.date) continue;
    const s: HeatCell["status"] | null = d.status === "completed" ? "done" : d.status === "partial" ? "partial" : d.status === "missed" ? "missed" : d.status === "upcoming" ? "planned" : null;
    if (!s) continue;
    const cur = byDate.get(d.date);
    if (!cur || rank[s] > rank[cur]) byDate.set(d.date, s);
  }
  const lastMonday = Date.parse(`${mondayOf(today)}T12:00:00Z`);
  const out: HeatWeek[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = lastMonday - w * 7 * DAY_MS;
    const cells: HeatCell[] = [];
    for (let i = 0; i < 7; i++) {
      const date = iso(start + i * DAY_MS);
      cells.push({ date, status: byDate.get(date) ?? (date > today ? "future" : "rest") });
    }
    out.push({ start: iso(start), cells });
  }
  return out;
}

/** An SVG path for a sparkline in a `w`×`h` box (null with fewer than 2 points). */
export function sparkPath(values: number[], w: number, h: number, pad = 2): string | null {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export type Spark = { key: string; label: string; values: number[]; first: number; last: number; changePct: number | null; unit: "kg" | "lb" };

/**
 * The trends worth a glance: the competition lifts (each against itself) for a
 * strength athlete, else the exercises trained most (each against itself).
 * e1RM in the athlete's unit, never one exercise's numbers against another's.
 */
export function overviewSparks(report: IntelReport, strength: boolean, max = 4): Spark[] {
  const unit = report.client.unit;
  const conv = (kg: number) => (unit === "lb" ? Math.round(kg * 2.2046226218) : Math.round(kg * 2) / 2);
  const out: Spark[] = [];
  if (strength)
    for (const l of report.lifts) {
      const pts = l.compTrend.points;
      if (pts.length < 2) continue;
      out.push({ key: l.lift, label: l.competitionExercise ?? l.lift, values: pts.map((p) => conv(p.value)), first: conv(pts[0].value), last: conv(pts[pts.length - 1].value), changePct: l.compTrend.changePct, unit });
    }
  if (out.length < max)
    for (const e of [...report.exercises].filter((x) => x.trend.points.length >= 3).sort((a, b) => b.exposures - a.exposures)) {
      if (out.length >= max) break;
      if (out.some((s) => s.label === e.name) || (strength && e.competition)) continue;
      const pts = e.trend.points;
      out.push({ key: e.key, label: e.name, values: pts.map((p) => conv(p.value)), first: conv(pts[0].value), last: conv(pts[pts.length - 1].value), changePct: e.trend.changePct, unit });
    }
  return out.slice(0, max);
}
