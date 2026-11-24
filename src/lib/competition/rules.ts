/**
 * Federation rules the strategy engines and the meet-day calculator read
 * (pure, tested). Kept as data on the competition (`competitions.rules`), so a
 * coach can confirm or correct them for a meet; the scenario maths never
 * depends on a model.
 *
 * The IPF set is the IPF Technical Rules as its affiliates (CPU, CanPL,
 * USAPL's successor Powerlifting America, British Powerlifting…) run them:
 *  - every attempt is a multiple of 2.5 kg, and a lifter can never ask for less
 *    than their previous attempt (a miss is repeated at the same weight or
 *    more); a 4th attempt for a record may be in 0.5 kg steps and never counts
 *    toward the total;
 *  - the next attempt is declared within 1 minute of the last one finishing;
 *    the third deadlift may be changed twice;
 *  - equal totals: the lighter lifter at weigh-in places higher, then whoever
 *    made the total first;
 *  - weigh-in 2 hours before lifting.
 * `confirmed` stays false until the coach confirms them for the meet: the app
 * says "check the meet's rules" until then, it never claims a rule it hasn't
 * been told is right for that meet.
 */
import { weighInTiming } from "@/lib/weight-management/target";

export type TieBreak = "lighter_bodyweight" | "lot_number" | "unknown";

export type FederationRules = {
  family: "ipf" | "untested_24h" | "custom";
  /** Smallest step between attempts / the multiple every attempt is in (kg). */
  incrementKg: number;
  /** Record (4th) attempts' step, if any. */
  recordIncrementKg: number | null;
  /** A lifter may never ask for less than their previous attempt. */
  noLowerAfterAttempt: boolean;
  /** Seconds to declare the next attempt. */
  declareSeconds: number | null;
  /** Changes allowed to the third deadlift. */
  thirdDeadliftChanges: number | null;
  tieBreak: TieBreak;
  weighInHours: number | null;
  /** The coach confirmed these are the meet's rules. */
  confirmed: boolean;
  source: string;
};

export const IPF_RULES: FederationRules = {
  family: "ipf",
  incrementKg: 2.5,
  recordIncrementKg: 0.5,
  noLowerAfterAttempt: true,
  declareSeconds: 60,
  thirdDeadliftChanges: 2,
  tieBreak: "lighter_bodyweight",
  weighInHours: 2,
  confirmed: false,
  source: "IPF Technical Rules (applied by IPF affiliates)",
};

export const UNTESTED_24H_RULES: FederationRules = {
  ...IPF_RULES,
  family: "untested_24h",
  recordIncrementKg: 0.5,
  weighInHours: 24,
  tieBreak: "lighter_bodyweight",
  source: "Typical 24-hour weigh-in federation; check this meet's rulebook",
};

/** Rules to start from for a federation (the coach confirms them for the meet). */
export function rulesFor(federation: string | null | undefined): FederationRules {
  const w = weighInTiming(federation);
  if (w.known && w.hours === 24) return { ...UNTESTED_24H_RULES };
  if (w.known && w.hours === 2) return { ...IPF_RULES };
  // canpl and other IPF-pattern names weighInTiming doesn't list
  if (
    /\b(canpl|ipf|cpu|napf|commonwealth|powerlifting america|british powerlifting)\b/i.test(
      String(federation ?? ""),
    )
  )
    return { ...IPF_RULES };
  return {
    ...IPF_RULES,
    family: "custom",
    source: "Assumed IPF-style rules until the meet's own are confirmed",
  };
}

/** A stored rules object read safely (anything missing falls back to the federation's). */
export function readRules(raw: unknown, federation: string | null | undefined): FederationRules {
  const base = rulesFor(federation);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<FederationRules>;
  const num = (v: unknown, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
  return {
    family:
      r.family === "ipf" || r.family === "untested_24h" || r.family === "custom"
        ? r.family
        : base.family,
    incrementKg: num(r.incrementKg, 0.5, 10) ?? base.incrementKg,
    recordIncrementKg:
      r.recordIncrementKg === null
        ? null
        : (num(r.recordIncrementKg, 0.25, 5) ?? base.recordIncrementKg),
    noLowerAfterAttempt:
      typeof r.noLowerAfterAttempt === "boolean" ? r.noLowerAfterAttempt : base.noLowerAfterAttempt,
    declareSeconds:
      r.declareSeconds === null ? null : (num(r.declareSeconds, 10, 600) ?? base.declareSeconds),
    thirdDeadliftChanges:
      r.thirdDeadliftChanges === null
        ? null
        : (num(r.thirdDeadliftChanges, 0, 5) ?? base.thirdDeadliftChanges),
    tieBreak:
      r.tieBreak === "lighter_bodyweight" || r.tieBreak === "lot_number" || r.tieBreak === "unknown"
        ? r.tieBreak
        : base.tieBreak,
    weighInHours:
      r.weighInHours === null ? null : (num(r.weighInHours, 0, 48) ?? base.weighInHours),
    confirmed: r.confirmed === true,
    source:
      typeof r.source === "string" && r.source.trim() ? r.source.trim().slice(0, 200) : base.source,
  };
}

const EPS = 1e-6;
export const floorTo = (kg: number, step: number) => Math.floor(kg / step + EPS) * step;
export const ceilTo = (kg: number, step: number) => Math.ceil(kg / step - EPS) * step;
export const roundTo = (kg: number, step: number) => Math.round(kg / step) * step;

/** 2 decimals, no float dust. */
export const kgNum = (kg: number) => Math.round(kg * 100) / 100;

export const LB_PER_KG = 2.2046226218;
export const toLb = (kg: number) => Math.round(kg * LB_PER_KG * 10) / 10;

/** "200 kg (440.9 lb)" / "200 kg" */
export function kgText(kg: number | null | undefined, withLb = false): string {
  if (kg == null || !Number.isFinite(kg)) return "—";
  const k = kgNum(kg);
  const s = `${Number.isInteger(k) ? k : k.toFixed(k * 10 === Math.round(k * 10) ? 1 : 2)} kg`;
  return withLb ? `${s} (${toLb(kg)} lb)` : s;
}
