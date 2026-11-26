import { COMP_LIFTS, compLiftOfResult, type CompLift, type MeetResult } from "@/lib/analytics/competition-strength";
import { localDay, isMeetLog, type LiftStrength } from "@/lib/analytics/lift-strength";
import { neutralizeObviousLoadOutliers } from "@/lib/analytics/load-sanity";
import { forecastMeet, type LiftEvidence, type ConversionPoint } from "@/lib/competition/forecast";
import { envelopeAt } from "@/lib/analytics/strength-estimate";
import { LB_PER_KG } from "@/lib/analytics/units";
import { weightContextAt, type WeightReference, type WeightSample } from "./weight-context";

export type RingLift = {
  lb: number;
  lowLb?: number;
  day: string;
  detail: string;
  classLabel?: string | null;
  bodyweightKg?: number | null;
  stale?: boolean;
};
export type RingLifts = Record<CompLift, RingLift | null>;
const emptyLifts = (): RingLifts => ({ squat: null, bench: null, deadlift: null });
const DAY = 86_400_000;
const age = (from: string, to: string) => (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY;

export function ringTotal(lifts: RingLifts): number | null {
  return COMP_LIFTS.every((l) => lifts[l] && lifts[l]!.lb > 0)
    ? COMP_LIFTS.reduce((a, l) => a + lifts[l]!.lb, 0)
    : null;
}

/** Same-day strength scenarios from the existing forecast engine. No
 * extrapolation, no substitution of a past meet or coach-entered max.
 * Its high scenario requires favourable performance across all three lifts. */
export function currentRing(strength: Record<CompLift, LiftStrength>, today: string, meets: readonly MeetResult[] = [], weightClass?: string | null): {
  lifts: RingLifts;
  totalLb: number | null;
  lowLb: number | null;
  missing: CompLift[];
  confidence: string;
} {
  const evidence = {} as Record<CompLift, LiftEvidence>;
  const lifts = emptyLifts();
  const missing: CompLift[] = [];
  for (const lift of COMP_LIFTS) {
    const data = strength[lift];
    const cur = data.intel.current;
    const session = cur && cur.basis.kind === "set"
      ? data.sessions.find((s) => s.day === cur.basis.day && !s.outlier)
      : null;
    const hardSessions6w = data.sessions.filter((s) => !s.outlier && s.kind === "exact" && age(s.day, today) >= 0 && age(s.day, today) <= 42).length;
    const fresh = !!cur && !!session && age(session.day, today) >= 0 && age(session.day, today) <= 42 && cur.state !== "stale" && cur.state !== "floor";
    evidence[lift] = {
      lift,
      nowKg: fresh ? cur!.value / LB_PER_KG : null,
      state: fresh ? cur!.state : null,
      basis: null,
      basisDay: fresh ? session!.day : null,
      hardSessions6w,
      trendPerWeek: null,
      direction: "unclear",
    };
    if (!fresh) {
      missing.push(lift);
      if (cur && session) lifts[lift] = {
        lb: cur.value,
        day: session.day,
        stale: true,
        detail: "Last known training estimate; there is not enough recent evidence for a current range.",
      };
      else {const last=[...data.sessions].reverse().find(s=>!s.outlier&&s.day<=today&&s.e1rm>0);if(last)lifts[lift]={lb:last.e1rm,day:last.day,stale:true,detail:last.kind==="exact"?"Last comparable training estimate; not a current projection.":"Last logged lower-bound estimate; not a current projected max."};}
    }
  }
  const conversion: ConversionPoint[] = [];
  for (const meet of meets) {
    if (meet.date>today || (meet.event??"SBD").toUpperCase()!=="SBD") continue;
    if(weightClass&&officialClass(meet)!==weightClass)continue;
    const before=new Date(Date.parse(meet.date)-21*DAY).toISOString().slice(0,10);
    for(const lift of COMP_LIFTS){
      if(!strength[lift].meets.some(m=>m.day===meet.date))continue;
      const point=envelopeAt(strength[lift].envelope,before);
      if(!point||!["measured","raised"].includes(point.state)||age(point.basis,before)>42||!strength[lift].sessions.some(s=>s.day===point.basis&&s.kind==="exact"&&!s.outlier))continue;
      conversion.push({lift,meetDate:meet.date,meetKg:meet.lifts[lift]/LB_PER_KG,trainingKg:point.value/LB_PER_KG,weightClass:meet.weightClass});
    }
  }
  const forecast = forecastMeet({ today, meetDate: today, lifts: evidence, meets: [], conversion, concerns: [], weightClass: undefined });
  for (const lift of COMP_LIFTS) {
    const f = forecast.lifts[lift];
    if (!f || f.source !== "training") continue;
    const s = strength[lift].sessions.find((x) => x.day === evidence[lift].basisDay && !x.outlier);
    if (!s) continue;
    lifts[lift] = {
      lb: f.range.high * LB_PER_KG,
      lowLb: f.range.conservative * LB_PER_KG,
      day: s.day,
      detail: `Supported by ${Math.round(s.set.load)} lb / ${(s.set.load / LB_PER_KG).toFixed(1)} kg × ${s.set.reps}${s.set.effort == null ? "" : ` @ ${s.set.effort}`} on ${s.day}; ${f.confidence} confidence.`,
    };
  }
  return {
    lifts,
    missing,
    confidence: forecast.confidence,
    totalLb: missing.length ? null : ringTotal(lifts),
    lowLb: missing.length || COMP_LIFTS.some((l) => lifts[l]?.lowLb == null) ? null : COMP_LIFTS.reduce((sum, l) => sum + lifts[l]!.lowLb!, 0),
  };
}

export function officialClass(m: MeetResult): string | null {
  const raw = m.weightClass?.trim();
  return raw ? (/kg$/i.test(raw) ? raw : raw + " kg") : null;
}

export function competitionRing(meets: readonly MeetResult[], classFilter: string, selection: "latest" | "best" | "individual" | string) {
  const scoped = meets.filter((m) => (!m.event || m.event.toUpperCase() === "SBD") && (classFilter === "all" || (officialClass(m) ?? "unknown") === classFilter));
  const ordered = [...scoped].sort((a, b) => b.date.localeCompare(a.date));
  const id = (m: MeetResult) => m.id ?? `${m.date}:${m.name ?? ""}`;
  const meet = selection === "individual" ? null : selection === "best"
    ? ordered.reduce<MeetResult | null>((a, m) => !a || m.total > a.total ? m : a, null)
    : ordered.find((m) => id(m) === selection) ?? ordered[0] ?? null;
  const lifts = emptyLifts();
  for (const lift of COMP_LIFTS) {
    const m = selection === "individual" ? ordered.reduce<MeetResult | null>((a, row) => !a || row.lifts[lift] > a.lifts[lift] ? row : a, null) : meet;
    if (!m || !(m.lifts[lift] > 0)) continue;
    lifts[lift] = { lb: m.lifts[lift], day: m.date, classLabel: officialClass(m), bodyweightKg: m.bodyweightLb == null ? null : m.bodyweightLb / LB_PER_KG, detail: `Achieved at ${m.name ?? "competition"} on ${m.date}.` };
  }
  return { lifts, totalLb: meet ? meet.total : ringTotal(lifts), meet, options: ordered.map((m) => ({ id: id(m), label: `${m.date} · ${m.name ?? "Competition"}` })) };
}

export type GymRingRecord = RingLift & { lift: CompLift; metric: "actual" | "estimated" };

export function gymRingRecords(results: readonly any[], strength: Record<CompLift, LiftStrength>, weights: readonly WeightSample[], refs: readonly WeightReference[], today: string): GymRingRecord[] {
  const out: GymRingRecord[] = [];
  const rows = neutralizeObviousLoadOutliers(results.filter((r) => r?.date && r.counts_load !== false && Number(r.load) > 0 && Number(r.reps) > 0 && localDay(r.date) <= today).map((r) => ({ ...r, est_1rm: Number(r.est_1rm) || 0 })));
  const sessions = new Map<string, number>();
  for (const r of rows) {
    const lift = compLiftOfResult(r);
    if (!lift || r.analytics_load_outlier) continue;
    const key = `${lift}|${localDay(r.date)}`;
    sessions.set(key, Math.max(sessions.get(key) ?? 0, Number(r.load)));
  }
  const context = (day: string) => {
    const c = weightContextAt(weights, refs, day);
    return { classLabel: c.category?.label ?? null, bodyweightKg: c.averageKg };
  };
  for (const r of rows) {
    const lift = compLiftOfResult(r);
    if (!lift || r.analytics_load_outlier || Number(r.reps) !== 1) continue;
    const day = localDay(r.date);
    const heaviest = sessions.get(`${lift}|${day}`) ?? 0;
    if (strength[lift].meets.some((m) => isMeetLog({ day, heaviest }, m))) continue;
    out.push({ lift, metric: "actual", lb: Number(r.load), day, detail: `Recorded gym single on ${day}. This is an achieved lift, not necessarily a maximal test.`, ...context(day) });
  }
  for (const lift of COMP_LIFTS) for (const s of strength[lift].sessions) {
    if (s.day > today || s.outlier || s.kind !== "exact" || s.confidence !== "high" || !(s.e1rm > 0)) continue;
    out.push({ lift, metric: "estimated", lb: s.e1rm, day: s.day, detail: `Estimate from ${Math.round(s.set.load)} lb / ${(s.set.load / LB_PER_KG).toFixed(1)} kg × ${s.set.reps} on ${s.day}, not an achieved max.`, ...context(s.day) });
  }
  return out;
}

export function gymRingBests(records: readonly GymRingRecord[], metric: GymRingRecord["metric"], classFilter: string): RingLifts {
  const out = emptyLifts();
  for (const row of records) {
    if (row.metric !== metric || (classFilter !== "all" && (row.classLabel ?? "unknown") !== classFilter)) continue;
    if (!out[row.lift] || row.lb > out[row.lift]!.lb) out[row.lift] = row;
  }
  return out;
}
