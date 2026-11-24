/**
 * Workout plan quality (Nov 24 2026): how well a client's current and upcoming
 * program is designed for them, by category, worked out by code from the
 * program and what's on file. Deterministic, pure and tested
 * (plan-quality-intel.test.ts); see plan-quality.ts for what the score is and
 * isn't. It reuses Program Check's own reads (programCheck: the exercise
 * standard, equipment, pain, sessions over their limit, block type fit,
 * station flow, progression) and Program Intelligence's starting doses by
 * level (first-program.ts), so the builder, Generate Next Program and this
 * score never disagree about what good looks like.
 *
 *   Goal alignment        what the program trains against what they're
 *                         training for (style), never a template
 *   Exercise selection    the exercise standard, their equipment, pain on
 *                         file, library exercises, a cue where there's no demo
 *   Volume, intensity & frequency   weekly sets by muscle against their level
 *                         (a beginner needs less), how often, effort targets
 *   Fatigue & recovery    sets per session, lighter weeks in a long program,
 *                         loads that run harder than written, and the rest of
 *                         their life: check-in recovery flags, a deficit, cardio
 *   Progression           main lifts that change week to week, block types
 *   Order & flow          main work first, accessories grouped by station
 *   Individualization     their training days, maxes for percentages, level
 *   Session duration      against their session limit (a booked PT hour wins)
 *   Competition timeline  only with a meet: the program reaches it with a
 *                         taper or peak
 *
 * A heavy squat day next to a heavy deadlift day is never marked down (a
 * coach's call). Workouts already trained count for the read of progression,
 * never as something to fix. Adherence and results sit beside the score.
 */
import { classifyExercise, type MovementPattern, type MuscleKey } from "@/lib/exercise-classifier";
import { estimateDayMinutes } from "@/lib/pl-programs";
import { mainLiftProgression, programCheck, type CheckFinding, type CheckInput, type ProgramStyle } from "@/lib/program-check";
import { MUSCLE_DOSE, LIFT_DOSE, type ExperienceLevel } from "@/lib/program-intel/first-program";
import { blockTypeFamily, resolveBlockType } from "@/lib/block-types";
import { adherencePct, clampScore, finishQuality, FOLLOW_LOW, recoveryTrend, settlingOf, type CategoryConcern, type QualityCategory, type QualityChange, type QualityConnection, type QualityExecution, type QualityScore } from "@/lib/plan-quality";

export type ProgramQualityContext = {
  today: string;
  level: ExperienceLevel | null;
  style: ProgramStyle;
  /** Their committed training days (Mon…Sun names). */
  trainingDays: string[];
  /** Next meet or show, with how far out (weeks). */
  meet: { name: string | null; date: string; weeksOut: number } | null;
  /** The live blocks' dates and order (current first), for the timeline. */
  blocks: Array<{ name: string; start: string | null; end: string | null; current: boolean }>;
  /** Bodyweight goal direction and the nutrition plan against maintenance (% , negative = deficit). */
  direction: "lose" | "gain" | "maintain" | null;
  deficitPct: number | null;
  /** Sleep / energy flagged on recent check-ins (0–2). */
  recoveryFlags: number;
  /** Lower-body strength lately (comparable sets). */
  lowerPerformance: "up" | "steady" | "down" | null;
  /** Their cardio in force, a week. */
  cardio: { minutes: number; hardMinutes: number; highImpact: number; dayBeforeHeavyLower: number; beforeLifting: number } | null;
  /** Planned workouts on days that have passed (last 4 weeks) and how many were done; optional ones never count. */
  adherence: { done: number; planned: number } | null;
  /**
   * Logged sets on rows whose weight the coach set (% of a max or a fixed load) with an RPE
   * target: how many were rated, and how many ran 1.5+ RPE over the target.
   */
  effort: { rated: number; harder: number } | null;
  checkins: number;
  /** When the program last changed (the current block's start, or an applied Adjust program change). */
  changedOn?: string | null;
  /** The change log's read (plan-changes.ts changeRead): wins over changedOn when there is one. */
  changeLog?: { changes: QualityChange[]; settling: QualityScore["settling"] } | null;
  /**
   * Logged sets at the coach's loads that ran 2+ RPE under target (the loads are lighter than
   * written: room to progress faster), counted with `effort`.
   */
  easier?: number;
  /** What their check-ins say gets in the way (barriersFromCheckins). */
  barriers?: string[];
  firstName?: string | null;
};

/** The phase the athlete is in, from the live block's type and the live week's phase words. */
export type TrainingPhase = "accumulation" | "intensification" | "peak" | "taper" | "deload" | "other";
export function phaseOf(input: CheckInput, live: { bi: number; wi: number } | null): TrainingPhase {
  if (!live) return "other";
  const b = input.blocks[live.bi];
  const wk = String(b?.weeks[live.wi]?.phase ?? "");
  if (/deload|unload|recovery week|light week/i.test(wk)) return "deload";
  if (/taper/i.test(wk)) return "taper";
  if (/peak|meet week|opener/i.test(wk)) return "peak";
  if (/overreach|accumul|volume/i.test(wk)) return "accumulation";
  const fam = blockTypeFamily(resolveBlockType({ block_type: b.blockType, block_meta: b.blockMeta, phase: b.phase, training_focus: b.trainingFocus, name: b.name }, input.blockTypes).type);
  if (fam === "deload") return "deload";
  if (fam === "taper") return "taper";
  if (fam === "peaking") return "peak";
  if (fam === "accumulation" || fam === "hypertrophy") return "accumulation";
  if (fam === "intensification" || fam === "strength") return "intensification";
  return "other";
}

const rows = (d: any) => ((d?.rows ?? []) as any[]).filter(Boolean);
const isTimed = (r: any) => r?.measurement_type === "time";
const carriesOn = (r: any) => r?.percentage_basis === "top_set" || r?.percentage_basis === "prev_set";
const exNameOf = (r: any, input: CheckInput) => (r?.exercise_id ? input.exercises.get(r.exercise_id)?.name : null) ?? (r?.exercise_name_override as string | null) ?? "Exercise";

/** The groups the starting doses are written for. */
const GROUP_OF: Partial<Record<MuscleKey, { group: string; kind: "major" | "pull" | "minor" }>> = {
  chest: { group: "Chest", kind: "major" },
  quads: { group: "Quads", kind: "major" },
  hamstrings: { group: "Hamstrings", kind: "major" },
  glutes: { group: "Glutes", kind: "major" },
  lats: { group: "Back", kind: "pull" },
  upper_back: { group: "Back", kind: "pull" },
  front_delts: { group: "Shoulders", kind: "minor" },
  side_delts: { group: "Shoulders", kind: "minor" },
  rear_delts: { group: "Shoulders", kind: "minor" },
  biceps: { group: "Biceps", kind: "minor" },
  triceps: { group: "Triceps", kind: "minor" },
  calves: { group: "Calves", kind: "minor" },
};
const MUSCLE_SHARE: Partial<Record<NonNullable<ProgramStyle>, number>> = { bodybuilding: 1, powerbuilding: 0.85, strength: 0.75, general: 0.75 };
const LIFT_SHARE: Partial<Record<NonNullable<ProgramStyle>, number>> = { powerlifting: 1, powerbuilding: 0.8, strength: 0.8 };
const ISOLATION: MovementPattern[] = ["lateral_raise", "front_raise", "elbow_flexion", "elbow_extension", "chest_fly", "knee_extension", "knee_flexion", "calf_raise", "rear_delt", "wrist", "hip_abduction", "hip_adduction"];

export type Lift = "squat" | "bench" | "deadlift";
/** The squat, bench or deadlift family of a row (the competition lift or a barbell variation of it). */
export function liftFamily(r: any, input: CheckInput): Lift | null {
  const m = r?.exercise_id ? input.exercises.get(r.exercise_id) : undefined;
  const t = String(m?.competition_lift_type ?? r?.movement_family ?? "").toLowerCase();
  if (t === "squat" || t === "bench" || t === "deadlift") return t;
  const n = exNameOf(r, input).toLowerCase();
  if (/dumbbell|\bdb\b|machine|cable|smith|leg press|goblet|split|bulgarian|hack|belt|lunge/.test(n)) return null;
  if (/\bsquat\b/.test(n)) return "squat";
  if (/\bbench\b/.test(n) && !/\bstep|dip/.test(n)) return "bench";
  if (/deadlift/.test(n)) return "deadlift";
  return null;
}

/** The lowest rep count a row asks for ("3", "8-12", "AMRAP" → null). */
function repsOf(r: any): number | null {
  const m = /(\d+)/.exec(String(r?.reps_text ?? ""));
  return m ? Number(m[1]) : null;
}
const rpeOf = (r: any): number | null => {
  const m = /(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?/.exec(String(r?.rpe ?? ""));
  return m ? Number(m[2] ?? m[1]) : null;
};

export type WeekStats = {
  label: string;
  days: number;
  sets: number;
  /** Direct sets a week (primary muscles) and how many days each group is trained. */
  groups: Map<string, { sets: number; days: Set<number>; kind: "major" | "pull" | "minor" }>;
  lifts: Record<Lift, { sets: number; days: Set<number>; comp: number }>;
  /** Working sets with a rep count, and how many of them are 1–5 / 6–20 reps. */
  repSets: number;
  lowRepSets: number;
  hyperRepSets: number;
  compoundSets: number;
};

/** One week's shape: sets, muscles, lifts, reps. */
export function weekStats(input: CheckInput, bi: number, wi: number): WeekStats | null {
  const b = input.blocks[bi];
  const w = b?.weeks[wi];
  if (!w) return null;
  const groups: WeekStats["groups"] = new Map();
  const lifts: WeekStats["lifts"] = { squat: { sets: 0, days: new Set(), comp: 0 }, bench: { sets: 0, days: new Set(), comp: 0 }, deadlift: { sets: 0, days: new Set(), comp: 0 } };
  let sets = 0;
  let repSets = 0;
  let low = 0;
  let hyper = 0;
  let compound = 0;
  const days = w.days ?? [];
  days.forEach((d, di) => {
    for (const r of rows(d)) {
      if (isTimed(r)) continue;
      const n = Number(r?.sets) || 0;
      if (!n) continue;
      const meta = r?.exercise_id ? input.exercises.get(r.exercise_id) : undefined;
      const c = classifyExercise(exNameOf(r, input), meta?.exercise_category ?? null);
      if (c.pattern === "mobility" || c.pattern === "conditioning") continue;
      sets += n;
      const reps = repsOf(r);
      if (reps != null) {
        repSets += n;
        if (reps <= 5) low += n;
        if (reps >= 6 && reps <= 20) hyper += n;
      }
      if (!ISOLATION.includes(c.pattern)) compound += n;
      for (const m of new Set(c.primary)) {
        const g = GROUP_OF[m];
        if (!g) continue;
        const cur = groups.get(g.group) ?? { sets: 0, days: new Set<number>(), kind: g.kind };
        cur.sets += n;
        cur.days.add(di);
        groups.set(g.group, cur);
      }
      const lf = liftFamily(r, input);
      if (lf) {
        lifts[lf].sets += n;
        lifts[lf].days.add(di);
        if (meta?.is_competition_lift || /\bcompetition\b/i.test(exNameOf(r, input))) lifts[lf].comp += n;
      }
    }
  });
  // a muscle trained by several exercises in a day counts once per day, but each set once
  for (const v of groups.values()) v.sets = Math.round(v.sets);
  return { label: `${input.blocks.length > 1 ? `${b.name} · ` : ""}Week ${w.week_index ?? wi + 1}`, days: days.filter((d) => rows(d).length).length, sets, groups, lifts, repSets, lowRepSets: low, hyperRepSets: hyper, compoundSets: compound };
}

/** The week the athlete is in (or the next one to train): the first week of the current block with a workout not yet trained. */
export function liveWeekOf(input: CheckInput): { bi: number; wi: number } | null {
  for (let bi = 0; bi < input.blocks.length; bi++) {
    const b = input.blocks[bi];
    for (let wi = 0; wi < b.weeks.length; wi++) {
      const ds = b.weeks[wi].days ?? [];
      if (ds.some((_, di) => rows(ds[di]).length && !input.locked?.({ block: bi, week: wi, day: di }))) return { bi, wi };
    }
  }
  return null;
}

const byId = (fs: CheckFinding[], prefix: string) => fs.filter((f) => f.id === prefix || f.id.startsWith(`${prefix}:`));

function executionOf(ctx: ProgramQualityContext, phase: TrainingPhase, harder: boolean): QualityExecution {
  const a = ctx.adherence;
  const pct = a ? adherencePct(a.done, a.planned) : null;
  // a high-volume block costs some strength on the way (planned, accumulated fatigue): expected while
  // recovery holds up and the loads feel as written, not a sign the program isn't working
  // and heavier, lower-rep sets (an intensification, peak or taper) often estimate a lower max than
  // sets of five did: the estimate dips while the strength that counts holds
  const calm = ctx.lowerPerformance === "down" && ctx.recoveryFlags === 0 && !harder;
  const expected = !calm
    ? null
    : phase === "deload"
      ? "Lower-body strength dipped going into a lighter week, as planned"
      : phase === "accumulation"
        ? "Lower-body strength is a little down in a high-volume block: accumulated fatigue, planned, and it should come back as the volume drops"
        : phase === "intensification" || phase === "peak" || phase === "taper"
          ? `Lower-body strength reads a little down, but heavier, lower-rep sets in ${phase === "intensification" ? "an intensification block" : `a ${phase}`} often estimate lower than sets of five did, with no recovery flags or loads running heavy. Judge the heavy singles${ctx.meet && ctx.meet.weeksOut <= 4 ? " and the meet" : ""}, not the estimate`
          : null;
  return {
    adherence: pct != null && a ? { pct, label: `${Math.min(a.done, a.planned)} of ${a.planned} planned workouts done in 4 weeks` } : null,
    outcome:
      ctx.lowerPerformance === "up"
        ? { status: "on_track", label: "Lower-body strength is trending up" }
        : ctx.lowerPerformance === "down"
          ? { status: "behind", label: "Lower-body strength is down lately" }
          : null,
    barriers: ctx.barriers ?? [],
    expected,
  };
}

export function scoreProgram(input: CheckInput, ctx: ProgramQualityContext): QualityScore {
  const live = liveWeekOf(input);
  const phase = phaseOf(input, live);
  const harder = !!ctx.effort && ctx.effort.rated >= 6 && ctx.effort.harder / ctx.effort.rated >= 0.4;
  const execution = executionOf(ctx, phase, harder);
  const adh = execution.adherence?.pct ?? null;
  const week = live ? weekStats(input, live.bi, live.wi) : null;
  const points = [ctx.style != null, ctx.level != null, ctx.trainingDays.length > 0, !!input.athlete?.sessionLimit?.minutes, !!input.athlete?.equipment && input.athlete.equipment.confidence !== "unknown", adh != null].filter(Boolean).length;
  const missing: string[] = [];
  if (!ctx.style) missing.push("What they're training for (Goals & Setup)");
  if (!ctx.level) missing.push("Their training experience");
  if (!ctx.trainingDays.length) missing.push("Their training days");
  if (!input.athlete?.sessionLimit?.minutes) missing.push("How long their sessions can be");
  if (!input.athlete?.equipment || input.athlete.equipment.confidence === "unknown") missing.push("Their equipment");
  if (adh == null) missing.push("A few weeks of logged workouts");

  if (!week) {
    return finishQuality([], {
      what: "training program",
      points,
      missing,
      execution,
      domain: "training",
      firstName: ctx.firstName,
      changes: ctx.changeLog?.changes,
      none: { headline: input.blocks.length ? "Nothing left to train on the current program. Plan their next block." : "No program on their calendar yet.", action: input.blocks.length ? "act" : "review" },
    });
  }

  const findings = programCheck(input, "deep");
  const level: ExperienceLevel = ctx.level ?? "intermediate";
  const cats: QualityCategory[] = [];
  const style = ctx.style;
  const compLift = (l: Lift) => week.lifts[l];
  const connections: QualityConnection[] = [];

  const meetIn = ctx.meet && ctx.meet.weeksOut >= 0 ? Math.round(ctx.meet.weeksOut) : null;
  const recovery = recoveryTrend({ lowerPerformance: ctx.lowerPerformance, recoveryFlags: ctx.recoveryFlags, harderThanWritten: harder });
  // the change log decides when there is one (a minor edit never restarts the read); else the last change
  const settling = ctx.changeLog ? ctx.changeLog.settling : settlingOf("training", ctx.changedOn ?? null, ctx.today);
  const lightWeek = phase === "deload" || phase === "taper" || phase === "peak";

  // ── Goal alignment ──
  const goalConcerns: CategoryConcern[] = [];
  {
    const notes: string[] = [];
    let s: number | null = 100;
    if (!style) {
      s = null;
      notes.push("No goal on file to judge the program against");
    } else if (style === "running" || style === "rehab") {
      s = null;
      notes.push(`A ${style} program: judged on its sessions, not a lifting goal`);
    } else {
      const lowShare = week.repSets ? week.lowRepSets / week.repSets : 0;
      const hyperShare = week.repSets ? week.hyperRepSets / week.repSets : 0;
      if (style === "powerlifting" || style === "powerbuilding") {
        const meetSoon = ctx.meet != null && ctx.meet.weeksOut <= 16;
        for (const l of ["squat", "bench", "deadlift"] as Lift[]) {
          const x = compLift(l);
          if (!x.sets) {
            s -= meetSoon ? 25 : 12;
            notes.push(`No ${l} in the current week${meetSoon ? " with a meet coming" : ""}`);
            if (meetSoon) goalConcerns.push({ text: `No ${l} in the current week with a meet ${Math.round(ctx.meet!.weeksOut)} weeks out`, severity: "significant", reason: "timeline" });
          } else if (!x.comp && meetSoon && ctx.meet!.weeksOut <= 10) {
            s -= 10;
            notes.push(`Only ${l} variations ${Math.round(ctx.meet!.weeksOut)} weeks from the meet`);
          }
        }
      }
      if (style === "bodybuilding" && week.repSets >= 10 && hyperShare < 0.5) {
        s -= lowShare > 0.5 ? 25 : 12;
        notes.push(`${Math.round(lowShare * 100)}% of sets are 1–5 reps for a muscle-building goal`);
      }
      if ((style === "strength" || style === "general") && week.sets && week.compoundSets / week.sets < 0.35) {
        s -= 12;
        notes.push("Mostly isolation work for a strength goal");
      }
      if (style === "powerbuilding" && week.repSets >= 10 && hyperShare < 0.3) {
        s -= 10;
        notes.push("Little 6–20 rep work for the muscle side of powerbuilding");
      }
      const typeFit = byId(findings, "decision:type-fit");
      if (typeFit.length) {
        s -= 8 * typeFit.length;
        notes.push(typeFit[0].title);
      }
      if (!notes.length) notes.push(`Fits a ${style === "general" ? "general fitness" : style} goal`);
    }
    cats.push({ key: "goal", label: "Goal alignment", score: s == null ? null : clampScore(s), weight: 0.14, notes, critical: meetIn != null && meetIn <= 16 ? `a meet in ${meetIn} weeks` : null, concerns: goalConcerns });
  }

  // ── Exercise selection and suitability ──
  {
    const notes: string[] = [];
    let s = 100;
    const concerns: CategoryConcern[] = [];
    const pain = byId(findings, "warning:pain");
    for (const f of pain) {
      s -= 15;
      const place = f.title.split(":")[0];
      notes.push(`${place}: pain on file, and the program loads it`);
      const worst = Number(/worst (\d+)\/10/.exec(f.title)?.[1] ?? 0);
      concerns.push({ text: `${place}: pain ${/getting worse/.test(f.title) ? "getting worse" : "on file"}, and the program still loads it`, severity: /getting worse/.test(f.title) || worst >= 7 ? "urgent" : "significant", reason: "safety" });
    }
    const equip = findings.find((f) => f.id === "warning:equipment");
    if (equip) {
      s -= equip.level === "warning" ? 15 : 8;
      notes.push(equip.title);
    }
    const weak = findings.find((f) => f.id === "decision:selection");
    if (weak) {
      const n = Number(/^(\d+)/.exec(weak.title)?.[1] ?? 1);
      s -= Math.min(20, n * 5);
      notes.push(weak.title);
    }
    const dup = findings.find((f) => f.id === "decision:duplicates");
    if (dup) {
      s -= 5;
      notes.push(dup.title);
    }
    let custom = 0;
    for (const b of input.blocks) for (const w of b.weeks) for (const d of w.days ?? []) for (const r of rows(d)) if (!r?.exercise_id && !isTimed(r)) custom++;
    if (custom) {
      s -= Math.min(10, custom);
      notes.push(`${custom} exercise${custom === 1 ? " isn't" : "s aren't"} from the library (no demo, no history)`);
    }
    const cues = findings.find((f) => f.id === "decision:cues");
    if (cues) {
      const n = Number(/^(\d+)/.exec(cues.title)?.[1] ?? 1);
      s -= Math.min(8, n * 2);
      notes.push(cues.title);
    }
    if (!notes.length) notes.push("Stable, loadable exercises that suit their equipment and what's on file");
    cats.push({ key: "selection", label: "Exercise selection", score: clampScore(s), weight: 0.12, notes, critical: pain.length ? "pain on file" : null, concerns });
  }

  // ── Volume, intensity and frequency (against their level) ──
  {
    const notes: string[] = [];
    let s = 100;
    const share = style ? MUSCLE_SHARE[style] : 0.75;
    if (share) {
      const dose = MUSCLE_DOSE[level];
      const low: string[] = [];
      const high: string[] = [];
      const rare: string[] = [];
      for (const [group, kind] of [["Chest", "major"], ["Quads", "major"], ["Hamstrings", "major"], ["Glutes", "major"], ["Back", "pull"]] as const) {
        const target = Math.max(3, Math.round(dose[kind] * share));
        const g = week.groups.get(group);
        const sets = g?.sets ?? 0;
        if (sets < target * 0.5) low.push(`${group} ${sets}`);
        else if (sets > Math.max(24, target * 2)) high.push(`${group} ${sets}`);
        if (g && week.days >= 3 && g.days.size < 2 && style !== "powerlifting") rare.push(group);
      }
      if (low.length && !lightWeek) {
        s -= Math.min(30, low.length * 8);
        notes.push(`Low weekly sets for ${level === "beginner" ? "a beginner" : `an ${level} lifter`}: ${low.join(", ")}`);
      }
      if (high.length) {
        s -= Math.min(30, high.length * 10);
        notes.push(`More weekly sets than most recover from: ${high.join(", ")}`);
      }
      if (rare.length && level !== "beginner") {
        s -= Math.min(15, rare.length * 5);
        notes.push(`Trained once a week: ${rare.join(", ")} (twice usually grows more)`);
      }
    }
    const lshare = style ? LIFT_SHARE[style] : undefined;
    if (lshare) {
      const dose = LIFT_DOSE[level];
      for (const l of ["squat", "bench", "deadlift"] as Lift[]) {
        const x = compLift(l);
        const want = Math.max(2, Math.round(dose[(l.charAt(0).toUpperCase() + l.slice(1)) as "Squat" | "Bench" | "Deadlift"] * lshare));
        if (x.sets && x.sets < want * 0.5 && !lightWeek) {
          s -= 6;
          notes.push(`${l.charAt(0).toUpperCase() + l.slice(1)} ${x.sets} sets a week (about ${want} for their level)`);
        }
        if (l !== "deadlift" && x.sets && x.days.size < 2 && week.days >= 3 && style === "powerlifting") {
          s -= 6;
          notes.push(`${l.charAt(0).toUpperCase() + l.slice(1)} once a week (twice builds the skill faster)`);
        }
      }
    }
    const effortless = findings.find((f) => f.id === "decision:intensity");
    if (effortless) {
      const n = Number(/^(\d+)/.exec(effortless.title)?.[1] ?? 1);
      s -= Math.min(20, n * 2);
      notes.push(effortless.title);
    }
    if (!notes.length)
      notes.push(lightWeek ? `A lighter ${phase === "deload" ? "deload" : phase} week by design (${week.sets} working sets)` : `${week.sets} working sets a week, spread to suit ${level === "beginner" ? "a beginner" : `an ${level} lifter`}`);
    cats.push({ key: "dose", label: "Volume, intensity and frequency", score: clampScore(s), weight: 0.14, notes });
  }

  // ── Fatigue management and recovery (including the rest of their week) ──
  {
    const notes: string[] = [];
    let s = 100;
    const perSession = byId(findings, "decision:session-volume");
    if (perSession.length) {
      s -= Math.min(20, perSession.length * 8);
      notes.push(perSession[0].title);
    }
    const weekly = byId(findings, "decision:volume");
    const highVolume = weekly.length > 0 || [...week.groups.values()].some((g) => g.sets > 20);
    // a long program with no lighter week (an intermediate or advanced lifter's)
    if (level !== "beginner") {
      const weeksLeft: number[] = [];
      let hasDeloadBlock = false;
      input.blocks.forEach((b, bi) => {
        const fam = blockTypeFamily(resolveBlockType({ block_type: b.blockType, block_meta: b.blockMeta, phase: b.phase, training_focus: b.trainingFocus, name: b.name }, input.blockTypes).type);
        if (fam === "deload" || fam === "taper") hasDeloadBlock = true;
        b.weeks.forEach((w, wi) => {
          if (live && (bi < live.bi || (bi === live.bi && wi < live.wi))) return;
          if (/deload|taper|light|recovery|unload/i.test(String(w.phase ?? ""))) hasDeloadBlock = true;
          weeksLeft.push((w.days ?? []).reduce((n, d) => n + rows(d).filter((r) => !isTimed(r)).reduce((m, r) => m + (Number(r?.sets) || 0), 0), 0));
        });
      });
      const filled = weeksLeft.filter((n) => n > 0);
      if (filled.length >= 7 && !hasDeloadBlock) {
        const sorted = filled.slice().sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        if (!filled.some((n) => n <= median * 0.75)) {
          s -= 10;
          notes.push(`${filled.length} weeks ahead with no lighter week`);
        }
      }
    }
    const concerns: CategoryConcern[] = [];
    if (harder && ctx.effort) {
      s -= 15;
      notes.push(`${ctx.effort.harder} of ${ctx.effort.rated} sets at the loads you set ran 1.5+ RPE over target lately: the loads are heavier than written`);
      concerns.push({ text: `The loads you set are running heavier than written (${ctx.effort.harder} of ${ctx.effort.rated} sets 1.5+ RPE over target lately)`, severity: "significant", reason: "recovery" });
    }
    if (ctx.recoveryFlags >= 2 && highVolume) {
      s -= 10;
      notes.push("Sleep or energy flagged on recent check-ins during a high-volume week");
    }
    if (ctx.deficitPct != null && ctx.deficitPct < -20 && highVolume) {
      s -= 10;
      notes.push(`A ${Math.abs(Math.round(ctx.deficitPct))}% calorie deficit with a high-volume week`);
      connections.push({ domain: "nutrition", text: `A ${Math.abs(Math.round(ctx.deficitPct))}% deficit while the training volume is high` });
    } else if (ctx.direction === "lose" && ctx.deficitPct != null && ctx.deficitPct < -10) {
      connections.push({ domain: "nutrition", text: "They're in a deficit: holding volume keeps strength better than adding it" });
    }
    if (ctx.cardio) {
      if (ctx.cardio.dayBeforeHeavyLower > 0) {
        s -= 5;
        notes.push("Harder cardio the day before heavy squat or deadlift days");
        connections.push({ domain: "cardio", text: "Harder cardio lands the day before heavy lower-body days" });
      }
      if (ctx.cardio.beforeLifting > 0) connections.push({ domain: "cardio", text: "Cardio is set before lifting on training days" });
      if (ctx.lowerPerformance === "down" && (ctx.cardio.hardMinutes > 0 || ctx.cardio.highImpact > 0))
        connections.push({ domain: "cardio", text: "Lower-body strength is down while some cardio is hard or high-impact (a pattern, not a confirmed cause)" });
    }
    if (!notes.length) notes.push("Fatigue is spread sensibly across sessions and weeks");
    const why = [ctx.recoveryFlags >= 2 && "sleep or energy flagged", ctx.deficitPct != null && ctx.deficitPct < -15 && "a calorie deficit", ctx.lowerPerformance === "down" && "lower-body strength is down", harder && "loads running heavier than written"].filter(Boolean) as string[];
    cats.push({ key: "fatigue", label: "Fatigue and recovery", score: clampScore(s), weight: 0.12, notes, critical: why.length ? why.join(", ") : null, concerns });
  }

  // ── Progressive overload and periodization ──
  {
    const notes: string[] = [];
    let s = 100;
    const prog = mainLiftProgression(input);
    if (prog.total && prog.missing.length) {
      const share = prog.missing.length / prog.total;
      s -= Math.min(36, Math.round(share * 40) + 4);
      notes.push(`${prog.missing.length} main lift${prog.missing.length === 1 ? " stays" : "s stay"} the same every week with no note on how to progress`);
    }
    const easier = ctx.easier ?? 0;
    if (ctx.effort && ctx.effort.rated >= 6 && easier / ctx.effort.rated >= 0.4 && !lightWeek) {
      s -= 12;
      notes.push(`${easier} of ${ctx.effort.rated} sets at the loads you set ran 2+ RPE under target lately: room to progress the loads faster`);
    }
    const typeVol = byId(findings, "decision:type-volume");
    if (typeVol.length) {
      s -= 10;
      notes.push(typeVol[0].title);
    }
    const untyped = input.blocks.filter((b) => !b.blockType).length;
    if (untyped && input.blocks.length) {
      s -= 4;
      notes.push(`${untyped === input.blocks.length ? "No block type set" : `${untyped} block${untyped === 1 ? "" : "s"} with no type set`} (read from the name)`);
    }
    if (!notes.length) notes.push(prog.total ? "Main lifts progress week to week" : "Progression is set for the work that needs it");
    cats.push({ key: "progression", label: "Progression and periodization", score: clampScore(s), weight: 0.12, notes, critical: ctx.lowerPerformance === "down" && !execution.expected && adh != null && adh >= FOLLOW_LOW ? "strength is down while they follow it" : null });
  }

  // ── Exercise order and equipment efficiency ──
  {
    const notes: string[] = [];
    let s = 100;
    const flow = findings.find((f) => f.id === "safe:accessory-flow");
    if (flow) {
      s -= Math.min(12, flow.at.length * 2);
      notes.push(`${flow.at.length} workout${flow.at.length === 1 ? "" : "s"} could move between fewer stations`);
    }
    let isoFirst = 0;
    const b = input.blocks[live!.bi];
    (b.weeks[live!.wi].days ?? []).forEach((d) => {
      const list = rows(d).filter((r) => !isTimed(r));
      const firstMain = list.findIndex((r) => liftFamily(r, input) != null || /\b(primary|top ?set|competition)\b/i.test(String(r?.purpose_label ?? "")));
      if (firstMain <= 0) return;
      const before = list.slice(0, firstMain).filter((r) => {
        if (/warm|activat|prep|primer/i.test(`${r?.purpose_label ?? ""} ${r?.notes ?? ""}`)) return false;
        const meta = r?.exercise_id ? input.exercises.get(r.exercise_id) : undefined;
        return ISOLATION.includes(classifyExercise(exNameOf(r, input), meta?.exercise_category ?? null).pattern);
      });
      if (before.length) isoFirst++;
    });
    if (isoFirst) {
      s -= Math.min(18, isoFirst * 6);
      notes.push(`Isolation work before the main lift on ${isoFirst} day${isoFirst === 1 ? "" : "s"}`);
    }
    if (!notes.length) notes.push("Main lifts first, accessories grouped by station");
    cats.push({ key: "order", label: "Order and flow", score: clampScore(s), weight: 0.08, notes });
  }

  // ── Individualization ──
  const indConcerns: CategoryConcern[] = [];
  {
    const notes: string[] = [];
    let s = 100;
    if (ctx.trainingDays.length) {
      if (week.days > ctx.trainingDays.length) {
        s -= 15;
        notes.push(`${week.days} workouts a week; they train ${ctx.trainingDays.length} days`);
      } else if (week.days < ctx.trainingDays.length - 1) {
        s -= 6;
        notes.push(`${week.days} workouts a week; they've set ${ctx.trainingDays.length} training days`);
      }
    } else notes.push("Their training days aren't set");
    const maxes = findings.find((f) => f.id === "warning:maxes");
    if (maxes) {
      s -= 10;
      notes.push(maxes.title);
    }
    if (ctx.level === "beginner") {
      let maxEffort = 0;
      for (const d of input.blocks[live!.bi].weeks[live!.wi].days ?? [])
        for (const r of rows(d)) if (liftFamily(r, input) && ((rpeOf(r) ?? 0) >= 9.5 || repsOf(r) === 1)) maxEffort++;
      if (maxEffort) {
        s -= 10;
        notes.push("Singles or RPE 9.5+ on the main lifts for a beginner");
        indConcerns.push({ text: "Singles or RPE 9.5+ on the main lifts for a beginner", severity: "significant", reason: "safety" });
      }
    }
    if (!input.athlete?.equipment || input.athlete.equipment.confidence === "unknown") notes.push("Equipment isn't on file, so it's checked by exercise name only");
    if (!notes.length || (notes.length === 1 && /equipment/i.test(notes[0]))) notes.unshift("Fits their days, maxes and experience");
    cats.push({ key: "individual", label: "Individualization", score: clampScore(s), weight: 0.1, notes, concerns: indConcerns });
  }

  // ── Session duration and sustainability ──
  {
    const notes: string[] = [];
    let s = 100;
    const far = findings.find((f) => f.id === "warning:duration");
    const near = findings.find((f) => f.id === "decision:duration");
    const slots = (input.blocks[live!.bi].weeks[live!.wi].days ?? []).filter((d) => rows(d).length).length;
    const concerns: CategoryConcern[] = [];
    const pt = input.athlete?.sessionLimit?.source === "pt";
    if (far) {
      // every workout well past their limit is the program's shape, not a slip
      const every = far.at.length >= Math.max(2, slots);
      s -= every ? 45 : Math.min(30, far.at.length * 10);
      notes.push(far.title);
      if (every && (pt || (adh != null && adh < FOLLOW_LOW))) concerns.push({ text: `Every workout runs well past ${input.athlete?.sessionLimit?.phrase ?? "their session limit"}`, severity: "significant", reason: "adherence" });
    }
    if (near) {
      s -= Math.min(15, near.at.length * 4);
      notes.push(near.title);
    }
    const mins = (input.blocks[live!.bi].weeks[live!.wi].days ?? []).filter((d) => rows(d).length).map((d) => estimateDayMinutes(rows(d) as any));
    const longest = mins.length ? Math.max(...mins) : 0;
    if (!input.athlete?.sessionLimit?.minutes && longest > 120) {
      s -= 10;
      notes.push(`Workouts run about ${longest} min`);
    }
    if (adh != null && adh < FOLLOW_LOW && (far || near || longest > 105)) {
      s -= 10;
      notes.push(`Only ${adh}% of workouts done lately, which fits sessions running long`);
    }
    if (!notes.length) notes.push(mins.length ? `About ${Math.min(...mins)}–${longest} min a session${input.athlete?.sessionLimit?.minutes ? `, inside ${input.athlete.sessionLimit.short}` : ""}` : "Sessions are a sensible length");
    cats.push({ key: "duration", label: "Session length", score: clampScore(s), weight: 0.1, notes, critical: pt ? "a booked PT session" : adh != null && adh < FOLLOW_LOW ? "they're missing workouts" : null, concerns });
  }

  // ── Competition timeline (only with a meet) ──
  if (ctx.meet && ctx.meet.weeksOut <= 26 && ctx.meet.weeksOut >= 0) {
    const notes: string[] = [];
    let s = 100;
    const meetDate = ctx.meet.date;
    const ends = ctx.blocks.map((b) => b.end).filter((e): e is string => !!e).sort();
    const lastEnd = ends[ends.length - 1] ?? null;
    const weeksShort = lastEnd ? Math.round((Date.parse(`${meetDate}T00:00:00Z`) - Date.parse(`${lastEnd}T00:00:00Z`)) / (7 * 86_400_000)) : null;
    const concerns: CategoryConcern[] = [];
    if (weeksShort != null && weeksShort >= 2) {
      s -= ctx.meet.weeksOut <= 12 ? 25 : 8;
      notes.push(`The program ends ${weeksShort} weeks before the meet${ctx.meet.weeksOut <= 12 ? "" : " (plan the final prep later)"}`);
      if (ctx.meet.weeksOut <= 12) concerns.push({ text: `The program ends ${weeksShort} weeks before the meet`, severity: "significant", reason: "timeline" });
    }
    if (ctx.meet.weeksOut <= 8) {
      const families = input.blocks.map((b) => blockTypeFamily(resolveBlockType({ block_type: b.blockType, block_meta: b.blockMeta, phase: b.phase, training_focus: b.trainingFocus, name: b.name }, input.blockTypes).type));
      const phases = input.blocks.flatMap((b) => b.weeks.map((w) => String(w.phase ?? "")));
      const peaks = families.some((f) => f === "peaking" || f === "taper") || phases.some((p) => /peak|taper|meet/i.test(p)) || input.blocks.some((b) => /peak|taper/i.test(b.name));
      if (!peaks) {
        s -= 25;
        notes.push(`No peak or taper in the ${Math.round(ctx.meet.weeksOut)} weeks before the meet`);
        concerns.push({ text: `No peak or taper in the ${Math.round(ctx.meet.weeksOut)} weeks before the meet`, severity: "significant", reason: "timeline" });
      }
    }
    if (!notes.length) notes.push(`Builds to ${ctx.meet.name ?? "the meet"} on ${meetDate}`);
    cats.push({ key: "timeline", label: "Competition timeline", score: clampScore(s), weight: 0.08, notes, critical: ctx.meet.weeksOut <= 12 ? `a meet in ${Math.round(ctx.meet.weeksOut)} weeks` : null, concerns });
  }

  return finishQuality(cats, { what: "training program", points, missing, execution, connections, recovery, settling, changes: ctx.changeLog?.changes, domain: "training", firstName: ctx.firstName });
}
