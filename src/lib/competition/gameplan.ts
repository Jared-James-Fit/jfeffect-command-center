/**
 * The competition gameplan (pure, tested in competition-handling.test.ts): attempts,
 * warm-ups, rack heights and equipment, the day's food and fluids, and who does
 * what, as one document the coach edits and the athlete confirms. It's
 * versioned in `competition_gameplans`; nothing here writes.
 *
 * Every part says where it stands:
 *  - confirmed    the athlete's or their coach's own numbers (their rack
 *                 heights, the attempts their coach set), or what the coach
 *                 approved;
 *  - estimated    worked out from their records (training and meets);
 *  - recommended  our suggestion (attempts and warm-ups built from what they
 *                 told us, the day's food);
 *  - unconfirmed  not known yet: never filled in with a guess.
 *
 * Attempts come, in order, from the athlete's own plan (theirs or their coach's:
 * handling never takes programming or attempt authority from an athlete's own
 * coach), else Competition Intelligence's plan from their records, else a plan
 * from the lifts they told us (planLiftAttempts on a narrow range around their
 * target or recent best). Warm-ups are their own ladder when they gave one, else
 * the warm-up engine's (warmups.ts) from their opener, their habits on record or
 * the style they asked for. Weights are kilograms, on the federation's increment.
 */
import { planLiftAttempts, type AttemptPlan } from "./attempts";
import type { AthleteInfo } from "./athlete-info";
import { floorTo, type FederationRules } from "./rules";
import type { Lift, Objective, Range } from "./types";
import { planWarmups, type WarmupHistory } from "./warmups";
import type { GameplanIntel } from "@/lib/athlete-intel/engine-input";

export const LIFTS: Lift[] = ["squat", "bench", "deadlift"];
export type PlanStatus = "confirmed" | "estimated" | "recommended" | "unconfirmed";
export type PlanSource = "athlete" | "coach" | "existing_coach" | "cleo" | "records";
export const SOURCE_WORD: Record<PlanSource, string> = {
  athlete: "from the athlete",
  coach: "from the coach",
  existing_coach: "from their coach",
  cleo: "Cleo's suggestion",
  records: "from their records",
};

export type AttemptLine = {
  opener: number | null;
  second: number | null;
  third: number | null;
  secondRange?: [number, number] | null;
  thirdRange?: [number, number] | null;
  status: PlanStatus;
  source: PlanSource;
  note?: string | null;
};
export type WarmupRow = { kg: number; reps: number; minutesBefore: number | null; note?: string | null };
export type RackSetting = { height: string | null; safety: string | null; footBlocks?: string | null };
export type Contact = { name: string; role: string; phone?: string | null; responsibility?: string | null };

export type GameplanDoc = {
  v: 1;
  attempts: Partial<Record<Lift, AttemptLine>>;
  warmups: Partial<Record<Lift, { rows: WarmupRow[]; status: PlanStatus; source: PlanSource }>>;
  equipment: {
    racks: Partial<Record<Lift, RackSetting>>;
    gear: string[];
    status: PlanStatus;
  };
  day: { afterWeighIn: string[]; during: string[]; caffeine: string | null; notes: string[] };
  contacts: Contact[];
  /** technical cues per lift, from the athlete's own coach or their notes (Athlete Intelligence) */
  cues: Partial<Record<Lift, string[]>>;
  /** their own coach's instructions for the meet, attributed ("Coach Sarah: …") */
  instructions: string[];
  /** why the numbers are what they are (shown folded) */
  why: string[];
};

export function emptyGameplan(): GameplanDoc {
  return {
    v: 1,
    attempts: {},
    warmups: {},
    equipment: { racks: {}, gear: [], status: "unconfirmed" },
    day: { afterWeighIn: [], during: [], caffeine: null, notes: [] },
    contacts: [],
    cues: {},
    instructions: [],
    why: [],
  };
}

/** A stored plan read safely (never throws; anything malformed is left out). */
export function readGameplan(raw: unknown): GameplanDoc {
  const g = emptyGameplan();
  const r = raw && typeof raw === "object" ? (raw as Record<string, any>) : {};
  const st = (s: unknown): PlanStatus =>
    s === "confirmed" || s === "estimated" || s === "recommended" ? s : "unconfirmed";
  const src = (s: unknown): PlanSource =>
    s === "athlete" || s === "coach" || s === "existing_coach" || s === "records" ? s : "cleo";
  const num = (v: unknown, lo = 0, hi = 600) =>
    typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
  for (const l of LIFTS) {
    const a = r.attempts?.[l];
    if (a && typeof a === "object") {
      const pair = (x: unknown): [number, number] | null =>
        Array.isArray(x) && num(x[0]) != null && num(x[1]) != null ? [x[0], x[1]] : null;
      g.attempts[l] = {
        opener: num(a.opener),
        second: num(a.second),
        third: num(a.third),
        secondRange: pair(a.secondRange),
        thirdRange: pair(a.thirdRange),
        status: st(a.status),
        source: src(a.source),
        note: typeof a.note === "string" ? a.note.slice(0, 300) : null,
      };
    }
    const w = r.warmups?.[l];
    if (w && Array.isArray(w.rows)) {
      const rows: WarmupRow[] = [];
      for (const x of w.rows as any[]) {
        const kgv = num(x?.kg, 0, 600);
        const reps = num(x?.reps, 1, 30);
        if (kgv == null || reps == null) continue;
        rows.push({ kg: kgv, reps, minutesBefore: num(x?.minutesBefore, 0, 180), note: typeof x?.note === "string" ? x.note.slice(0, 120) : null });
        if (rows.length >= 14) break;
      }
      g.warmups[l] = {
        rows,
        status: st(w.status),
        source: src(w.source),
      };
    }
    const rk = r.equipment?.racks?.[l];
    if (rk && typeof rk === "object") {
      const t = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 40) : null);
      g.equipment.racks[l] = { height: t(rk.height), safety: t(rk.safety), footBlocks: t(rk.footBlocks) };
    }
  }
  if (Array.isArray(r.equipment?.gear))
    g.equipment.gear = (r.equipment.gear as unknown[]).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 60)).slice(0, 24);
  g.equipment.status = st(r.equipment?.status);
  const lines = (x: unknown) =>
    Array.isArray(x) ? (x as unknown[]).filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim().slice(0, 300)).slice(0, 12) : [];
  g.day = {
    afterWeighIn: lines(r.day?.afterWeighIn),
    during: lines(r.day?.during),
    caffeine: typeof r.day?.caffeine === "string" ? r.day.caffeine.slice(0, 200) : null,
    notes: lines(r.day?.notes),
  };
  if (Array.isArray(r.contacts))
    g.contacts = (r.contacts as any[])
      .filter((c) => c && typeof c.name === "string" && c.name.trim())
      .map((c) => ({
        name: String(c.name).trim().slice(0, 80),
        role: String(c.role ?? "").trim().slice(0, 40) || "Contact",
        phone: typeof c.phone === "string" && c.phone.trim() ? c.phone.trim().slice(0, 30) : null,
        responsibility: typeof c.responsibility === "string" && c.responsibility.trim() ? c.responsibility.trim().slice(0, 200) : null,
      }))
      .slice(0, 8);
  for (const l of LIFTS) {
    const c = lines(r.cues?.[l]).map((x) => x.slice(0, 160)).slice(0, 4);
    if (c.length) g.cues[l] = c;
  }
  g.instructions = lines(r.instructions).slice(0, 8);
  g.why = lines(r.why);
  return g;
}

const WARMUP_STYLE: Record<"fewer" | "standard" | "more", { sets: number; why: string }> = {
  fewer: { sets: 5, why: "Fewer warm-up sets, as they asked" },
  standard: { sets: 6, why: "A standard number of warm-up sets" },
  more: { sets: 8, why: "More warm-up sets, as they asked" },
};

export type DraftInput = {
  rules: FederationRules;
  objective?: Objective | null;
  info: AthleteInfo;
  /** Competition Intelligence's attempt plan from their records, when it has one */
  recordsAttempts?: AttemptPlan | null;
  /** their warm-up habits on record (pl_warmup_sets), per lift */
  warmupHistory?: Partial<Record<Lift, WarmupHistory>>;
  handler?: { name: string; phone?: string | null } | null;
  athlete: { name: string; phone?: string | null };
  /** their own coach, only when the athlete said their coach may be named here */
  existingCoach?: { name: string; contact?: string | null } | null;
  /** caffeine they use in training (mg), when known */
  caffeineMg?: number | null;
  /** what uploaded athlete information says (Athlete Intelligence): their coach's attempts and warm-ups, racks, cues */
  intel?: (GameplanIntel & { conflicts?: Lift[] }) | null;
};

const BY_SOURCE: Record<string, PlanSource> = { primary_coach: "existing_coach", athlete: "athlete", handler: "coach", other_coach: "coach", other: "coach", unknown: "coach" };

/** A narrow range around what they told us: the target if they gave one, else their recent or best single. */
function statedRange(info: AthleteInfo, lift: Lift): Range | null {
  const expected = info.targets?.[lift] ?? info.recent?.[lift] ?? info.bests?.[lift] ?? null;
  if (expected == null) return null;
  return { conservative: expected * 0.97, expected, high: expected * 1.02 };
}

/** The gameplan Cleo starts from (deterministic). */
export function draftGameplan(input: DraftInput): GameplanDoc {
  const g = emptyGameplan();
  const step = input.rules.incrementKg;
  const why: string[] = [];
  const info = input.info;
  const intel = input.intel ?? null;
  const conflicts = new Set(intel?.conflicts ?? []);
  const intelAttempt = (lift: Lift) => {
    const c = intel?.attempts?.[lift];
    if (!c || c.opener == null || conflicts.has(lift)) return false;
    const by = c.by;
    const confirmed = by === "primary_coach" || by === "athlete";
    g.attempts[lift] = {
      opener: c.opener,
      second: c.second,
      third: c.third,
      status: confirmed ? "confirmed" : "recommended",
      source: BY_SOURCE[by] ?? "coach",
      note: by === "primary_coach" ? `Set by their coach (${c.label})` : by === "athlete" ? "Their own plan" : `From ${c.label}`,
    };
    return true;
  };
  for (const lift of LIFTS) {
    // an answer that settled whose plan is current comes first
    if (intel?.attempts?.[lift]?.basis === "answer" && intelAttempt(lift)) continue;
    const own = info.attempts?.[lift];
    if (own && own.some((x) => x != null) && (info.attemptsBy === "me" || info.attemptsBy === "my_coach")) {
      g.attempts[lift] = {
        opener: own[0] ?? null,
        second: own[1] ?? null,
        third: own[2] ?? null,
        status: "confirmed",
        source: info.attemptsBy === "my_coach" ? "existing_coach" : "athlete",
        note: info.attemptsBy === "my_coach" ? "Set by their coach" : "Their own plan",
      };
      continue;
    }
    if (intelAttempt(lift)) continue;
    const rec = input.recordsAttempts?.lifts?.[lift] ?? null;
    if (rec) {
      g.attempts[lift] = {
        opener: rec.opener,
        second: rec.pathways.balanced[1],
        third: rec.pathways.balanced[2],
        secondRange: [rec.second.low, rec.second.high],
        thirdRange: [rec.third.low, rec.third.high],
        status: "estimated",
        source: "records",
        note: conflicts.has(lift) ? "Two attempt plans on file disagree: estimated from records until it's settled" : null,
      };
      continue;
    }
    const range = statedRange(info, lift);
    if (range) {
      const p = planLiftAttempts({ lift, range, rules: input.rules, objective: input.objective ?? null });
      g.attempts[lift] = {
        opener: p.opener,
        second: p.pathways.balanced[1],
        third: p.pathways.balanced[2],
        secondRange: [p.second.low, p.second.high],
        thirdRange: [p.third.low, p.third.high],
        status: "recommended",
        source: "cleo",
        note: info.targets?.[lift] != null ? "Built around their target" : "Built from their recent lifts",
      };
      continue;
    }
    g.attempts[lift] = { opener: null, second: null, third: null, status: "unconfirmed", source: "cleo", note: "No lifts on file yet" };
  }
  if (input.recordsAttempts) why.push("Attempts from their training and meet records where they have no plan of their own");
  if (intel && LIFTS.some((l) => g.attempts[l]?.source === "existing_coach")) why.push("Attempts their own coach set (uploaded information) are kept as they are");

  for (const lift of LIFTS) {
    const opener = g.attempts[lift]?.opener ?? null;
    const own = info.ownWarmups?.[lift];
    if (own?.length && (opener == null || own[own.length - 1].kg < opener)) {
      g.warmups[lift] = {
        rows: own.map((r, i) => ({ kg: r.kg, reps: r.reps, minutesBefore: null, note: i === own.length - 1 ? "Last warm-up" : null })),
        status: "confirmed",
        source: "athlete",
      };
      continue;
    }
    const iw = intel?.warmups?.[lift];
    if (iw && iw.rows.length >= 2) {
      const rows = iw.rows
        .map((r) => ({ kg: r.kg ?? (r.pct != null && opener != null ? floorTo((opener * r.pct) / 100, step) : null), reps: r.reps }))
        .filter((r): r is { kg: number; reps: number } => r.kg != null && r.kg > 0);
      if (rows.length >= 2 && (opener == null || rows[rows.length - 1].kg < opener)) {
        g.warmups[lift] = {
          rows: rows.map((r, i) => ({ kg: r.kg, reps: r.reps, minutesBefore: null, note: i === rows.length - 1 ? "Last warm-up" : null })),
          status: iw.by === "primary_coach" || iw.by === "athlete" ? "confirmed" : "recommended",
          source: BY_SOURCE[iw.by] ?? "coach",
        };
        why.push(`${lift[0].toUpperCase()}${lift.slice(1)} warm-ups as ${iw.label} wrote them`);
        continue;
      }
    }
    if (opener == null) continue;
    const hist = input.warmupHistory?.[lift] ?? null;
    const style = info.warmupStyle ? WARMUP_STYLE[info.warmupStyle] : null;
    const history: WarmupHistory | null =
      hist && hist.sessions >= 3
        ? hist
        : style
          ? { sessions: 3, medianSets: style.sets, lastPct: null }
          : null;
    const plan = planWarmups({ lift, openerKg: opener, history, step });
    g.warmups[lift] = {
      rows: plan.sets.map((s) => ({ kg: s.kg, reps: s.reps, minutesBefore: s.minutesBefore })),
      status: "recommended",
      source: hist && hist.sessions >= 3 ? "records" : "cleo",
    };
    if (style && !(hist && hist.sessions >= 3)) why.push(`${lift[0].toUpperCase()}${lift.slice(1)} warm-ups: ${style.why.toLowerCase()}`);
  }

  const racks = info.racks;
  const ir = intel?.racks ?? {};
  if (racks?.squat?.height || racks?.squat?.safety) g.equipment.racks.squat = { height: racks.squat.height ?? null, safety: racks.squat.safety ?? null };
  else if (ir.squat?.height || ir.squat?.safety) g.equipment.racks.squat = { height: ir.squat.height ?? null, safety: ir.squat.safety ?? null };
  if (racks?.bench?.height || racks?.bench?.safety || racks?.bench?.footBlocks)
    g.equipment.racks.bench = { height: racks.bench.height ?? null, safety: racks.bench.safety ?? null, footBlocks: racks.bench.footBlocks ?? null };
  else if (ir.bench?.height || ir.bench?.safety || ir.bench?.footBlocks)
    g.equipment.racks.bench = { height: ir.bench.height ?? null, safety: ir.bench.safety ?? null, footBlocks: ir.bench.footBlocks ?? null };
  g.equipment.gear = [...(info.gear ?? [])];
  for (const x of intel?.gear ?? []) if (!g.equipment.gear.some((y) => y.toLowerCase() === x.toLowerCase())) g.equipment.gear.push(x);
  g.equipment.status = g.equipment.racks.squat?.height && g.equipment.racks.bench?.height ? "confirmed" : "unconfirmed";
  for (const l of LIFTS) if (intel?.cues?.[l]?.length) g.cues[l] = intel.cues[l]!.slice(0, 4);
  g.instructions = [...(intel?.instructions ?? []), ...(intel?.generalCues ?? []).map((c) => `Cue: ${c}`)].slice(0, 8);

  g.day.afterWeighIn = [
    info.nutrition?.afterWeighIn
      ? `After weigh-in: ${info.nutrition.afterWeighIn}`
      : "Straight after weigh-in: carbohydrate and fluids, food you know sits well",
  ];
  g.day.during = [
    info.nutrition?.snacks ? `Between lifts: ${info.nutrition.snacks}` : "A small snack and fluids within 10 minutes of each lift finishing",
    "Sip fluids through the day; nothing new on meet day",
  ];
  const caffeine = info.nutrition?.caffeineMg ?? input.caffeineMg ?? null;
  g.day.caffeine = caffeine
    ? `About ${caffeine} mg, what they use in training, about 45 minutes before the squat opener`
    : "Only if they use it in training, the same amount";
  if (info.limitations) g.day.notes.push(`Limitations: ${info.limitations}`);

  if (input.handler) g.contacts.push({ name: input.handler.name, role: "Handler", phone: input.handler.phone ?? null, responsibility: "Attempt cards, warm-up timing and calls on the day" });
  g.contacts.push({ name: input.athlete.name, role: "Athlete", phone: info.meetDay?.phone ?? input.athlete.phone ?? null, responsibility: "Lifts; tells the handler how warm-ups feel" });
  if (input.existingCoach) g.contacts.push({ name: input.existingCoach.name, role: "Coach", phone: null, responsibility: "Their training; consulted on attempts" });
  if (info.meetDay?.emergencyName) g.contacts.push({ name: info.meetDay.emergencyName, role: "Emergency contact", phone: info.meetDay.emergencyPhone ?? null, responsibility: null });
  g.why = why;
  return g;
}

/* ------------------------------------------------------------------ */
/* Checks                                                             */

export type PlanProblem = { area: "attempts" | "warmups" | "equipment"; lift?: Lift; text: string; severity: "error" | "warning" };

const EPS = 1e-6;
const onStep = (kg: number, step: number) => Math.abs(kg / step - Math.round(kg / step)) < 1e-4;

/** What's wrong with a plan before it's approved: attempts that don't rise, off the increment, a warm-up at or past the opener. */
export function checkGameplan(g: GameplanDoc, rules: FederationRules): PlanProblem[] {
  const out: PlanProblem[] = [];
  const step = rules.incrementKg;
  for (const lift of LIFTS) {
    const a = g.attempts[lift];
    const word = lift[0].toUpperCase() + lift.slice(1);
    if (a) {
      const xs = [a.opener, a.second, a.third];
      xs.forEach((x, i) => {
        if (x != null && !onStep(x, step))
          out.push({ area: "attempts", lift, text: `${word} ${["opener", "second", "third"][i]} ${x} kg isn't a multiple of ${step} kg`, severity: "error" });
      });
      for (let i = 1; i < 3; i++) {
        const p = xs[i - 1];
        const c = xs[i];
        if (p != null && c != null && c < p + step - EPS)
          out.push({ area: "attempts", lift, text: `${word} attempts have to rise by at least ${step} kg`, severity: "error" });
      }
    }
    const w = g.warmups[lift];
    if (w?.rows.length) {
      for (let i = 1; i < w.rows.length; i++)
        if (w.rows[i].kg < w.rows[i - 1].kg)
          out.push({ area: "warmups", lift, text: `${word} warm-ups go down at set ${i + 1}`, severity: "warning" });
      const last = w.rows[w.rows.length - 1].kg;
      const opener = a?.opener ?? null;
      if (opener != null && last >= opener)
        out.push({ area: "warmups", lift, text: `${word} last warm-up (${last} kg) is at or over the opener`, severity: "error" });
      else if (opener != null && last < opener * 0.8)
        out.push({ area: "warmups", lift, text: `${word} last warm-up is under 80% of the opener`, severity: "warning" });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Comparing versions                                                 */

export type PlanChange = { area: "attempts" | "warmups" | "equipment" | "day" | "contacts"; lift?: Lift; text: string };

const kg = (x: number | null | undefined) => (x == null ? "–" : `${x}`);

/** What changed between two versions, in words (for the history, the suggestion card, undo). */
export function diffGameplans(a: GameplanDoc, b: GameplanDoc): PlanChange[] {
  const out: PlanChange[] = [];
  for (const lift of LIFTS) {
    const word = lift[0].toUpperCase() + lift.slice(1);
    const pa = a.attempts[lift];
    const pb = b.attempts[lift];
    const fa = [pa?.opener, pa?.second, pa?.third].map(kg).join(" / ");
    const fb = [pb?.opener, pb?.second, pb?.third].map(kg).join(" / ");
    if (fa !== fb) out.push({ area: "attempts", lift, text: `${word} attempts ${fa} → ${fb} kg` });
    const wa = (a.warmups[lift]?.rows ?? []).map((r) => `${r.kg}×${r.reps}`).join(", ");
    const wb = (b.warmups[lift]?.rows ?? []).map((r) => `${r.kg}×${r.reps}`).join(", ");
    if (wa !== wb) out.push({ area: "warmups", lift, text: wb ? `${word} warm-ups: ${wb}` : `${word} warm-ups removed` });
    const ra = a.equipment.racks[lift];
    const rb = b.equipment.racks[lift];
    const rs = (r?: RackSetting) => [r?.height, r?.safety, r?.footBlocks].map((x) => x ?? "–").join("/");
    if (rs(ra) !== rs(rb)) out.push({ area: "equipment", lift, text: `${word} rack ${rackText(rb) || "cleared"}` });
  }
  if (a.equipment.gear.join("|") !== b.equipment.gear.join("|")) out.push({ area: "equipment", text: "Gear list changed" });
  if (JSON.stringify(a.day) !== JSON.stringify(b.day)) out.push({ area: "day", text: "Meet-day food and fluids changed" });
  if (JSON.stringify(a.contacts) !== JSON.stringify(b.contacts)) out.push({ area: "contacts", text: "Contacts changed" });
  if (JSON.stringify(a.cues ?? {}) !== JSON.stringify(b.cues ?? {})) out.push({ area: "day", text: "Technical cues changed" });
  if ((a.instructions ?? []).join("|") !== (b.instructions ?? []).join("|")) out.push({ area: "day", text: "Their coach's notes changed" });
  return out;
}

/** "Height 9 · safeties 6 · blocks 2" */
export function rackText(r?: RackSetting | null): string {
  if (!r) return "";
  return [r.height ? `Height ${r.height}` : null, r.safety ? `safeties ${r.safety}` : null, r.footBlocks ? `blocks ${r.footBlocks}` : null]
    .filter(Boolean)
    .join(" · ");
}

/** Attempts in kg as the timeline and meet-day read them. */
export function planAttemptsTrio(g: GameplanDoc): Partial<Record<Lift, Array<number | null>>> {
  const out: Partial<Record<Lift, Array<number | null>>> = {};
  for (const l of LIFTS) {
    const a = g.attempts[l];
    if (a) out[l] = [a.opener, a.second, a.third];
  }
  return out;
}

/** Warm-ups with their minutes before the opener (a row with none gets the engine's spacing). */
export function planWarmupTimes(g: GameplanDoc): Partial<Record<Lift, Array<{ kg: number; reps: number; minutesBefore: number }>>> {
  const out: Partial<Record<Lift, Array<{ kg: number; reps: number; minutesBefore: number }>>> = {};
  for (const l of LIFTS) {
    const rows = g.warmups[l]?.rows ?? [];
    if (!rows.length) continue;
    const opener = g.attempts[l]?.opener ?? null;
    // last set ~8 minutes before the opener, heavier sets 4 minutes apart, lighter 3 (warmups.ts)
    let t = 8;
    const timed: Array<{ kg: number; reps: number; minutesBefore: number }> = [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (i < rows.length - 1) t += opener && r.kg >= opener * 0.75 ? 4 : 3;
      timed.unshift({ kg: r.kg, reps: r.reps, minutesBefore: r.minutesBefore ?? t });
    }
    out[l] = timed;
  }
  return out;
}

/** Round a typed attempt down to the increment (the editor's quick fix). */
export const snapAttempt = (kgValue: number, step: number) => floorTo(kgValue, step);
