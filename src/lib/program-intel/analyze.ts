/**
 * Program Intelligence, step 2 (pure): the measured picture. Weekly volume,
 * intensity, frequency and adherence; each competition lift and its
 * variations; hard sets per muscle; each exercise's progression; how each
 * block went; recovery; and what the records do and don't cover. Every value
 * is computed from the records (core.ts); nothing is estimated by a model.
 */
import { normalizeMuscle } from "@/lib/analytics/muscle-map";
import {
  LB_PER_KG,
  buildGraph,
  daysBetween,
  liftOf,
  mean,
  musclesOf,
  round,
  sum,
  toNum,
  type Graph,
} from "./core";
import {
  LIFTS,
  type BlockReport,
  type Coverage,
  type DayCompare,
  type ExerciseReport,
  type Exposure,
  type IntelRecords,
  type Lift,
  type LiftReport,
  type LiftWeek,
  type MuscleReport,
  type RowCompare,
  type SetLine,
  type TrendStat,
  type WeekMetrics,
} from "./types";

const DUE = new Set(["completed", "partial", "missed"]);
const TRAINED = new Set(["completed", "partial"]);

/** First vs last (best of the first / last two once there are four or more points), peak, and the least-squares slope per week. */
export function trend(points: Array<{ date: string | null; value: number | null }>): TrendStat {
  const pts = points
    .filter((p): p is { date: string; value: number } => !!p.date && p.value != null && Number.isFinite(p.value) && p.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!pts.length) return { first: null, last: null, peak: null, changePct: null, slopePerWeek: null, points: [] };
  const k = pts.length >= 4 ? 2 : 1;
  const first = Math.max(...pts.slice(0, k).map((p) => p.value));
  const last = Math.max(...pts.slice(-k).map((p) => p.value));
  const peak = Math.max(...pts.map((p) => p.value));
  const changePct = pts.length >= 2 && first > 0 ? round(((last - first) / first) * 100, 1) : null;
  let slopePerWeek: number | null = null;
  const span = daysBetween(pts[0].date, pts[pts.length - 1].date);
  if (pts.length >= 3 && span >= 7) {
    const xs = pts.map((p) => daysBetween(pts[0].date, p.date) / 7);
    const ys = pts.map((p) => p.value);
    const mx = mean(xs) as number;
    const my = mean(ys) as number;
    const den = sum(xs.map((x) => (x - mx) ** 2));
    slopePerWeek = den > 0 ? round(sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / den, 2) : null;
  }
  return { first: round(first, 1), last: round(last, 1), peak: round(peak, 1), changePct, slopePerWeek, points: pts.map((p) => ({ date: p.date, value: round(p.value, 1) })) };
}

/** No new best in the last three exposures (within 1%) over at least three weeks of four or more exposures. */
export function isStalled(points: TrendStat["points"]): boolean {
  if (points.length < 4) return false;
  if (daysBetween(points[0].date, points[points.length - 1].date) < 21) return false;
  const before = Math.max(...points.slice(0, -3).map((p) => p.value));
  const recent = Math.max(...points.slice(-3).map((p) => p.value));
  return recent <= before * 1.01;
}

const emptyLiftWeek = (): LiftWeek => ({ sets: 0, reps: 0, tonnageKg: 0, topE1rm: null, sessions: 0, avgRpe: null });

function rowsOf(days: DayCompare[]): Array<{ day: DayCompare; row: RowCompare }> {
  return days.flatMap((day) => day.rows.map((row) => ({ day, row })));
}

const workingOf = (row: RowCompare) => row.actual.filter((s) => s.working);

function exerciseKey(row: RowCompare): string {
  return row.exerciseId ?? `name:${row.exercise.toLowerCase()}`;
}

export function weekMetrics(rec: IntelRecords, g: Graph): WeekMetrics[] {
  const out: WeekMetrics[] = [];
  const byWeek = new Map<string, DayCompare[]>();
  for (const d of g.days) byWeek.set(d.weekKey, [...(byWeek.get(d.weekKey) ?? []), d]);
  for (const b of g.blocks) {
    for (const w of g.weeksByBlock.get(b.id) ?? []) {
      const key = g.weekKey(w);
      const days = byWeek.get(key) ?? [];
      if (!days.length) continue;
      const due = days.filter((d) => DUE.has(d.status));
      const trained = days.filter((d) => TRAINED.has(d.status));
      let prescribedSetsDue = 0;
      let completedSets = 0;
      let workingSetsLogged = 0;
      let hardSets = 0;
      let tonnage = 0;
      const rpes: number[] = [];
      const deltas: number[] = [];
      const muscles: Record<string, number> = {};
      const lifts = Object.fromEntries(LIFTS.map((l) => [l, emptyLiftWeek()])) as Record<Lift, LiftWeek>;
      const liftRpes: Record<Lift, number[]> = { squat: [], bench: [], deadlift: [] };
      const liftDays: Record<Lift, Set<string>> = { squat: new Set(), bench: new Set(), deadlift: new Set() };
      for (const { day, row } of rowsOf(days)) {
        if (DUE.has(day.status)) {
          prescribedSetsDue += row.prescribed.sets ?? 0;
          completedSets += row.prescribed.sets != null ? Math.min(row.setsDone, row.prescribed.sets) : row.setsDone;
        }
        const working = workingOf(row);
        workingSetsLogged += working.length;
        if (row.rpeDelta != null) deltas.push(row.rpeDelta);
        const ex = g.exercise.get(row.exerciseId ?? "");
        const contrib = musclesOf(ex);
        for (const s of working) {
          if (s.rpe != null) rpes.push(s.rpe);
          if (s.loadType === "external" && s.kg && s.reps) tonnage += s.kg * s.reps;
          if (s.hard) {
            hardSets++;
            for (const m of contrib) muscles[m.group] = round((muscles[m.group] ?? 0) + m.weight, 2);
          }
        }
        if (row.lift && working.length) {
          const lw = lifts[row.lift];
          lw.sets += working.length;
          lw.reps += sum(working.map((s) => s.reps ?? 0));
          lw.tonnageKg = round(lw.tonnageKg + sum(working.map((s) => (s.loadType === "external" && s.kg && s.reps ? s.kg * s.reps : 0))), 1);
          if (row.competition && row.bestE1rm != null) lw.topE1rm = Math.max(lw.topE1rm ?? 0, row.bestE1rm);
          for (const s of working) if (s.rpe != null) liftRpes[row.lift].push(s.rpe);
          liftDays[row.lift].add(day.dayId);
        }
      }
      for (const l of LIFTS) {
        lifts[l].sessions = liftDays[l].size;
        lifts[l].avgRpe = liftRpes[l].length ? round(mean(liftRpes[l]) as number, 1) : null;
      }
      const fb = days.map((d) => d.feedback).filter(Boolean);
      const srpe = fb.filter((f) => (f!.review_version ?? 0) >= 2 && f!.session_rpe != null).map((f) => f!.session_rpe as number);
      out.push({
        key,
        blockId: b.id,
        blockName: b.name ?? "Block",
        blockNumber: g.blockNumber.get(b.id) ?? 0,
        weekIndex: w.week_index,
        label: g.weekLabel(w),
        phase: w.phase,
        start: w.start_date ?? (days.map((d) => d.date).filter(Boolean).sort()[0] as string | undefined) ?? null,
        end: w.end_date ?? (days.map((d) => d.date).filter(Boolean).sort().slice(-1)[0] as string | undefined) ?? null,
        plannedDays: days.length,
        dueDays: due.length,
        completedDays: days.filter((d) => d.status === "completed").length,
        partialDays: days.filter((d) => d.status === "partial").length,
        missedDays: days.filter((d) => d.status === "missed").length,
        upcomingDays: days.filter((d) => d.status === "upcoming" || d.status === "unscheduled").length,
        prescribedSetsDue,
        completedSets,
        workingSetsLogged,
        hardSets,
        setAdherencePct: prescribedSetsDue > 0 ? Math.round((Math.min(completedSets, prescribedSetsDue) / prescribedSetsDue) * 100) : null,
        sessionAdherencePct: due.length ? Math.round((trained.length / due.length) * 100) : null,
        tonnageKg: round(tonnage, 0),
        avgRpe: rpes.length ? round(mean(rpes) as number, 1) : null,
        avgRpeDelta: deltas.length ? round(mean(deltas) as number, 2) : null,
        hardSetsByMuscle: muscles,
        lifts,
        sessionRpe: srpe.length ? round(mean(srpe) as number, 1) : null,
        painReports: fb.filter((f) => f!.pain).length,
      });
    }
  }
  return out;
}

function exposuresFor(rows: Array<{ day: DayCompare; row: RowCompare }>): Exposure[] {
  const out: Exposure[] = [];
  for (const { day, row } of rows) {
    const working = workingOf(row);
    if (!working.length) continue;
    const top = row.topSet;
    const backoff = top ? working.filter((s) => s.setIndex > top.setIndex && s.kg != null && top.kg != null && s.kg < top.kg * 0.97).length : 0;
    const rpes = working.map((s) => s.rpe).filter((n): n is number => n != null);
    out.push({
      date: day.date,
      dayId: day.dayId,
      weekKey: day.weekKey,
      exerciseId: row.exerciseId,
      exercise: row.exercise,
      competition: row.competition,
      topSet: top,
      e1rm: row.bestE1rm,
      workingSets: working.length,
      backoffSets: backoff,
      avgRpe: rpes.length ? round(mean(rpes) as number, 1) : null,
      prescribedRpe: row.prescribed.rpe,
    });
  }
  return out;
}

function maxKg(m: IntelRecords["maxes"][number]): number | null {
  const v = toNum(m.one_rm) ?? toNum(m.estimated_1rm);
  if (v == null) return null;
  return String(m.unit ?? "").toLowerCase().startsWith("lb") ? round(v / LB_PER_KG, 1) : v;
}

export function liftReports(rec: IntelRecords, g: Graph, weeks: WeekMetrics[]): LiftReport[] {
  const all = rowsOf(g.days);
  const trainedWeeks = weeks.filter((w) => w.completedDays + w.partialDays > 0);
  const bestE1rmByExercise = new Map<string, number>();
  for (const { row } of all) {
    if (row.bestE1rm == null) continue;
    const k = exerciseKey(row);
    bestE1rmByExercise.set(k, Math.max(bestE1rmByExercise.get(k) ?? 0, row.bestE1rm));
  }
  return LIFTS.map((lift) => {
    const rows = all.filter((x) => x.row.lift === lift);
    const exposures = exposuresFor(rows);
    const comp = exposures.filter((e) => e.competition);
    const compName = comp[0]?.exercise ?? null;
    const compTrend = trend(comp.map((e) => ({ date: e.date, value: e.e1rm })));
    const allTrend = trend(exposures.map((e) => ({ date: e.date, value: e.e1rm })));
    const working: Array<{ s: SetLine; row: RowCompare }> = rows.flatMap((x) => workingOf(x.row).map((s) => ({ s, row: x.row })));
    const rel = working
      .filter(({ s }) => s.loadType === "external" && s.kg)
      .map(({ s, row }) => {
        const best = bestE1rmByExercise.get(exerciseKey(row));
        return best ? ((s.kg as number) / best) * 100 : null;
      })
      .filter((n): n is number => n != null);
    const rpeBuckets = { easy: 0, moderate: 0, hard: 0, unknown: 0 };
    const repBuckets = { r1_3: 0, r4_6: 0, r7_10: 0, r11p: 0 };
    for (const { s } of working) {
      if (s.rpe == null) rpeBuckets.unknown++;
      else if (s.rpe < 7) rpeBuckets.easy++;
      else if (s.rpe < 9) rpeBuckets.moderate++;
      else rpeBuckets.hard++;
      const r = s.reps ?? 0;
      if (r <= 3) repBuckets.r1_3++;
      else if (r <= 6) repBuckets.r4_6++;
      else if (r <= 10) repBuckets.r7_10++;
      else repBuckets.r11p++;
    }
    const deltas = rows.map((x) => x.row.rpeDelta).filter((n): n is number => n != null);
    const heavySingles = working.filter(({ s, row }) => {
      if (!row.competition || (s.reps ?? 99) > 3 || !s.kg) return false;
      const best = bestE1rmByExercise.get(exerciseKey(row));
      return !!best && s.kg >= best * 0.85;
    }).length;
    const backoffRows = rows.filter(
      (x) => DUE.has(x.day.status) && (/back\s*-?\s*off/i.test(x.row.role ?? "") || x.row.prescribed.setBlocks.some((b) => /backoff|back_off/i.test(String(b.type)))),
    );
    const bPres = sum(backoffRows.map((x) => x.row.prescribed.sets ?? 0));
    const bDone = sum(backoffRows.map((x) => Math.min(x.row.workingSetsDone, x.row.prescribed.sets ?? x.row.workingSetsDone)));
    // Variations: each non-competition exercise of the lift's family.
    const byVar = new Map<string, Exposure[]>();
    for (const e of exposures.filter((x) => !x.competition)) {
      const k = e.exerciseId ?? `name:${e.exercise.toLowerCase()}`;
      byVar.set(k, [...(byVar.get(k) ?? []), e]);
    }
    const variations = [...byVar.values()]
      .map((list) => {
        const sorted = list.filter((e) => e.date).sort((a, b) => (a.date as string).localeCompare(b.date as string));
        const t = trend(sorted.map((e) => ({ date: e.date, value: e.e1rm })));
        let compChangeDuringPct: number | null = null;
        if (sorted.length && compTrend.points.length >= 2) {
          const start = sorted[0].date as string;
          const end = sorted[sorted.length - 1].date as string;
          const base = [...compTrend.points].reverse().find((p) => p.date <= start) ?? compTrend.points.find((p) => p.date <= end);
          const after = compTrend.points.filter((p) => p.date >= end && daysBetween(end, p.date) <= 21);
          const endPoint = after.length ? after.reduce((m, p) => (p.value > m.value ? p : m)) : [...compTrend.points].reverse().find((p) => p.date <= end && p.date > (base?.date ?? ""));
          if (base && endPoint && endPoint.date > base.date) compChangeDuringPct = round(((endPoint.value - base.value) / base.value) * 100, 1);
        }
        return {
          exercise: list[0].exercise,
          exerciseId: list[0].exerciseId,
          exposures: list.length,
          trend: t,
          weeks: [...new Set(list.map((e) => weeks.find((w) => w.key === e.weekKey)?.label).filter(Boolean) as string[])],
          compChangeDuringPct,
        };
      })
      .sort((a, b) => b.exposures - a.exposures);
    const perWeek = (f: (w: WeekMetrics) => number) => (trainedWeeks.length ? round(sum(trainedWeeks.map(f)) / trainedWeeks.length, 1) : null);
    const maxes = rec.maxes.filter((m) => m.active !== false && String(m.lift ?? "").toLowerCase().includes(lift)).map(maxKg).filter((n): n is number => n != null);
    const meetKey = (lift + "_kg") as "squat_kg" | "bench_kg" | "deadlift_kg";
    const meets = rec.meets.map((m) => toNum(m[meetKey])).filter((n): n is number => n != null && n > 0);
    return {
      lift,
      competitionExercise: compName,
      exposures,
      compTrend,
      allTrend,
      frequencyPerWeek: perWeek((w) => w.lifts[lift].sessions),
      setsPerWeek: perWeek((w) => w.lifts[lift].sets),
      repsPerWeek: perWeek((w) => w.lifts[lift].reps),
      tonnagePerWeekKg: perWeek((w) => w.lifts[lift].tonnageKg),
      avgRelativeIntensityPct: rel.length ? round(mean(rel) as number, 1) : null,
      rpeBuckets,
      repBuckets,
      avgRpeDelta: deltas.length ? round(mean(deltas) as number, 2) : null,
      heavySingles,
      backoffCompletionPct: bPres > 0 ? Math.round((bDone / bPres) * 100) : null,
      variations,
      stalled: isStalled(compTrend.points),
      maxOnFileKg: maxes.length ? Math.max(...maxes) : null,
      bestMeetKg: meets.length ? Math.max(...meets) : null,
    };
  });
}

export function muscleReports(rec: IntelRecords, g: Graph, weeks: WeekMetrics[]): MuscleReport[] {
  const trained = weeks.filter((w) => w.completedDays + w.partialDays > 0);
  const muscles = new Set<string>();
  for (const w of trained) for (const m of Object.keys(w.hardSetsByMuscle)) muscles.add(m);
  const exNames = new Map<string, Set<string>>();
  const daysHit = new Map<string, Map<string, number>>();
  for (const { day, row } of rowsOf(g.days)) {
    const hard = workingOf(row).filter((s) => s.hard).length;
    if (!hard) continue;
    for (const m of musclesOf(g.exercise.get(row.exerciseId ?? ""))) {
      if (m.weight >= 1) exNames.set(m.group, (exNames.get(m.group) ?? new Set()).add(row.exercise));
      const per = daysHit.get(m.group) ?? new Map<string, number>();
      per.set(day.dayId, (per.get(day.dayId) ?? 0) + hard * m.weight);
      daysHit.set(m.group, per);
    }
  }
  const targetFor = (muscle: string) => {
    for (const [k, v] of Object.entries(rec.settings.muscleTargets ?? {})) if (normalizeMuscle(k) === muscle) return v;
    return null;
  };
  const dayWeek = new Map(g.days.map((d) => [d.dayId, d.weekKey]));
  return [...muscles]
    .map((muscle) => {
      const weekly = trained.map((w) => ({ weekKey: w.key, sets: w.hardSetsByMuscle[muscle] ?? 0 }));
      const vals = weekly.map((x) => x.sets);
      const half = Math.floor(vals.length / 2);
      const avg = vals.length ? round(mean(vals) as number, 1) : null;
      const target = targetFor(muscle);
      let status: MuscleReport["status"] = "no_target";
      if (target && avg != null) status = target.mev != null && avg < target.mev ? "below" : target.mrv != null && avg > target.mrv ? "above" : "within";
      // frequency: days per trained week with at least two hard sets for the muscle
      const perWeekDays = new Map<string, number>();
      for (const [dayId, n] of daysHit.get(muscle) ?? []) {
        if (n < 2) continue;
        const wk = dayWeek.get(dayId) as string;
        perWeekDays.set(wk, (perWeekDays.get(wk) ?? 0) + 1);
      }
      return {
        muscle,
        avgHardSetsPerWeek: avg,
        firstHalfAvg: half >= 1 ? round(mean(vals.slice(0, half)) as number, 1) : null,
        secondHalfAvg: half >= 1 ? round(mean(vals.slice(half)) as number, 1) : null,
        frequencyPerWeek: trained.length ? round(sum([...perWeekDays.values()]) / trained.length, 1) : null,
        exercises: [...(exNames.get(muscle) ?? [])].sort(),
        target,
        status,
        weekly,
      };
    })
    .sort((a, b) => (b.avgHardSetsPerWeek ?? 0) - (a.avgHardSetsPerWeek ?? 0));
}

export function exerciseReports(g: Graph): ExerciseReport[] {
  const groups = new Map<string, Array<{ day: DayCompare; row: RowCompare }>>();
  for (const x of rowsOf(g.days)) groups.set(exerciseKey(x.row), [...(groups.get(exerciseKey(x.row)) ?? []), x]);
  const out: ExerciseReport[] = [];
  for (const [key, list] of groups) {
    const first = list[0].row;
    const ex = g.exercise.get(first.exerciseId ?? "");
    const exposures = list.filter((x) => workingOf(x.row).length > 0);
    const due = list.filter((x) => DUE.has(x.day.status));
    const setsDue = sum(due.map((x) => x.row.prescribed.sets ?? 0));
    const logged = sum(list.map((x) => workingOf(x.row).length));
    const doneDue = sum(due.map((x) => (x.row.prescribed.sets != null ? Math.min(x.row.setsDone, x.row.prescribed.sets) : x.row.setsDone)));
    const t = trend(exposures.map((x) => ({ date: x.day.date, value: x.row.bestE1rm })));
    const allWorking = exposures.flatMap((x) => workingOf(x.row));
    const best = allWorking.filter((s) => s.e1rm != null).sort((a, b) => (b.e1rm as number) - (a.e1rm as number))[0] ?? allWorking.sort((a, b) => (b.reps ?? 0) - (a.reps ?? 0))[0] ?? null;
    // Bodyweight / no-load work: best reps per exposure, first vs last.
    const repsPerExposure = exposures
      .filter((x) => x.day.date)
      .sort((a, b) => (a.day.date as string).localeCompare(b.day.date as string))
      .map((x) => Math.max(...workingOf(x.row).map((s) => s.reps ?? 0)));
    const noLoad = t.points.length === 0 && repsPerExposure.length >= 2;
    const rpes = allWorking.map((s) => s.rpe).filter((n): n is number => n != null);
    const dates = exposures.map((x) => x.day.date).filter(Boolean).sort() as string[];
    out.push({
      key,
      exerciseId: first.exerciseId,
      name: first.exercise,
      lift: first.lift ?? liftOf({ purpose_label: first.role }, ex),
      competition: first.competition,
      muscles: musclesOf(ex).filter((m) => m.weight >= 1).map((m) => m.group),
      exposures: exposures.length,
      setsPrescribedDue: setsDue,
      workingSetsLogged: logged,
      adherencePct: setsDue > 0 ? Math.round((Math.min(doneDue, setsDue) / setsDue) * 100) : null,
      trend: t,
      bestSet: best,
      repsTrend: noLoad ? { first: repsPerExposure[0], last: repsPerExposure[repsPerExposure.length - 1] } : null,
      avgRpe: rpes.length ? round(mean(rpes) as number, 1) : null,
      stalled: isStalled(t.points),
      lastDate: dates[dates.length - 1] ?? null,
      blocks: [...new Set(list.map((x) => `B${g.blockNumber.get(x.day.weekKey.split(":")[0]) ?? "?"}`))],
      notes: sum(list.map((x) => x.row.clientNotes.length)),
    });
  }
  return out.sort((a, b) => b.workingSetsLogged - a.workingSetsLogged);
}

export function blockReports(rec: IntelRecords, g: Graph, weeks: WeekMetrics[], lifts: LiftReport[]): BlockReport[] {
  return g.blocks
    .map((b) => {
      const ws = weeks.filter((w) => w.blockId === b.id);
      if (!ws.length) return null;
      const trained = ws.filter((w) => w.completedDays + w.partialDays > 0);
      const due = sum(ws.map((w) => w.dueDays));
      const done = sum(ws.map((w) => w.completedDays + w.partialDays));
      const presc = sum(ws.map((w) => w.prescribedSetsDue));
      const logged = sum(ws.map((w) => Math.min(w.completedSets, w.prescribedSetsDue || w.completedSets)));
      const rpes = ws.map((w) => w.avgRpe).filter((n): n is number => n != null);
      const deltas = ws.map((w) => w.avgRpeDelta).filter((n): n is number => n != null);
      const weekKeys = new Set(ws.map((w) => w.key));
      const liftChange = Object.fromEntries(
        LIFTS.map((l) => {
          const pts = (lifts.find((x) => x.lift === l)?.exposures ?? []).filter((e) => e.competition && weekKeys.has(e.weekKey));
          const t = trend(pts.map((e) => ({ date: e.date, value: e.e1rm })));
          return [l, { fromKg: t.first, toKg: t.last, changePct: t.changePct }];
        }),
      ) as BlockReport["liftChange"];
      const muscleTotals = new Map<string, number>();
      for (const w of trained) for (const [m, n] of Object.entries(w.hardSetsByMuscle)) muscleTotals.set(m, (muscleTotals.get(m) ?? 0) + n);
      return {
        blockId: b.id,
        number: g.blockNumber.get(b.id) ?? 0,
        name: b.name ?? "Block",
        status: b.status,
        start: b.start_date ?? ws[0].start,
        end: b.end_date ?? ws[ws.length - 1].end,
        focus: b.training_focus,
        goal: b.goal,
        weeks: ws.length,
        sessionAdherencePct: due ? Math.round((done / due) * 100) : null,
        setAdherencePct: presc ? Math.round((logged / presc) * 100) : null,
        avgHardSetsPerWeek: trained.length ? round(sum(trained.map((w) => w.hardSets)) / trained.length, 1) : null,
        avgRpe: rpes.length ? round(mean(rpes) as number, 1) : null,
        avgRpeDelta: deltas.length ? round(mean(deltas) as number, 2) : null,
        liftChange,
        topMuscles: [...muscleTotals.entries()]
          .map(([muscle, n]) => ({ muscle, setsPerWeek: round(n / Math.max(1, trained.length), 1) }))
          .sort((a, c) => c.setsPerWeek - a.setsPerWeek)
          .slice(0, 5),
        painReports: sum(ws.map((w) => w.painReports)),
        hidden: b.client_visible === false,
        archived: !!b.archived || b.status === "Archived",
      } satisfies BlockReport;
    })
    .filter((x): x is BlockReport => !!x);
}

export function coverage(rec: IntelRecords, g: Graph): Coverage {
  const rows = rowsOf(g.days);
  const sets = rows.flatMap((x) => x.row.actual.filter((s) => s.logged));
  const working = sets.filter((s) => s.working);
  const done = sets.filter((s) => s.done);
  const dueRows = rows.filter((x) => DUE.has(x.day.status));
  let completedSets = 0;
  let extraSets = 0;
  let skippedSets = 0;
  let incompleteSets = 0;
  let modifiedSets = 0;
  for (const { row } of rows) {
    const p = row.prescribed.sets;
    if (p != null && row.setsDone > p) extraSets += row.setsDone - p;
    const rr = row.prescribed.repRange;
    if (rr) modifiedSets += row.actual.filter((s) => s.done && s.reps != null && (s.reps < rr[0] || s.reps > rr[1] + 2)).length;
  }
  for (const { row } of dueRows) {
    const p = row.prescribed.sets ?? 0;
    completedSets += row.prescribed.sets != null ? Math.min(row.setsDone, p) : row.setsDone;
    if (!row.setsDone) skippedSets += p;
    else if (row.setsDone < p) incompleteSets += p - row.setsDone;
  }
  const dates = g.days.filter((d) => TRAINED.has(d.status)).map((d) => d.date).filter(Boolean).sort() as string[];
  const dayIds = new Set(g.days.map((d) => d.dayId));
  return {
    blocks: new Set(g.days.map((d) => d.weekKey.split(":")[0])).size,
    weeks: new Set(g.days.map((d) => d.weekKey)).size,
    plannedDays: g.days.length,
    dueDays: g.days.filter((d) => DUE.has(d.status)).length,
    completedDays: g.days.filter((d) => d.status === "completed").length,
    partialDays: g.days.filter((d) => d.status === "partial").length,
    missedDays: g.days.filter((d) => d.status === "missed").length,
    upcomingDays: g.days.filter((d) => d.status === "upcoming").length,
    unscheduledDays: g.days.filter((d) => d.status === "unscheduled").length,
    prescribedRows: rows.length,
    prescribedSetsDue: sum(dueRows.map((x) => x.row.prescribed.sets ?? 0)),
    completedSets,
    extraSets,
    skippedSets,
    incompleteSets,
    modifiedSets,
    loggedSets: sets.length,
    nonCountedRecords: sets.length - done.length,
    workingSets: working.length,
    warmupSets: sets.filter((s) => !s.done).length + sum(rows.map((x) => x.row.warmups)),
    setsWithLoad: sets.filter((s) => s.kg != null && s.kg > 0).length,
    setsWithRpe: sets.filter((s) => s.rpe != null).length,
    setsWithRpePct: done.length ? Math.round((done.filter((s) => s.rpe != null).length / done.length) * 100) : null,
    setsWithoutRpePct: done.length ? Math.round((done.filter((s) => s.rpe == null).length / done.length) * 100) : null,
    setsWithVelocity: sets.filter((s) => s.velocity != null).length,
    unmappedRows: rows.filter((x) => !x.row.exerciseId).length,
    feedbackEntries: rec.feedback.filter((f) => !f.day_id || dayIds.has(f.day_id)).length,
    exerciseNotes: rec.exerciseNotes.filter((n) => !n.day_id || dayIds.has(n.day_id)).length,
    coachNotes: rec.fileNotes.length + [rec.client.coach_notes, rec.client.training_notes].filter((s) => s?.trim()).length + rec.blocks.filter((b) => b.coach_notes?.trim()).length,
    bodyweightEntries: rec.bodyweight.length,
    maxesOnFile: rec.maxes.length,
    meetResults: rec.meets.length,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    unreadable: rec.unreadable,
  };
}

export function recoveryOf(g: Graph): {
  sessionRpeAvg: number | null;
  ratingAvg: number | null;
  painReports: Array<{ date: string | null; area: string | null; level: number | null; note: string | null }>;
  fatigue: Record<string, number>;
  sleep: Record<string, number>;
} {
  const fb = g.days.map((d) => ({ d, f: d.feedback })).filter((x) => !!x.f);
  const srpe = fb.filter((x) => (x.f!.review_version ?? 0) >= 2 && x.f!.session_rpe != null).map((x) => x.f!.session_rpe as number);
  const ratings = fb.map((x) => x.f!.overall_rating).filter((n): n is number => n != null);
  const fatigue: Record<string, number> = {};
  const sleep: Record<string, number> = {};
  for (const { f } of fb) {
    if (f!.fatigue_feel) fatigue[f!.fatigue_feel] = (fatigue[f!.fatigue_feel] ?? 0) + 1;
    if (f!.sleep_bucket) sleep[f!.sleep_bucket] = (sleep[f!.sleep_bucket] ?? 0) + 1;
  }
  return {
    sessionRpeAvg: srpe.length ? round(mean(srpe) as number, 1) : null,
    ratingAvg: ratings.length ? round(mean(ratings) as number, 1) : null,
    painReports: fb.filter((x) => x.f!.pain).map((x) => ({ date: x.d.date, area: x.f!.pain_area, level: x.f!.pain_level, note: x.f!.pain_note })),
    fatigue,
    sleep,
  };
}

export function bodyweightOf(rec: IntelRecords): { first: number | null; last: number | null; changeKg: number | null; entries: number } {
  const from = rec.scope.from;
  const to = rec.scope.to;
  const list = rec.bodyweight.filter((b) => (!from || b.date >= from) && (!to || b.date <= to)).sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return { first: null, last: null, changeKg: null, entries: 0 };
  const first = list[0].kg;
  const last = list[list.length - 1].kg;
  return { first: round(first, 1), last: round(last, 1), changeKg: round(last - first, 1), entries: list.length };
}

export { buildGraph };
