/**
 * The roadmap's blocks: how many, how long, what each is for and in what
 * order, decided from the goal, the time there is and what their data says.
 * Never one fixed template: a far-off meet with a small gap fuels training
 * first and cuts late; a close one starts now; a long contest prep slows as
 * they get leaner and earns a diet break; a gain stabilizes after months of
 * surplus; every competition is followed by recovery and a transition.
 *
 * Competition logic (powerlifting and other weight-class sports): the class
 * weight is reached before the strength peak, so the peak and meet week are
 * fueled at maintenance with carbohydrate prioritised. The weight is made in
 * a normal, fed and hydrated state; nothing here plans dehydration, water or
 * sodium manipulation or an acute cut (ACSM and the powerlifting weight
 * management literature: gradual loss protects strength). Bodybuilding shows
 * hold the targets through show week, with no unvalidated peak-week practice.
 *
 * Only the current block is final. Every later block is a forecast that is
 * recalculated as real data comes in. Pure.
 */
import { addDays, daysBetween, fmtDay, fmtRate, fmtWeight, round, type WeightUnit } from "@/lib/weight-management/units";
import type { Level } from "@/lib/weight-management/target";
import { kcalForRate, macrosFor, maintenanceAt, r25, rateForKcal, restingEnergy, splitDays, MAX_DEFICIT_SHARE } from "@/lib/nutrition-roadmap/energy";
import { WEIGH_IN_RULE } from "@/lib/nutrition-roadmap/safety";
import { ratesFor } from "@/lib/nutrition-roadmap/feasibility";
import { BLOCK_LABEL, type Block, type BlockEnergy, type BlockKind, type Checkpoint, type EnergyEstimate, type Macros, type RoadmapGoal, type Safety } from "@/lib/nutrition-roadmap/types";

/** The longest one block runs before it's reviewed as a new one. */
export const MAX_BLOCK_WEEKS = 12;
/** A diet break after this many weeks of dieting, when the timeline has room. */
export const DIET_BREAK_EVERY_WEEKS = 10;
export const BASELINE_DAYS = 14;
export const POST_COMP_DAYS = { strength: 14, physique: 28 } as const;
export const TRANSITION_DAYS = 28;
/** With no date, a roadmap plans this far and is reviewed from there. */
export const OPEN_HORIZON_WEEKS = 16;
export const MAX_HORIZON_WEEKS = 52;

export type CurrentPlan = {
  start: string | null;
  /** The plan's phase (Fat Loss, Muscle Gain, Maintenance…): a block of the same kind started when it did. */
  phase?: string | null;
  /** The plan's days: Training / Non-Training / High, with their numbers. */
  days: Array<{ label: string; kcal: number | null; protein: number | null; carbs: number | null; fat: number | null }>;
  /** The plan's average day across their week. */
  weeklyKcal: number | null;
};

export type BlocksInput = {
  today: string;
  unit: WeightUnit;
  goal: RoadmapGoal | null;
  currentKg: number;
  level: Level | null;
  sex: "M" | "F" | null;
  age: number | null;
  heightCm: number | null;
  energy: EnergyEstimate;
  /** The rate the feasibility check plans (signed, kg a week) and the date the weight is made by. */
  plannedKgPerWeek: number;
  /** The fastest this person may change, kg a week (the rate limit and the energy floor). */
  maxKgPerWeek: number;
  makeBy: string | null;
  safety: Safety;
  trainingDays: number;
  strengthSport: boolean;
  plan: CurrentPlan | null;
  /** Little data yet: the first 2 weeks set the real numbers, when the timeline has room. */
  needsBaseline: boolean;
  /** A competition in the last 3 weeks, when no new goal is set. */
  recentEvent: { name: string | null; date: string; physique: boolean } | null;
  /** The next competition after the goal's, for the transition. */
  nextEvent: { name: string | null; date: string } | null;
  noiseKg: number | null;
};

type Seg = { kind: BlockKind; days: number; kgPerWeek: number; part?: number; parts?: number; note?: string };

const pct = (kgPerWeek: number, kg: number) => round((kgPerWeek / kg) * 100, 2);

/** Split a long run of one kind into blocks of at most MAX_BLOCK_WEEKS. */
function chunk(kind: BlockKind, days: number, kgPerWeek: number): Seg[] {
  if (days <= 0) return [];
  // a 12-week block with its last day inclusive is still one block
  const n = Math.max(1, Math.ceil((days - 7) / (MAX_BLOCK_WEEKS * 7)));
  const each = Math.floor(days / n);
  return Array.from({ length: n }, (_, i) => ({ kind, days: i === n - 1 ? days - each * (n - 1) : each, kgPerWeek, part: n > 1 ? i + 1 : undefined, parts: n > 1 ? n : undefined }));
}

/**
 * A long diet, with a one-week diet break every DIET_BREAK_EVERY_WEEKS when
 * the time allows it without pushing the rate past comfortable (Byrne et al.
 * 2018; Peos et al. 2021: breaks keep training quality and adherence, at
 * worst cost nothing). Returns null when there's no room for breaks.
 */
function dietWithBreaks(kind: BlockKind, days: number, changeKg: number, comfortableKgPerWeek: number): Seg[] | null {
  const weeks = days / 7;
  if (weeks < 16) return null;
  const breaks = Math.floor(weeks / (DIET_BREAK_EVERY_WEEKS + 1));
  if (!breaks) return null;
  const dietDays = days - breaks * 7;
  const rate = changeKg / (dietDays / 7);
  if (Math.abs(rate) > comfortableKgPerWeek) return null;
  const segs: Seg[] = [];
  const stretch = Math.floor(dietDays / (breaks + 1));
  for (let i = 0; i <= breaks; i++) {
    segs.push({ kind, days: i === breaks ? dietDays - stretch * breaks : stretch, kgPerWeek: rate, part: i + 1, parts: breaks + 1 });
    if (i < breaks) segs.push({ kind: "diet_break", days: 7, kgPerWeek: 0 });
  }
  return segs;
}

/** The sequence of blocks for the goal, before dates and numbers. */
export function planSegments(x: BlocksInput): { segs: Seg[]; endsShort: boolean } {
  const g = x.goal;
  const today = x.today;
  const cur = x.currentKg;
  const losingGoal = g?.kg != null ? g.kg < cur : g?.kind === "fat_loss" || g?.kind === "recomp" || g?.kind === "contest_prep" || g?.kind === "weight_class";
  const rates = ratesFor(g?.kind ?? "maintain", x.level, losingGoal);
  const comfKg = (rates.comfortable / 100) * cur;
  const segs: Seg[] = [];
  let endsShort = false;

  // a competition just done and nothing new set: recover, then transition
  if ((!g || g.source === "phase") && x.recentEvent) {
    const left = Math.max(0, daysBetween(today, addDays(x.recentEvent.date, x.recentEvent.physique ? POST_COMP_DAYS.physique : POST_COMP_DAYS.strength)) + 1);
    if (left > 0) segs.push({ kind: "post_comp", days: left, kgPerWeek: 0 });
    segs.push({ kind: "transition", days: TRANSITION_DAYS, kgPerWeek: 0 });
    return { segs, endsShort };
  }

  const baseline = (slackDays: number) => (x.needsBaseline && slackDays >= BASELINE_DAYS + 7 ? [{ kind: "baseline" as const, days: BASELINE_DAYS, kgPerWeek: 0 }] : []);

  if (!g || g.kg == null || g.kind === "maintain") {
    const horizon = g?.date ? Math.max(14, daysBetween(today, g.date) + 1) : OPEN_HORIZON_WEEKS * 7;
    // a phase with no target: plan the next stretch of it and review from there
    const kind: BlockKind | null = g?.kind === "fat_loss" ? "fat_loss" : g?.kind === "muscle_gain" ? "surplus" : g?.kind === "recomp" ? "recomp" : null;
    if (kind) {
      const rate = kind === "surplus" ? comfKg : kind === "recomp" ? -(0.25 / 100) * cur : -comfKg * 0.8;
      segs.push(...baseline(horizon));
      segs.push(...chunk(kind, horizon - (segs[0]?.days ?? 0), x.safety.noDeficit && rate < 0 ? 0 : rate));
      return { segs, endsShort };
    }
    segs.push(...chunk("maintenance", horizon, 0));
    return { segs, endsShort };
  }

  const changeKg = g.kg - cur;
  const losing = changeKg < 0;
  const planned = x.safety.noDeficit && losing ? 0 : x.plannedKgPerWeek;

  if (g.kind === "weight_class" || g.kind === "contest_prep") {
    const meet = g.date!;
    const D = daysBetween(today, meet);
    const physique = g.kind === "contest_prep";
    const tail: Seg[] = [];
    if (D >= 0) {
      const taperDays = Math.min(7, D + 1);
      const fueledDays = x.makeBy ? Math.max(0, daysBetween(x.makeBy, meet)) : 0;
      const perfDays = physique ? 0 : Math.max(0, fueledDays - 7);
      const workDays = Math.max(0, D + 1 - taperDays - perfDays);
      // the weight-changing stretch: start late enough that a small gap isn't dieted for months
      let changeSegs: Seg[] = [];
      const workKind: BlockKind = physique ? "contest_prep" : "pl_prep";
      const reached = losing ? changeKg >= 0 : changeKg <= 0;
      if (reached || planned === 0 || workDays === 0) {
        if (workDays) changeSegs = chunk(physique ? "maintenance" : "performance", workDays, 0);
        if (!reached && planned === 0 && workDays) endsShort = true;
      } else {
        // a gentle pace (never past what's safe for them), over at least a few weeks
        const gentle = Math.max(0.03, Math.min(comfKg * 0.8, x.maxKgPerWeek));
        const minPrep = physique ? 12 : 4;
        // a physique prep uses all the time there is unless that's slower than 0.4% a week (slower keeps more muscle)
        const fullRatePct = Math.abs(changeKg) / (workDays / 7) / cur * 100;
        const needDays = physique && fullRatePct >= 0.4 ? workDays : Math.min(workDays, Math.max(Math.ceil((Math.abs(changeKg) / gentle) * 7), minPrep * 7));
        const lead = workDays - needDays;
        const rate = changeKg / (needDays / 7);
        if (Math.abs(rate) > x.maxKgPerWeek + 1e-6) endsShort = true;
        const useRate = Math.sign(rate) * Math.min(Math.abs(rate), x.maxKgPerWeek);
        const leadSegs: Seg[] = lead > 0 ? [...baseline(lead), ...chunk(physique ? "maintenance" : "performance", lead - (x.needsBaseline && lead >= BASELINE_DAYS + 7 ? BASELINE_DAYS : 0), 0)] : [];
        let work: Seg[];
        if (physique && needDays >= 16 * 7) {
          // early prep faster, the last 8 weeks slower as they get leaner
          const lateDays = 56;
          const earlyDays = needDays - lateDays;
          const late = useRate * 0.7;
          const early = (changeKg - (late * lateDays) / 7) / (earlyDays / 7);
          const earlySegs = dietWithBreaks("contest_prep", earlyDays, (early * earlyDays) / 7, comfKg * 1.15) ?? chunk("contest_prep", earlyDays, early);
          work = [...earlySegs.map((s) => ({ ...s, note: s.kind === "contest_prep" ? "early" : undefined })), { kind: "contest_prep", days: lateDays, kgPerWeek: late, note: "late" }];
        } else {
          work = chunk(workKind, needDays, useRate);
        }
        changeSegs = [...leadSegs, ...work];
      }
      tail.push(...changeSegs);
      if (perfDays) tail.push({ kind: "performance", days: perfDays, kgPerWeek: 0, note: "peak" });
      tail.push({ kind: "taper", days: taperDays, kgPerWeek: 0 });
    }
    tail.push({ kind: "post_comp", days: physique ? POST_COMP_DAYS.physique : POST_COMP_DAYS.strength, kgPerWeek: 0 });
    tail.push({ kind: "transition", days: TRANSITION_DAYS, kgPerWeek: 0, note: x.nextEvent ? "next" : undefined });
    return { segs: tail, endsShort };
  }

  // fat loss, a gain, an event weight
  const kind: BlockKind = g.kind === "recomp" ? "recomp" : losing ? "fat_loss" : "surplus";
  const rate = x.safety.noDeficit && losing ? 0 : planned || (losing ? -comfKg * 0.85 : comfKg);
  if (rate === 0) {
    segs.push(...chunk("maintenance", OPEN_HORIZON_WEEKS * 7, 0));
    return { segs, endsShort: true };
  }
  let days: number;
  if (g.date) {
    days = Math.max(7, daysBetween(today, g.date) + 1);
    const needed = (Math.abs(changeKg) / Math.abs(rate)) * 7;
    if (needed > days + 3) endsShort = true;
  } else {
    days = Math.min(MAX_HORIZON_WEEKS * 7, Math.max(14, Math.ceil((Math.abs(changeKg) / Math.abs(rate)) * 7)));
    if ((Math.abs(changeKg) / Math.abs(rate)) * 7 > days) endsShort = true;
  }
  const base = baseline(days);
  const workDays = days - (base[0]?.days ?? 0);
  // with a baseline taking two weeks, the rest only works if it stays comfortable
  const workRate = g.date && !endsShort ? changeKg / (workDays / 7) : rate;
  const useBaseline = base.length > 0 && Math.abs(workRate) <= comfKg + 1e-6;
  const dietDays = useBaseline ? workDays : days;
  const dietRate = useBaseline ? workRate : g.date && !endsShort ? changeKg / (days / 7) : rate;
  if (useBaseline) segs.push(...base);
  if (kind === "surplus") {
    // months of surplus: stabilize for a month after 24 weeks
    if (dietDays > 28 * 7) {
      segs.push(...chunk("surplus", 24 * 7, dietRate), { kind: "maintenance", days: 28, kgPerWeek: 0, note: "stabilize" });
      segs.push(...chunk("surplus", dietDays - 24 * 7 - 28, (changeKg - (dietRate * 24)) / ((dietDays - 24 * 7 - 28) / 7)));
    } else segs.push(...chunk("surplus", dietDays, dietRate));
  } else {
    const withBreaks = kind === "fat_loss" ? dietWithBreaks("fat_loss", dietDays, (dietRate * dietDays) / 7, comfKg) : null;
    segs.push(...(withBreaks ?? chunk(kind, dietDays, dietRate)));
  }
  segs.push({ kind: kind === "surplus" ? "maintenance" : "transition", days: TRANSITION_DAYS, kgPerWeek: 0, note: "hold" });
  return { segs, endsShort };
}

/** The plan they're on is this kind of block. */
export function samePhase(kind: BlockKind, phase: string | null | undefined): boolean {
  const p = String(phase ?? "").toLowerCase();
  if (!p) return false;
  if (/loss|cut/.test(p)) return kind === "fat_loss" || kind === "pl_prep" || kind === "contest_prep";
  if (/recomp/.test(p)) return kind === "recomp";
  if (/gain|bulk/.test(p)) return kind === "surplus";
  if (/maint|perform/.test(p)) return kind === "maintenance" || kind === "performance";
  return false;
}

const isWeightBlock = (k: BlockKind) => k === "fat_loss" || k === "surplus" || k === "recomp" || k === "pl_prep" || k === "contest_prep";

/** The plan they're on now, as a block's numbers. */
export function planEnergy(p: CurrentPlan, trainingDays: number): { avg: Macros; training: Macros | null; rest: Macros | null } | null {
  const byKind = (re: RegExp) => p.days.find((d) => re.test(d.label) && (d.kcal ?? 0) > 0) ?? null;
  const rest = byKind(/non.?training|rest|off/i);
  const train = p.days.find((d) => /training/i.test(d.label) && !/non.?training/i.test(d.label) && (d.kcal ?? 0) > 0) ?? null;
  const any = p.days.find((d) => (d.kcal ?? 0) > 0) ?? null;
  if (!any) return null;
  const m = (d: (typeof p.days)[number] | null): Macros | null => (d ? { kcal: Math.round(d.kcal ?? 0), proteinG: Math.round(d.protein ?? 0), carbsG: Math.round(d.carbs ?? 0), fatG: Math.round(d.fat ?? 0) } : null);
  const t = m(train);
  const r = m(rest);
  const days = Math.min(7, Math.max(0, trainingDays));
  const mix = (a: number, b: number) => Math.round((a * days + b * (7 - days)) / 7);
  const avg: Macros =
    t && r
      ? { kcal: p.weeklyKcal ?? mix(t.kcal, r.kcal), proteinG: mix(t.proteinG, r.proteinG), carbsG: mix(t.carbsG, r.carbsG), fatG: mix(t.fatG, r.fatG) }
      : { ...(m(any) as Macros), kcal: p.weeklyKcal ?? Math.round(any.kcal ?? 0) };
  return { avg, training: t && r ? t : null, rest: t && r ? r : null };
}

function blockEnergy(seg: Seg, x: BlocksInput, startKg: number, endKg: number, current: boolean): { energy: BlockEnergy; kgPerWeek: number } {
  const midKg = (startKg + endKg) / 2;
  const maintenance = maintenanceAt(x.energy, x.currentKg, midKg);
  const rmr = restingEnergy({ sex: x.sex, age: x.age, heightCm: x.heightCm, kg: midKg });
  const floor = r25(Math.max(rmr ?? 0, maintenance * (1 - MAX_DEFICIT_SHARE)));
  const notes: string[] = [];
  let kgPerWeek = seg.kgPerWeek;
  let kcal: number;
  if (seg.kind === "post_comp" && seg.days > 14) {
    kcal = maintenance - 100;
    notes.push("Step calories up 100–150 a week until they're back at maintenance; a few kg of rebound (glycogen, water, food volume) is expected.");
  } else {
    kcal = maintenance + (isWeightBlock(seg.kind) ? kcalForRate(kgPerWeek) : 0);
  }
  if (kcal < floor) {
    notes.push(`Kept at ${floor} kcal, the lowest this plan goes for them (their estimated resting energy and no more than ${Math.round(MAX_DEFICIT_SHARE * 100)}% under maintenance).`);
    kcal = floor;
    kgPerWeek = round(rateForKcal(kcal - maintenance), 3);
  }
  const vsMaintenance = r25(kcal - maintenance);
  const lean = seg.kind === "contest_prep" && seg.note === "late";
  const est = macrosFor({ kcal, kg: midKg, heightCm: x.heightCm, vsMaintenance, lean, strengthSport: x.strengthSport });
  notes.push(...est.notes);
  const engine: Macros = { kcal: est.kcal, proteinG: est.proteinG, carbsG: est.carbsG, fatG: est.fatG };
  const fromPlan = current && x.plan ? planEnergy(x.plan, x.trainingDays) : null;
  if (fromPlan) {
    const diff = fromPlan.avg.kcal - kcal;
    if (Math.abs(diff) >= Math.max(150, kcal * 0.07)) notes.push(`The plan they're on averages ${fromPlan.avg.kcal} kcal a day; this block calls for about ${r25(kcal)}.`);
    return {
      energy: { ...fromPlan.avg, training: fromPlan.training, rest: fromPlan.rest, from: "plan", vsMaintenance: r25(fromPlan.avg.kcal - maintenance), maintenance, floorKcal: floor, engine, notes },
      kgPerWeek,
    };
  }
  const split = seg.kind === "taper" ? null : splitDays(engine, x.trainingDays, midKg, floor);
  return { energy: { ...engine, training: split?.training ?? null, rest: split?.rest ?? null, from: "estimate", vsMaintenance, maintenance, floorKcal: floor, engine, notes }, kgPerWeek };
}

const titleFor = (seg: Seg) => {
  const base = BLOCK_LABEL[seg.kind];
  if (seg.kind === "contest_prep" && seg.note) return `${base}: ${seg.note === "late" ? "final weeks" : "early"}${seg.parts ? ` (part ${seg.part})` : ""}`;
  if (seg.kind === "performance" && seg.note === "peak") return "Strength peak: fueled";
  if (seg.kind === "maintenance" && seg.note === "stabilize") return "Stabilize the gain";
  return seg.parts ? `${base} (part ${seg.part} of ${seg.parts})` : base;
};

function texts(seg: Seg, x: BlocksInput, w: { startKg: number; targetKg: number; kgPerWeek: number }, energy: BlockEnergy): Pick<Block, "objective" | "priorities" | "moveOnWhen" | "rules" | "why"> {
  const u = x.unit;
  const W = (kg: number) => fmtWeight(kg, u);
  const rate = fmtRate(w.kgPerWeek, u);
  const g = x.goal;
  const meetName = g?.eventName ?? "the meet";
  const fatsFirst = x.strengthSport ? "from fats first, keeping the carbs around training" : "from carbs and fats, keeping the carbs around training";
  const hours = g?.weighInHours;
  switch (seg.kind) {
    case "baseline":
      return {
        objective: "Find their real maintenance before anything is cut or added.",
        priorities: ["Weigh in 4+ mornings a week, after the bathroom, before eating", "Eat the targets as written, and log or rate how closely", "Train as normal"],
        moveOnWhen: ["8+ weigh-ins over 2 weeks", "Intake consistent (4/5 or better)"],
        rules: { keep: "Nothing changes during the baseline.", change: "Only for illness or a health concern.", extend: "Another week if there aren't enough weigh-ins.", end: "After 2 weeks of data: the next block's targets are set from it." },
        why: "With little data on file, an estimate can be 10–15% off. Two weeks of steady eating and weigh-ins turns it into their own number, so every later block is built on fact.",
      };
    case "fat_loss":
    case "pl_prep":
    case "contest_prep":
    case "recomp": {
      const isPrep = seg.kind === "pl_prep";
      const isShow = seg.kind === "contest_prep";
      return {
        objective:
          seg.kind === "recomp"
            ? `Lose fat slowly while strength and muscle build: bodyweight about ${rate}, waist and lifts are the real measures.`
            : `${W(w.startKg)} to ${W(w.targetKg)} at about ${rate}${isPrep ? `, so the ${g?.weightClass ?? ""} class is made before the peak`.replace("the  class", "the class") : ""}.`,
        priorities: [
          `Protein ${energy.proteinG} g a day, spread over the day`,
          isPrep ? "Keep squat, bench and deadlift top sets moving; strength is the point" : isShow ? "Keep training volume and intensity: it's what holds the muscle" : "Keep the lifts moving: strength holding means the loss is fat",
          "Weigh in 4+ mornings a week; the trend decides, never one weigh-in",
          ...(seg.kind === "recomp" ? ["Waist every 2 weeks; photos every 4"] : []),
        ],
        moveOnWhen: [`The trend reaches ${W(w.targetKg)} (the 7-day average, not one morning)`, "Training holding: no drop in top sets two reviews running"],
        rules: {
          keep: "Trend inside the checkpoint band with training holding: change nothing.",
          change: `Behind the band for 2 reviews in a row with consistent eating (4/5 or better): take 100–250 kcal a day ${fatsFirst}. Inconsistent eating is fixed first, never the numbers.`,
          extend: "Close at the block's end with the timeline allowing: extend up to 2 weeks rather than cut harder.",
          end: `Target reached, or strength dropping two reviews in a row with sleep and energy flagged: move to maintenance and reassess.`,
        },
        why: isPrep
          ? `The class has to be made in a normal, fed state, and the strength peak should be fueled, so the weight is lost here, at a pace that protects the total.${hours === 2 ? " With a 2-hour weigh-in there's no time to recover from a cut on the day." : ""}`
          : isShow
            ? seg.note === "late"
              ? "Leaner athletes lose muscle faster in a deficit, so the last weeks go slower, with protein up and training kept hard."
              : "Most of the fat comes off here, while there's still the most to lose and training is strongest."
            : seg.kind === "recomp"
              ? "A small deficit with high protein and hard training lets body composition change without a big drop in bodyweight."
              : "A controlled deficit loses fat while keeping muscle and training quality; slower keeps more of both.",
      };
    }
    case "surplus":
      return {
        objective: `${W(w.startKg)} to ${W(w.targetKg)} at about ${rate}: enough surplus to build muscle, not so much it's mostly fat.`,
        priorities: [`Protein ${energy.proteinG} g a day`, "Progressive overload: the surplus only builds what training asks for", "Carbs around training"],
        moveOnWhen: [`The trend reaches ${W(w.targetKg)}`, "Gaining no faster than planned"],
        rules: {
          keep: "Gaining inside the band and training improving: change nothing.",
          change: "Gaining faster than planned for 2 reviews: take 100–150 kcal. Not gaining for 3 weeks with consistent eating: add 100–150.",
          extend: "Training still improving at the block's end: extend rather than add more food.",
          end: "Target reached, or the waist climbing faster than the scale: stabilize for a few weeks.",
        },
        why: "Muscle is built slowly; a small surplus gives training what it needs while keeping fat gain low, and the rate is set by training age.",
      };
    case "diet_break":
      return {
        objective: "A week at maintenance in the middle of a long diet.",
        priorities: ["Eat at maintenance: more carbohydrate, same protein", "Train hard: it's a week to push sessions", "Expect the scale up 0.5–1.5 kg from glycogen and water: it's not fat"],
        moveOnWhen: ["One week done"],
        rules: { keep: "It's one week, whatever the scale does.", change: "Never.", extend: "Only if illness or recovery says so.", end: "After a week: back to the deficit." },
        why: "Breaks in a long diet help training quality, hunger and adherence and cost little or no fat loss over the diet.",
      };
    case "performance":
      return {
        objective: seg.note === "peak" ? `Fuel the strength peak at ${W(w.targetKg)}: maintenance, carbohydrate prioritised.` : "Fuel training at maintenance: no deficit, no surplus.",
        priorities: ["Carbohydrate high around every session", `Protein ${energy.proteinG} g a day`, "Hold bodyweight steady: the class is already made"],
        moveOnWhen: seg.note === "peak" ? ["Meet week"] : ["The weight-change block starts"],
        rules: { keep: "Weight steady and training strong: change nothing.", change: "Drifting up past the class weight: trim 100–150 kcal from fats, never carbs before a session.", extend: "With the meet.", end: "At meet week." },
        why: seg.note === "peak" ? "Heavy singles need glycogen and recovery. Dieting through a peak costs strength the meet can't get back." : "With time to spare before the cut, training is fueled first and the weight comes off later at a gentle pace.",
      };
    case "taper":
      return {
        objective: g?.kind === "contest_prep" ? "Show week: hold the targets and keep food familiar." : `Meet week at ${W(w.targetKg)}: fueled, familiar food, nothing new.`,
        priorities:
          g?.kind === "contest_prep"
            ? ["The same targets and foods as the last weeks", "No water, sodium or carb loading the app can't validate", "Sleep and routine"]
            : [hours === 2 ? "2-hour weigh-in: be at or under the weight on the morning, then eat and drink as practised" : hours === 24 ? "24-hour weigh-in: still plan to be at weight in a normal state" : "Check the federation's weigh-in rules and time", "Carbohydrate high, familiar foods, nothing new on meet day", "Pack meet-day food and fluids"],
        moveOnWhen: ["Competition day"],
        rules: { keep: "Hold the targets.", change: "Only with the coach.", extend: "No.", end: "After the competition." },
        why: `${WEIGH_IN_RULE}`,
      };
    case "post_comp":
      return {
        objective: g?.kind === "contest_prep" || x.recentEvent?.physique ? "Recover from the show: calories back to maintenance over a few weeks." : "Recover from the meet: eat normally, sleep, rebuild.",
        priorities: ["Calories at or back toward maintenance", "Protein steady", "A few kg up from food and water is expected: not a problem to fix"],
        moveOnWhen: ["Energy, sleep and appetite back to normal"],
        rules: { keep: "No new deficit.", change: "Only if bodyweight climbs fast past where it started the prep.", extend: "If recovery is slow.", end: "Into the next goal." },
        why: "After a peak or a show the body needs energy back: dieting through recovery invites rebound eating, illness and injury.",
      };
    case "transition":
      return {
        objective: x.nextEvent ? `Transition into the next goal: ${x.nextEvent.name ?? "the next competition"} on ${fmtDay(x.nextEvent.date, x.today)}.` : seg.note === "hold" ? `Hold the new bodyweight around ${W(w.targetKg)}.` : "Transition: set the next goal.",
        priorities: ["Maintenance calories", "Keep the habits that worked", "Set the next goal so the roadmap can plan it"],
        moveOnWhen: ["A new goal set"],
        rules: { keep: "Weight within 1% of the target.", change: "Drifting more than 1%: small adjustments only.", extend: "Until the next goal.", end: "When the next goal starts." },
        why: seg.note === "hold" ? "New bodyweight takes a few weeks of maintenance to feel normal; stopping a diet abruptly is when it rebounds." : "A planned transition keeps the gains from the last phase and starts the next on purpose.",
      };
    case "maintenance":
    default:
      return {
        objective: seg.note === "stabilize" ? "Stabilize after months of surplus: maintenance, keep training hard." : `Hold bodyweight around ${W(w.targetKg)}.`,
        priorities: [`Protein ${energy.proteinG} g a day`, "Consistency over precision", "Train for progress"],
        moveOnWhen: seg.note === "stabilize" ? ["4 weeks done"] : ["The next goal"],
        rules: { keep: "Weight within about 1% and training going well: change nothing.", change: "Drifting more than 1% for 3 weeks: 100–150 kcal.", extend: "As long as it's working.", end: "When a new goal is set." },
        why: seg.note === "stabilize" ? "A few weeks at maintenance lets the new tissue settle and resets appetite before the next push." : "Maintenance is a phase with a purpose: training quality, habits and health.",
      };
  }
}

/** Checkpoints every 2 weeks in a block that moves bodyweight, and at its end. */
function checkpointsFor(start: string, end: string, startKg: number, kgPerWeek: number, x: BlocksInput, weeksFromToday: number): Checkpoint[] {
  const out: Checkpoint[] = [];
  const days = daysBetween(start, end) + 1;
  const band = (atWeeks: number, kg: number) => round(Math.max(kg * 0.006, (x.noiseKg ?? 0.4) * 1.5) + 0.05 * (weeksFromToday + atWeeks), 2);
  for (let d = 14; d < days; d += 14) {
    const date = addDays(start, d - 1);
    const kg = round(startKg + (kgPerWeek * d) / 7, 2);
    const b = band(d / 7, kg);
    out.push({ date, kg, lowKg: round(kg - b, 2), highKg: round(kg + b, 2), label: `Week ${Math.round(d / 7)}` });
  }
  const kg = round(startKg + (kgPerWeek * days) / 7, 2);
  const b = band(days / 7, kg);
  out.push({ date: end, kg, lowKg: round(kg - b, 2), highKg: round(kg + b, 2), label: "Block end" });
  return out;
}

/** The blocks with their dates, weights, energy and words. */
export function planBlocks(x: BlocksInput): { blocks: Block[]; endsShort: boolean } {
  const { segs, endsShort } = planSegments(x);
  const blocks: Block[] = [];
  let start = x.today;
  let kg = x.currentKg;
  // a phase that started earlier keeps its start date (only when the plan is that phase)
  if (x.plan?.start && x.plan.start < x.today && segs[0] && samePhase(segs[0].kind, x.plan.phase)) {
    const back = Math.min(daysBetween(x.plan.start, x.today), 6 * 7);
    if (back > 0) {
      start = addDays(x.today, -back);
      segs[0] = { ...segs[0], days: segs[0].days + back };
    }
  }
  segs.forEach((seg, i) => {
    if (seg.days <= 0) return;
    const end = addDays(start, seg.days - 1);
    const current = start <= x.today && end >= x.today;
    // the stretch before today is already behind them: weight moves only from today
    const remaining = daysBetween(start < x.today ? x.today : start, end) + 1;
    const startKg = kg;
    let endKg = isWeightBlock(seg.kind) ? kg + (seg.kgPerWeek * remaining) / 7 : kg;
    const { energy, kgPerWeek } = blockEnergy(seg, x, startKg, endKg, current);
    if (kgPerWeek !== seg.kgPerWeek && isWeightBlock(seg.kind)) endKg = kg + (kgPerWeek * remaining) / 7;
    const weeksFromToday = Math.max(0, daysBetween(x.today, start) / 7);
    const w = { startKg, targetKg: round(endKg, 2), kgPerWeek: isWeightBlock(seg.kind) ? kgPerWeek : 0 };
    const t = texts(seg, x, w, energy);
    const band = Math.max(endKg * 0.006, (x.noiseKg ?? 0.4) * 1.5) + 0.05 * (weeksFromToday + seg.days / 7);
    blocks.push({
      id: `${i}-${seg.kind}`,
      kind: seg.kind,
      title: titleFor(seg),
      start,
      end,
      weeks: round(seg.days / 7, 1),
      status: end < x.today ? "done" : current ? "current" : "upcoming",
      final: current,
      locked: false,
      ...t,
      weight: { startKg: round(startKg, 2), targetKg: round(endKg, 2), lowKg: round(endKg - band, 2), highKg: round(endKg + band, 2) },
      rate: { kgPerWeek: w.kgPerWeek, pctPerWeek: pct(w.kgPerWeek, startKg) },
      energy,
      checkpoints: isWeightBlock(seg.kind) ? checkpointsFor(start < x.today ? x.today : start, end, startKg, w.kgPerWeek, x, weeksFromToday) : [],
    });
    kg = endKg;
    start = addDays(end, 1);
  });
  return { blocks, endsShort };
}

/** The expected bodyweight each week, start to end, with the band that still counts as on plan. */
export function pathOf(blocks: Block[], today: string, noiseKg: number | null): Array<{ date: string; kg: number; lowKg: number; highKg: number }> {
  const out: Array<{ date: string; kg: number; lowKg: number; highKg: number }> = [];
  for (const b of blocks) {
    if (!b.weight) continue;
    const from = b.start < today && b.end >= today ? today : b.start;
    const days = daysBetween(from, b.end) + 1;
    for (let d = 0; d < days; d += 7) {
      const date = addDays(from, d);
      const kg = expectedAt(blocks, date, today);
      if (kg == null) continue;
      const band = Math.max(kg * 0.006, (noiseKg ?? 0.4) * 1.5) + 0.05 * Math.max(0, daysBetween(today, date) / 7);
      out.push({ date, kg: round(kg, 2), lowKg: round(kg - band, 2), highKg: round(kg + band, 2) });
    }
  }
  const last = blocks[blocks.length - 1];
  if (last?.weight && (!out.length || out[out.length - 1].date !== last.end)) {
    const kg = last.weight.targetKg;
    out.push({ date: last.end, kg, lowKg: last.weight.lowKg, highKg: last.weight.highKg });
  }
  return out;
}

/** The planned bodyweight on a date, from the blocks (linear within each). */
export function expectedAt(blocks: Block[], date: string, madeOn: string): number | null {
  for (const b of blocks) {
    if (!b.weight || date < b.start || date > b.end) continue;
    const from = b.start < madeOn && b.end >= madeOn ? madeOn : b.start;
    if (date <= from) return b.weight.startKg;
    const total = daysBetween(from, b.end) + 1;
    const frac = Math.min(1, (daysBetween(from, date) + 1) / total);
    return b.weight.startKg + (b.weight.targetKg - b.weight.startKg) * frac;
  }
  const first = blocks.find((b) => b.weight);
  const last = [...blocks].reverse().find((b) => b.weight);
  if (first && date < first.start) return first.weight!.startKg;
  if (last && date > last.end) return last.weight!.targetKg;
  return null;
}
