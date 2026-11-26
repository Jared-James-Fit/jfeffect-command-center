import type { BodyweightPoint } from "@/lib/bodyweight";
import type { MeetResult } from "@/lib/analytics/competition-strength";
import { classLimitKg, ipfLimits } from "@/lib/weight-management/target";
import { LB_PER_KG } from "@/lib/analytics/units";

const DAY = 86_400_000;
const ms = (day: string) => Date.parse(`${day}T00:00:00Z`);
const dateAt = (day: string, offset: number) => new Date(ms(day) + offset * DAY).toISOString().slice(0, 10);

export type WeightSample = { day: string; kg: number };
export type WeightReference = { kg: number; label: string };
export type WeightContext = {
  latest: WeightSample | null;
  averageKg: number | null;
  samples: number;
  category: WeightReference | null;
};

export function normalizeWeights(points: readonly BodyweightPoint[]): WeightSample[] {
  const days = new Map<string, number>();
  for (const p of points) {
    if (!Number.isFinite(ms(p.date)) || !Number.isFinite(p.value) || p.value <= 0) continue;
    if (p.unit !== "kg" && p.unit !== "lb") continue;
    days.set(p.date, p.unit === "kg" ? p.value : p.value / LB_PER_KG);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, kg]) => ({ day, kg }));
}

/** IPF reference weights only when the federation is known. Other federations
 * use recorded finite class references, not guessed eligibility limits. */
export function weightReferences(meets: readonly MeetResult[], sex: "male" | "female" | null): WeightReference[] {
  const latest = [...meets].sort((a, b) => b.date.localeCompare(a.date)).find((m) => m.federation);
  const ipf = /\b(ipf|cpu|canpl|napf|epf|commonwealth|powerlifting america|british powerlifting)\b/i.test(latest?.federation ?? "");
  const known = meets.map((m) => classLimitKg(m.weightClass)).filter((v): v is number => v != null);
  const refs = ipf && sex ? [...ipfLimits(sex === "male" ? "M" : "F"), ...known.filter((v) => v === (sex === "male" ? 53 : 43))] : known;
  return [...new Set(refs)].sort((a, b) => a - b).map((kg) => ({ kg, label: `${kg} kg` }));
}

export function nearestWeightReference(kg: number, refs: readonly WeightReference[]): WeightReference | null {
  if (!Number.isFinite(kg) || kg <= 0) return null;
  return [...refs].sort((a, b) => Math.abs(a.kg - kg) - Math.abs(b.kg - kg) || a.kg - b.kg)[0] ?? null;
}

/** Uses only data on or before the record date. Require two weigh-ins for a
 * category; sparse/stale logs remain uncategorized rather than guessing. */
export function weightContextAt(points: readonly WeightSample[], refs: readonly WeightReference[], day: string): WeightContext {
  if (!Number.isFinite(ms(day))) return { latest: null, averageKg: null, samples: 0, category: null };
  const eligible = points.filter((p) => p.day <= day).sort((a,b)=>a.day.localeCompare(b.day));
  const latest = eligible[eligible.length - 1] ?? null;
  const week = eligible.filter((p) => p.day >= dateAt(day, -6));
  const averageKg = week.length >= 2 ? week.reduce((s, p) => s + p.kg, 0) / week.length : null;
  let category = averageKg == null ? null : nearestWeightReference(averageKg, refs);
  // Hysteresis: require a 0.5 kg margin beyond a class midpoint when a recent
  // prior average establishes another reference. No future weigh-ins enter this read.
  if(category&&averageKg!=null){const prior=eligible.filter(p=>p.day<day&&p.day>=dateAt(day,-7));if(prior.length>=2){const priorAvg=prior.reduce((s,p)=>s+p.kg,0)/prior.length;const previous=nearestWeightReference(priorAvg,refs);if(previous&&previous.label!==category.label&&Math.abs(previous.kg-averageKg)-Math.abs(category.kg-averageKg)<1)category=previous;}}
  return { latest, averageKg, samples: week.length, category };
}

export type WeightPeriod = { category: string; start: string; end: string; averageKg: number; lowKg: number; highKg: number; samples: number };

/** Separate observed periods, including returns to the same class. Do not
 * bridge gaps over seven days; dates are observed, not inferred. */
export function weightPeriods(points: readonly WeightSample[], refs: readonly WeightReference[]): WeightPeriod[] {
  const periods: WeightPeriod[] = [];
  for (const point of points) {
    const ctx = weightContextAt(points, refs, point.day);
    const category = ctx.category?.label;
    if (!category) continue;
    const last = periods[periods.length - 1];
    if (last && last.category === category && ms(point.day) - ms(last.end) <= 7 * DAY) {
      last.end = point.day;
      last.averageKg = (last.averageKg * last.samples + point.kg) / (last.samples + 1);
      last.samples += 1;
      last.lowKg = Math.min(last.lowKg, point.kg);
      last.highKg = Math.max(last.highKg, point.kg);
    } else {
      periods.push({ category, start: point.day, end: point.day, averageKg: point.kg, lowKg: point.kg, highKg: point.kg, samples: 1 });
    }
  }
  return periods.reverse();
}
