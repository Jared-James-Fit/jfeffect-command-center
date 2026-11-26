/**
 * The athlete's own meet information (pure, tested in competition-handling.test.ts):
 * what onboarding asks, which questions apply, what's already known, and which
 * changes matter enough to tell the coach.
 *
 * It lives on the competition (`competitions.athlete_info`), one record for the
 * meet that the gameplan, the timeline and the checklist all read. The event's
 * own details (federation, venue, start time, weigh-in, flight) go on the
 * competition's own columns; a time the coach confirmed is never overwritten by
 * an answer, which comes back as a change for him to accept instead.
 *
 * Every load is kilograms (typed in the athlete's unit, stored in kg).
 */
import type { Lift } from "./types";

export type InfoUnit = "kg" | "lb";
export type Trio = Partial<Record<Lift, number | null>>;

export type AthleteInfo = {
  unit?: InfoUnit;
  bodyweightKg?: number | null;
  bodyweightOn?: string | null;
  /** best meet lifts, kg */
  bests?: Trio;
  /** heaviest recent training single (or a recent max), kg */
  recent?: Trio;
  /** what they're aiming for on the day, kg */
  targets?: Trio;
  /** attempts already planned, kg (opener, second, third) */
  attempts?: Partial<Record<Lift, Array<number | null>>>;
  attemptsBy?: "me" | "my_coach" | "handler" | null;
  coach?: {
    has?: boolean | null;
    name?: string | null;
    contact?: string | null;
    writesTraining?: boolean | null;
  };
  shareWithCoach?: "yes" | "no" | null;
  warmupStyle?: "fewer" | "standard" | "more" | null;
  ownWarmups?: Partial<Record<Lift, Array<{ kg: number; reps: number }>>> | null;
  racks?: {
    squat?: { height?: string | null; safety?: string | null };
    bench?: { height?: string | null; safety?: string | null; footBlocks?: string | null };
  };
  gear?: string[];
  limitations?: string | null;
  travel?: {
    mode?: "local" | "drive" | "fly" | null;
    minutesToVenue?: number | null;
    arrive?: string | null;
    accommodation?: string | null;
    flightDetails?: string | null;
  };
  nutrition?: {
    afterWeighIn?: string | null;
    snacks?: string | null;
    caffeineMg?: number | null;
    notes?: string | null;
  };
  meetDay?: { phone?: string | null; emergencyName?: string | null; emergencyPhone?: string | null };
  /** the times they entered come from the meet's official schedule */
  officialTimes?: boolean | null;
  /** steps saved: step → ISO time */
  steps?: Record<string, string>;
  completedAt?: string | null;
};

export type StepKey = "event" | "body" | "lifts" | "coach" | "warmups" | "travel" | "day" | "confirm";
export const STEP_LABEL: Record<StepKey, string> = {
  event: "The meet",
  body: "Class and bodyweight",
  lifts: "Lifts and targets",
  coach: "Your coach",
  warmups: "Warm-ups and equipment",
  travel: "Travel",
  day: "Meet day",
  confirm: "Confirm",
};

export const GEAR_OPTIONS = [
  "Singlet",
  "Competition shirt",
  "Belt",
  "Knee sleeves",
  "Wrist wraps",
  "Squat shoes",
  "Deadlift shoes or slippers",
  "Deadlift socks",
  "Chalk",
] as const;

/**
 * Which steps they're asked: only what applies. A powerlifting meet asks lifts
 * and warm-ups; another sport doesn't. Travel is always one question (are they
 * travelling) and its follow-ups only when they are. The confirm step carries
 * the handling terms (and payment on the web) only when they're handled.
 */
export function stepsFor(o: { sport: string; handled: boolean }): StepKey[] {
  const pl = !o.sport || o.sport === "powerlifting";
  return [
    "event",
    ...(pl ? (["body", "lifts"] as StepKey[]) : []),
    "coach",
    ...(pl ? (["warmups"] as StepKey[]) : []),
    "travel",
    "day",
    ...(o.handled ? (["confirm"] as StepKey[]) : []),
  ];
}

/** Questions inside a step that apply to these answers. */
export function travelFollowUps(info: AthleteInfo): Array<"accommodation" | "arrive" | "flightDetails"> {
  const mode = info.travel?.mode;
  if (mode === "fly") return ["arrive", "flightDetails", "accommodation"];
  if (mode === "drive") return ["arrive", "accommodation"];
  return [];
}

export const KG_PER_LB = 0.45359237;
export function toKg(v: number, unit: InfoUnit): number {
  return unit === "lb" ? Math.round(v * KG_PER_LB * 100) / 100 : v;
}
export function fromKg(kg: number, unit: InfoUnit): number {
  return unit === "lb" ? Math.round((kg / KG_PER_LB) * 10) / 10 : Math.round(kg * 100) / 100;
}

/** A number typed in a box ("182.5", "182,5", "182.5 kg"), or null. */
export function readNumber(raw: unknown, lo = 0, hi = 1000): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= lo && raw <= hi ? raw : null;
  const s = String(raw ?? "").trim().replace(",", ".").replace(/[^\d.]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

const cleanText = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
const kgOrNull = (v: unknown, lo = 20, hi = 600): number | null => readNumber(v, lo, hi);
const trio = (v: unknown, lo = 20, hi = 600): Trio => {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const out: Trio = {};
  for (const l of ["squat", "bench", "deadlift"] as Lift[]) {
    const n = kgOrNull(o[l], lo, hi);
    if (n != null) out[l] = n;
  }
  return out;
};

/** A stored or submitted info object, cleaned: anything malformed is dropped, never guessed. */
export function readAthleteInfo(raw: unknown): AthleteInfo {
  const r = raw && typeof raw === "object" ? (raw as Record<string, any>) : {};
  const out: AthleteInfo = {};
  if (r.unit === "kg" || r.unit === "lb") out.unit = r.unit;
  const bw = readNumber(r.bodyweightKg, 25, 300);
  if (bw != null) out.bodyweightKg = bw;
  if (typeof r.bodyweightOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.bodyweightOn)) out.bodyweightOn = r.bodyweightOn;
  for (const k of ["bests", "recent", "targets"] as const) {
    const t = trio(r[k]);
    if (Object.keys(t).length) out[k] = t;
  }
  if (r.attempts && typeof r.attempts === "object") {
    const a: AthleteInfo["attempts"] = {};
    for (const l of ["squat", "bench", "deadlift"] as Lift[]) {
      const arr = Array.isArray(r.attempts[l]) ? (r.attempts[l] as unknown[]).slice(0, 3).map((x) => kgOrNull(x)) : null;
      if (arr && arr.some((x) => x != null)) a[l] = [arr[0] ?? null, arr[1] ?? null, arr[2] ?? null];
    }
    if (Object.keys(a).length) out.attempts = a;
  }
  if (["me", "my_coach", "handler"].includes(r.attemptsBy)) out.attemptsBy = r.attemptsBy;
  if (r.coach && typeof r.coach === "object") {
    out.coach = {
      has: typeof r.coach.has === "boolean" ? r.coach.has : null,
      name: cleanText(r.coach.name, 120),
      contact: cleanText(r.coach.contact, 160),
      writesTraining: typeof r.coach.writesTraining === "boolean" ? r.coach.writesTraining : null,
    };
  }
  if (r.shareWithCoach === "yes" || r.shareWithCoach === "no") out.shareWithCoach = r.shareWithCoach;
  if (["fewer", "standard", "more"].includes(r.warmupStyle)) out.warmupStyle = r.warmupStyle;
  if (r.ownWarmups && typeof r.ownWarmups === "object") {
    const w: NonNullable<AthleteInfo["ownWarmups"]> = {};
    for (const l of ["squat", "bench", "deadlift"] as Lift[]) {
      const rows = Array.isArray(r.ownWarmups[l]) ? (r.ownWarmups[l] as any[]) : [];
      const ok = rows
        .map((x) => ({ kg: readNumber(x?.kg, 15, 600), reps: readNumber(x?.reps, 1, 20) }))
        .filter((x): x is { kg: number; reps: number } => x.kg != null && x.reps != null)
        .slice(0, 12);
      if (ok.length) w[l] = ok;
    }
    if (Object.keys(w).length) out.ownWarmups = w;
  }
  if (r.racks && typeof r.racks === "object") {
    out.racks = {
      squat: { height: cleanText(r.racks.squat?.height, 20), safety: cleanText(r.racks.squat?.safety, 20) },
      bench: {
        height: cleanText(r.racks.bench?.height, 20),
        safety: cleanText(r.racks.bench?.safety, 20),
        footBlocks: cleanText(r.racks.bench?.footBlocks, 40),
      },
    };
  }
  if (Array.isArray(r.gear)) out.gear = [...new Set((r.gear as unknown[]).map((g) => cleanText(g, 60)).filter((g): g is string => !!g))].slice(0, 20);
  const lim = cleanText(r.limitations, 1000);
  if (lim) out.limitations = lim;
  if (r.travel && typeof r.travel === "object") {
    out.travel = {
      mode: ["local", "drive", "fly"].includes(r.travel.mode) ? r.travel.mode : null,
      minutesToVenue: readNumber(r.travel.minutesToVenue, 0, 600),
      arrive: cleanText(r.travel.arrive, 120),
      accommodation: cleanText(r.travel.accommodation, 200),
      flightDetails: cleanText(r.travel.flightDetails, 200),
    };
  }
  if (r.nutrition && typeof r.nutrition === "object") {
    out.nutrition = {
      afterWeighIn: cleanText(r.nutrition.afterWeighIn, 300),
      snacks: cleanText(r.nutrition.snacks, 300),
      caffeineMg: readNumber(r.nutrition.caffeineMg, 0, 600),
      notes: cleanText(r.nutrition.notes, 500),
    };
  }
  if (r.meetDay && typeof r.meetDay === "object") {
    out.meetDay = {
      phone: cleanText(r.meetDay.phone, 30),
      emergencyName: cleanText(r.meetDay.emergencyName, 80),
      emergencyPhone: cleanText(r.meetDay.emergencyPhone, 30),
    };
  }
  if (typeof r.officialTimes === "boolean") out.officialTimes = r.officialTimes;
  if (r.steps && typeof r.steps === "object") {
    const steps: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.steps as Record<string, unknown>))
      if (k in STEP_LABEL && typeof v === "string") steps[k] = v.slice(0, 40);
    out.steps = steps;
  }
  if (typeof r.completedAt === "string") out.completedAt = r.completedAt.slice(0, 40);
  return out;
}

/** Merge a step's answers into what's on file (a key the step didn't send stays as it was). */
export function mergeInfo(prev: AthleteInfo, patch: AthleteInfo): AthleteInfo {
  const out: AthleteInfo = { ...prev };
  for (const [k, v] of Object.entries(patch) as Array<[keyof AthleteInfo, any]>) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !Array.isArray(v) && prev[k] && typeof prev[k] === "object" && !Array.isArray(prev[k]))
      (out as any)[k] = { ...(prev[k] as object), ...v };
    else (out as any)[k] = v;
  }
  return readAthleteInfo(out);
}

/** Has onboarding reached its end? */
export function infoComplete(info: AthleteInfo, steps: StepKey[]): boolean {
  if (info.completedAt) return true;
  return steps.every((s) => !!info.steps?.[s]);
}

/* ------------------------------------------------------------------ */
/* Meaningful changes                                                 */

export type InfoChange = { key: string; text: string };

const kgWord = (kg: number | null | undefined) => (kg == null ? "nothing" : `${Math.round(kg * 10) / 10} kg`);

/**
 * What changed that the coach should see (pure): bodyweight by half a kilo or
 * more, the attempts, targets and planned lifts, rack heights, limitations,
 * travel, whether their coach may be told anything. Small edits (a typo in the
 * snacks) aren't flagged.
 */
export function infoChanges(prev: AthleteInfo, next: AthleteInfo): InfoChange[] {
  const out: InfoChange[] = [];
  const pbw = prev.bodyweightKg ?? null;
  const nbw = next.bodyweightKg ?? null;
  if (nbw != null && (pbw == null ? false : Math.abs(nbw - pbw) >= 0.5))
    out.push({ key: "bodyweight", text: `Bodyweight ${kgWord(pbw)} → ${kgWord(nbw)}` });
  const lifts: Lift[] = ["squat", "bench", "deadlift"];
  for (const l of lifts) {
    const pa = (prev.attempts?.[l] ?? []).join("/");
    const na = (next.attempts?.[l] ?? []).join("/");
    if (pa && na && pa !== na)
      out.push({ key: `attempts_${l}`, text: `${cap(l)} attempts ${pa.replace(/\//g, " / ")} → ${na.replace(/\//g, " / ")} kg` });
    else if (!pa && na) out.push({ key: `attempts_${l}`, text: `${cap(l)} attempts planned: ${na.replace(/\//g, " / ")} kg` });
    const pt = prev.targets?.[l] ?? null;
    const nt = next.targets?.[l] ?? null;
    if (pt != null && nt != null && pt !== nt) out.push({ key: `target_${l}`, text: `${cap(l)} target ${kgWord(pt)} → ${kgWord(nt)}` });
  }
  const rk = (i: AthleteInfo) => JSON.stringify([i.racks?.squat?.height ?? null, i.racks?.squat?.safety ?? null, i.racks?.bench?.height ?? null, i.racks?.bench?.safety ?? null, i.racks?.bench?.footBlocks ?? null]);
  if (prev.racks && rk(prev) !== rk(next)) out.push({ key: "racks", text: "Rack heights changed" });
  if ((prev.limitations ?? null) !== (next.limitations ?? null) && next.limitations)
    out.push({ key: "limitations", text: `Limitations: ${next.limitations.slice(0, 120)}` });
  if (prev.travel?.mode && next.travel?.mode && prev.travel.mode !== next.travel.mode)
    out.push({ key: "travel", text: `Travel: ${prev.travel.mode} → ${next.travel.mode}` });
  if ((prev.travel?.arrive ?? null) !== (next.travel?.arrive ?? null) && prev.travel?.arrive)
    out.push({ key: "arrive", text: `Arriving: ${next.travel?.arrive ?? "not set"}` });
  if (prev.shareWithCoach && next.shareWithCoach && prev.shareWithCoach !== next.shareWithCoach)
    out.push({ key: "share", text: next.shareWithCoach === "yes" ? "Now happy for their coach to see the plan" : "No longer wants their coach to see the plan" });
  return out;
}

/** Event fields an answer may set, and the change when the coach already confirmed one. */
export type EventPatch = Partial<{
  federation: string | null;
  location: string | null;
  lifting_start: string | null;
  weigh_in_at: string | null;
  flight: string | null;
  flights_in_session: number | null;
  lifters_per_flight: number | null;
  weight_class: string | null;
  division: string | null;
  timezone: string | null;
}>;

const EVENT_WORD: Record<keyof EventPatch, string> = {
  federation: "Federation",
  location: "Venue",
  lifting_start: "Lifting start",
  weigh_in_at: "Weigh-in",
  flight: "Flight",
  flights_in_session: "Flights in the session",
  lifters_per_flight: "Lifters per flight",
  weight_class: "Weight class",
  division: "Division",
  timezone: "Time zone",
};
const VERIFY_KEY: Partial<Record<keyof EventPatch, string>> = {
  lifting_start: "lifting_start",
  weigh_in_at: "weigh_in_at",
  flight: "flight",
  flights_in_session: "flights",
  lifters_per_flight: "lifters",
};

/**
 * Split an answer's event fields into what may be written now and what waits for
 * the coach: a value he confirmed from the meet's schedule is never overwritten.
 */
export function splitEventPatch(
  patch: EventPatch,
  current: Record<string, unknown>,
  verified: Record<string, boolean | undefined>,
): { write: EventPatch; proposed: InfoChange[] } {
  const write: EventPatch = {};
  const proposed: InfoChange[] = [];
  for (const [k, v] of Object.entries(patch) as Array<[keyof EventPatch, any]>) {
    if (v === undefined) continue;
    const cur = current[k] ?? null;
    if ((v ?? null) === cur) continue;
    const vk = VERIFY_KEY[k];
    if (vk && verified[vk] && cur != null) {
      proposed.push({ key: `event_${k}`, text: `${EVENT_WORD[k]}: they say ${v ?? "none"}, you confirmed ${cur}` });
      continue;
    }
    (write as any)[k] = v;
  }
  return { write, proposed };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
