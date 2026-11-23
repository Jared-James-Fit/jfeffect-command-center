/**
 * Cardio's recovery and performance read (Nov 23 2026): one deterministic pass
 * over what's already on file (strength on the lower lifts from comparable
 * sets, the weekly check-ins, workout check-outs, a wearable when they have
 * one, the bodyweight trend, cardio adherence, steps, the meet, the
 * weight-management engine's call) that answers "is the cardio right for this
 * person right now?". Pure, tested (cardio-insights.test.ts).
 *
 * It says what it sees and how sure it is, and keeps a pattern apart from a
 * cause: strength dropping while cardio went up "lines up with" the cardio,
 * it is never "caused by" it, and other explanations (sleep, stress, food)
 * are named beside it. It judges the person against their own baseline, never
 * a universal number, and holding the plan is the usual answer. A model may
 * word or act on this read; it never decides a number here.
 */
export type RecKind =
  | "maintain"
  | "increase"
  | "reduce"
  | "redistribute"
  | "lower_intensity"
  | "change_modality"
  | "move_away"
  | "adjust_nutrition"
  | "collect_data";

export type Confidence = "high" | "moderate" | "low";

export type CardioRecommendation = {
  kind: RecKind;
  title: string;
  observation: string;
  reason: string;
  confidence: Confidence;
  /** "pattern": two things move together; never "confirmed" unless the client said so. */
  relation: "pattern" | "reported" | null;
  evidence: string[];
  /** Other explanations worth ruling out first. */
  alternatives: string[];
  /** What to ask Cleo to draft, in the coach's words. */
  ask: string | null;
};

export type SignalStatus = "good" | "watch" | "flag" | "unknown";
export type Signal = { key: string; label: string; value: string; status: SignalStatus; source: "measured" | "reported" | "estimated" };

export type CardioReadInput = {
  today: string;
  plan: {
    empty: boolean;
    minutes: number;
    sessions: number;
    hardMinutes: number;
    avgRpe: number | null;
    /** Sessions a week of running, conditioning or the stair climber. */
    highImpactSessions: number;
    /** Sessions a week set before lifting on a lifting day. */
    beforeLifting: number;
    /** Moderate or hard sessions on the day before a heavy squat or deadlift. */
    dayBeforeHeavyLower: number;
    /** The longest session on a training day. */
    trainingDayMinutesMax: number;
    /** The share of the week's minutes on its biggest day (0–1). */
    biggestDayShare: number;
    days: number;
  };
  goal: {
    direction: "lose" | "gain" | "maintain";
    status: string | null;
    pctPerWeek: number | null;
    trendClear: boolean;
  };
  /** Sessions done of those prescribed, over the last 4 full weeks. */
  adherence: { done: number; planned: number } | null;
  /** Prescribed minutes a week, the last 3 weeks against the 3 before. */
  prescribedTrend: { recent: number | null; prior: number | null };
  performance: { lower: "up" | "steady" | "down" | null; detail: string | null };
  /** Weekly check-in "How did your workouts feel" (1–5), the last 3 against the 3 before. */
  trainingRating: { recent: number | null; prior: number | null };
  /** Working sets a week, the last 3 weeks against the 3 before. */
  volume: { recent: number | null; prior: number | null };
  checkins: { count: number; poorSleep: number; lowEnergy: number; stress: number; hungerHigh: boolean; cardioIssues: string[] };
  wearables: { restingHr: { recent: number; baseline: number } | null; hrv: { recent: number; baseline: number } | null; sleepHours: number | null };
  /** Workout check-outs, the last 3 weeks: how recovered they felt going in (1–5). */
  feedback: { recovery: number | null; sessions: number };
  steps: number | null;
  meetWeeksOut: number | null;
  walkingLimits: string[];
  powerlifter: boolean;
  /** The weight-management engine's call, so this never contradicts it. */
  wm: { verdict: string; limiting: string; cardio: "up" | "down" | null; nutrition: boolean; headline: string } | null;
};

export type CardioRead = {
  primary: CardioRecommendation;
  others: CardioRecommendation[];
  signals: Signal[];
  gaps: string[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : 0);

function confidenceOf(points: number): Confidence {
  return points >= 3 ? "high" : points === 2 ? "moderate" : "low";
}

/** The read's signals: each one measured, reported or estimated, against the person's own baseline. */
export function cardioSignals(x: CardioReadInput): Signal[] {
  const out: Signal[] = [];
  const p = x.performance;
  out.push({
    key: "strength",
    label: "Lower-body strength",
    value: p.lower == null ? "Not enough hard sets to read" : p.detail ?? p.lower,
    status: p.lower == null ? "unknown" : p.lower === "down" ? "flag" : "good",
    source: "measured",
  });
  if (x.volume.recent != null && x.volume.prior != null && x.volume.prior > 0) {
    const d = Math.round(pct(x.volume.recent, x.volume.prior));
    out.push({
      key: "volume",
      label: "Training volume",
      value: `${Math.round(x.volume.recent)} working sets a week (${d >= 0 ? "+" : "−"}${Math.abs(d)}% vs the 3 weeks before)`,
      status: Math.abs(d) >= 20 ? "watch" : "good",
      source: "measured",
    });
  }
  if (x.trainingRating.recent != null) {
    const dropped = x.trainingRating.prior != null && x.trainingRating.prior - x.trainingRating.recent >= 1;
    out.push({
      key: "training_feel",
      label: "How training feels",
      value: `${r1(x.trainingRating.recent)}/5 lately${x.trainingRating.prior != null ? ` (was ${r1(x.trainingRating.prior)})` : ""}`,
      status: x.trainingRating.recent <= 2.5 || dropped ? "flag" : x.trainingRating.recent < 3.5 ? "watch" : "good",
      source: "reported",
    });
  }
  if (x.checkins.count > 0) {
    const n = Math.min(3, x.checkins.count);
    out.push({ key: "sleep", label: "Sleep", value: x.checkins.poorSleep ? `Flagged in ${x.checkins.poorSleep} of the last ${n} check-ins` : "Not flagged", status: x.checkins.poorSleep >= 2 ? "flag" : x.checkins.poorSleep ? "watch" : "good", source: "reported" });
    out.push({ key: "energy", label: "Energy", value: x.checkins.lowEnergy ? `Low in ${x.checkins.lowEnergy} of the last ${n} check-ins` : "Not flagged", status: x.checkins.lowEnergy >= 2 ? "flag" : x.checkins.lowEnergy ? "watch" : "good", source: "reported" });
    if (x.checkins.stress) out.push({ key: "stress", label: "Stress", value: `Flagged in ${x.checkins.stress} of the last ${n} check-ins`, status: x.checkins.stress >= 2 ? "watch" : "good", source: "reported" });
    if (x.checkins.hungerHigh) out.push({ key: "hunger", label: "Hunger", value: "High", status: "watch", source: "reported" });
  }
  if (x.wearables.sleepHours != null) {
    out.push({ key: "sleep_tracked", label: "Tracked sleep", value: `${r1(x.wearables.sleepHours)} h a night (7 days)`, status: x.wearables.sleepHours < 6.5 ? "flag" : x.wearables.sleepHours < 7 ? "watch" : "good", source: "measured" });
  }
  if (x.wearables.restingHr) {
    const d = x.wearables.restingHr.recent - x.wearables.restingHr.baseline;
    out.push({ key: "rhr", label: "Resting heart rate", value: `${Math.round(x.wearables.restingHr.recent)} bpm (${d >= 0 ? "+" : "−"}${Math.abs(Math.round(d))} vs their usual)`, status: d >= 5 ? "flag" : d >= 3 ? "watch" : "good", source: "measured" });
  }
  if (x.wearables.hrv) {
    const d = Math.round(pct(x.wearables.hrv.recent, x.wearables.hrv.baseline));
    out.push({ key: "hrv", label: "HRV", value: `${Math.round(x.wearables.hrv.recent)} ms (${d >= 0 ? "+" : "−"}${Math.abs(d)}% vs their usual)`, status: d <= -15 ? "flag" : d <= -8 ? "watch" : "good", source: "measured" });
  }
  if (x.feedback.recovery != null && x.feedback.sessions >= 2) {
    out.push({ key: "recovered", label: "Felt recovered before lifting", value: `${r1(x.feedback.recovery)}/5 over ${x.feedback.sessions} workouts`, status: x.feedback.recovery <= 2.5 ? "flag" : x.feedback.recovery < 3.3 ? "watch" : "good", source: "reported" });
  }
  if (x.adherence && x.adherence.planned > 0) {
    const a = Math.round((x.adherence.done / x.adherence.planned) * 100);
    out.push({ key: "adherence", label: "Cardio done", value: `${x.adherence.done} of ${x.adherence.planned} sessions (${Math.min(100, a)}%) in 4 weeks`, status: a >= 85 ? "good" : a >= 60 ? "watch" : "flag", source: "measured" });
  }
  if (x.goal.pctPerWeek != null) {
    const v = x.goal.pctPerWeek;
    const onWay = (x.goal.direction === "lose" && v < 0) || (x.goal.direction === "gain" && v > 0) || (x.goal.direction === "maintain" && Math.abs(v) < 0.3);
    out.push({
      key: "bodyweight",
      label: "Bodyweight trend",
      value: `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(r1(v * 10) / 10)}% a week${x.goal.trendClear ? "" : " (inside normal day-to-day noise)"}`,
      status: !x.goal.trendClear ? "unknown" : onWay ? "good" : "watch",
      source: "measured",
    });
  }
  if (x.steps != null) out.push({ key: "steps", label: "Daily steps", value: `${x.steps.toLocaleString("en-US")} a day`, status: "good", source: "measured" });
  if (x.checkins.cardioIssues.length) {
    const bad = x.checkins.cardioIssues.filter((i) => i !== "Too easy");
    out.push({ key: "cardio_issues", label: "Cardio, in their words", value: x.checkins.cardioIssues.join(", "), status: bad.length ? "flag" : "watch", source: "reported" });
  }
  if (x.meetWeeksOut != null && x.meetWeeksOut <= 8) {
    out.push({ key: "meet", label: "Competition", value: x.meetWeeksOut < 1 ? "This week" : `${Math.round(x.meetWeeksOut)} weeks out`, status: x.meetWeeksOut <= 4 ? "watch" : "good", source: "measured" });
  }
  return out;
}

/** What's missing for a sure read (said once, never a reason to change anything). */
export function cardioGaps(x: CardioReadInput): string[] {
  const out: string[] = [];
  if (x.goal.pctPerWeek == null) out.push("No usable bodyweight trend (4+ weigh-ins over 10+ days)");
  if (!x.checkins.count) out.push("No weekly check-ins yet");
  if (x.performance.lower == null) out.push("Not enough hard squat or deadlift sets to read strength");
  if (!x.plan.empty && x.adherence && x.adherence.planned > 0 && x.adherence.done === 0) out.push("No cardio logged in 4 weeks");
  return out;
}

const ISSUE = (x: CardioReadInput, s: string) => x.checkins.cardioIssues.some((i) => i.toLowerCase() === s.toLowerCase());

/** The read: the most useful recommendation first, up to two more that don't contradict it. */
export function buildCardioRead(x: CardioReadInput): CardioRead {
  const recs: CardioRecommendation[] = [];
  const signals = cardioSignals(x);
  const flag = (k: string) => signals.find((s) => s.key === k)?.status === "flag";
  const meetClose = x.meetWeeksOut != null && x.meetWeeksOut <= 4;

  // 1. Something that hurts: walking limits or joint pain on a high-impact kind
  if ((x.walkingLimits.length || ISSUE(x, "Joint pain")) && x.plan.highImpactSessions > 0) {
    recs.push({
      kind: "change_modality",
      title: "Swap the high-impact cardio",
      observation: x.walkingLimits.length ? `On file: ${x.walkingLimits.join(", ")}.` : "They reported joint pain with cardio.",
      reason: "A bike, elliptical or flat walk gives the same aerobic work with less load on the joints.",
      confidence: x.walkingLimits.length && ISSUE(x, "Joint pain") ? "high" : "moderate",
      relation: "reported",
      evidence: [x.walkingLimits.length ? `Injury on file: ${x.walkingLimits.join(", ")}` : "", ISSUE(x, "Joint pain") ? "Check-in: joint pain with cardio" : ""].filter(Boolean),
      alternatives: [],
      ask: "Swap the running, stairs or conditioning for a low-impact option (bike, elliptical or flat treadmill walk) at the same weekly time.",
    });
  }

  // 2. The meet: easy into it, nothing new
  if (meetClose && x.meetWeeksOut! <= 2 && (x.plan.hardMinutes > 0 || x.plan.highImpactSessions > 0)) {
    recs.push({
      kind: "lower_intensity",
      title: "Keep cardio easy into the meet",
      observation: `${x.meetWeeksOut! < 1 ? "The meet is this week" : `${Math.round(x.meetWeeksOut!)} weeks to the meet`} and ${x.plan.hardMinutes} min a week is set at RPE 6+.`,
      reason: "Fresh legs matter more than conditioning this close; easy walks keep the habit without the fatigue.",
      confidence: "high",
      relation: null,
      evidence: [`Hard minutes a week: ${x.plan.hardMinutes}`],
      alternatives: [],
      ask: "Bring every session down to an easy walk (RPE 3–4) until the meet, same days, nothing new.",
    });
  }

  // 3. Interference: an outcome (strength, legs, how training feels) with something on the cardio side
  const outcome: string[] = [];
  if (x.performance.lower === "down") outcome.push(`Strength: ${(x.performance.detail ?? "lower lifts down").replace(/[.\s]+$/, "")}`);
  if (ISSUE(x, "Legs tired for lifting")) outcome.push("Check-in: legs tired for lifting");
  if (flag("training_feel")) outcome.push("Training has felt worse lately");
  if (flag("recovered")) outcome.push("Low recovery reported before workouts");
  const cardioSide: string[] = [];
  const rose = x.prescribedTrend.recent != null && x.prescribedTrend.prior != null && x.prescribedTrend.prior > 0 && x.prescribedTrend.recent > x.prescribedTrend.prior * 1.2;
  if (rose) cardioSide.push(`Cardio went from ~${Math.round(x.prescribedTrend.prior!)} to ~${Math.round(x.prescribedTrend.recent!)} min a week`);
  if (x.plan.beforeLifting > 0) cardioSide.push(`${x.plan.beforeLifting} session${x.plan.beforeLifting > 1 ? "s" : ""} a week before lifting`);
  if (x.plan.dayBeforeHeavyLower > 0) cardioSide.push("Harder cardio the day before a heavy squat or deadlift day");
  if (x.plan.highImpactSessions > 0) cardioSide.push(`${x.plan.highImpactSessions} high-impact session${x.plan.highImpactSessions > 1 ? "s" : ""} a week`);
  if (x.plan.hardMinutes >= 40) cardioSide.push(`${x.plan.hardMinutes} min a week at RPE 6+`);
  const others: string[] = [];
  if (flag("sleep") || flag("sleep_tracked")) others.push("poor sleep");
  if (x.checkins.stress >= 2) others.push("stress");
  if (flag("energy")) others.push("low energy");
  if (x.wm?.limiting === "energy_balance" || x.wm?.limiting === "rate") others.push("the size of the deficit");
  if (x.volume.recent != null && x.volume.prior != null && x.volume.recent > x.volume.prior * 1.2) others.push("more lifting volume");
  if (outcome.length && cardioSide.length) {
    const points = outcome.length + cardioSide.length + (x.performance.lower === "down" ? 1 : 0);
    const base = {
      confidence: confidenceOf(Math.min(3, points - 1)),
      relation: "pattern" as const,
      evidence: [...outcome, ...cardioSide],
      alternatives: others,
    };
    const observation = `${outcome[0]}, and it lines up with: ${cardioSide.join("; ").toLowerCase()}.`;
    if (x.plan.beforeLifting > 0 || x.plan.dayBeforeHeavyLower > 0) {
      recs.push({
        ...base,
        kind: "move_away",
        title: "Move cardio away from heavy lifting",
        observation,
        reason: "Same weekly cardio, placed after lifting or on lighter days, usually costs the lifts less. It may not be the cause; moving it is the smallest test.",
        ask: "Keep the weekly cardio but move it after lifting or onto days that aren't the day before a heavy squat or deadlift.",
      });
    } else if (x.plan.highImpactSessions > 0) {
      recs.push({
        ...base,
        kind: "change_modality",
        title: "Use a lower-impact kind of cardio",
        observation,
        reason: "Running and stairs load the legs eccentrically; a bike or incline walk gives the aerobic work with less fatigue for lifting.",
        ask: "Replace the high-impact sessions with incline treadmill walking or the bike at the same weekly minutes.",
      });
    } else if (rose) {
      recs.push({
        ...base,
        kind: "reduce",
        title: "Bring cardio back toward where it was",
        observation,
        reason: `Strength moved after cardio went up. Going back toward ~${Math.round(x.prescribedTrend.prior!)} min a week tests whether that's the link.`,
        ask: `Reduce weekly cardio toward about ${Math.round(x.prescribedTrend.prior!)} minutes without compromising their current goal.`,
      });
    } else {
      recs.push({
        ...base,
        kind: "lower_intensity",
        title: "Keep the time, lower the effort",
        observation,
        reason: "Holding the duration at an easier effort keeps the energy cost similar with less fatigue.",
        ask: "Keep the same minutes but bring the effort down to easy (RPE 3–4, conversational).",
      });
    }
  } else if (x.performance.lower === "down" && !cardioSide.length) {
    recs.push({
      kind: x.wm?.nutrition ? "adjust_nutrition" : "collect_data",
      title: "Strength is down, but the cardio isn't the likely reason",
      observation: `${(x.performance.detail ?? "Lower lifts are down").replace(/[.\s]+$/, "")} while the cardio hasn't changed and isn't hard.`,
      reason: "Nothing on the cardio side lines up with it; look at recovery, food and the program before touching cardio.",
      confidence: "moderate",
      relation: null,
      evidence: [`Strength: ${x.performance.detail ?? "down"}`],
      alternatives: others,
      ask: null,
    });
  }

  // 4. Recovery limited and the cardio isn't easy
  const recoveryFlags = ["sleep", "sleep_tracked", "energy", "rhr", "hrv", "recovered"].filter(flag);
  if (recoveryFlags.length >= 2 && ((x.plan.avgRpe ?? 0) >= 5 || x.plan.hardMinutes > 0) && !recs.some((r) => r.kind === "lower_intensity")) {
    recs.push({
      kind: "lower_intensity",
      title: "Make the cardio easier while recovery is down",
      observation: `${recoveryFlags.length} recovery signals are off (${signals.filter((s) => recoveryFlags.includes(s.key)).map((s) => s.label.toLowerCase()).join(", ")}).`,
      reason: "An easier effort keeps the habit and most of the energy cost without adding to fatigue.",
      confidence: recoveryFlags.some((k) => k === "rhr" || k === "hrv" || k === "sleep_tracked") ? "moderate" : "low",
      relation: "pattern",
      evidence: signals.filter((s) => recoveryFlags.includes(s.key)).map((s) => `${s.label}: ${s.value}`),
      alternatives: x.checkins.stress >= 2 ? ["life stress"] : [],
      ask: "Keep the days and minutes, bring the effort to easy (RPE 3–4) until recovery improves.",
    });
  }

  // 5. Not getting it done: find out why before changing the numbers
  if (!x.plan.empty && x.adherence && x.adherence.planned >= 4 && x.adherence.done / x.adherence.planned < 0.7) {
    const a = Math.round((x.adherence.done / x.adherence.planned) * 100);
    if (ISSUE(x, "No time")) {
      recs.push({
        kind: "redistribute",
        title: "Make it fit their week",
        observation: `${a}% of sessions done in 4 weeks, and they said they had no time.`,
        reason: "Shorter sessions, a little more incline for the same work, or walks split through the day are easier to keep than long sessions.",
        confidence: "high",
        relation: "reported",
        evidence: [`Cardio done: ${x.adherence.done} of ${x.adherence.planned}`, "Check-in: no time"],
        alternatives: [],
        ask: "Make the cardio time-efficient: shorter sessions with a little more incline, or split walks through the day, keeping the weekly work about the same.",
      });
    } else if (ISSUE(x, "Too hard")) {
      recs.push({
        kind: "lower_intensity",
        title: "Make it doable first",
        observation: `${a}% of sessions done, and they said it was too hard.`,
        reason: "A plan they finish beats a harder one they skip.",
        confidence: "high",
        relation: "reported",
        evidence: [`Cardio done: ${x.adherence.done} of ${x.adherence.planned}`, "Check-in: too hard"],
        alternatives: [],
        ask: "Lower the effort and the incline so every session is easy to finish, same days.",
      });
    } else {
      recs.push({
        kind: "collect_data",
        title: "Find out what's getting in the way",
        observation: `${a}% of the prescribed sessions were logged in 4 weeks.`,
        reason: "Changing the numbers won't help if the sessions aren't happening; ask before adjusting.",
        confidence: "moderate",
        relation: null,
        evidence: [`Cardio done: ${x.adherence.done} of ${x.adherence.planned}`],
        alternatives: ["sessions done but not logged"],
        ask: null,
      });
    }
  }

  // 6. The weight-management engine's call on energy balance (one lever at a time)
  if (x.wm?.cardio === "up" && !meetClose) {
    recs.push({
      kind: "increase",
      title: "Add a little cardio",
      observation: x.wm.headline,
      reason: "The bodyweight trend needs a bit more output, and food is already as low as it should go (or hunger is high).",
      confidence: "moderate",
      relation: null,
      evidence: [x.wm.headline],
      alternatives: [],
      ask: "Increase cardio by one small step (a few minutes or a little incline on the non-training-day sessions), nothing else.",
    });
  } else if (x.wm?.cardio === "down") {
    recs.push({
      kind: "reduce",
      title: "Ease the cardio back",
      observation: x.wm.headline,
      reason: "The weight-management read says the output is more than the goal needs right now.",
      confidence: "moderate",
      relation: null,
      evidence: [x.wm.headline],
      alternatives: [],
      ask: "Reduce cardio by one small step without compromising their current progress.",
    });
  } else if (x.wm?.nutrition) {
    recs.push({
      kind: "adjust_nutrition",
      title: "Change food, keep the cardio",
      observation: x.wm.headline,
      reason: "One lever at a time: the nutrition change closes the gap, and keeping cardio steady makes its effect readable.",
      confidence: "moderate",
      relation: null,
      evidence: [x.wm.headline],
      alternatives: [],
      ask: null,
    });
  }

  // 7. Too easy and everything else is fine: progress the incline first
  if (ISSUE(x, "Too easy") && !recoveryFlags.length && x.goal.direction === "lose" && !meetClose && !recs.some((r) => r.kind === "increase" || r.kind === "reduce")) {
    recs.push({
      kind: "increase",
      title: "Progress the effort a little",
      observation: "They said the cardio felt too easy and recovery looks fine.",
      reason: "A little more incline (or speed) adds work without adding time.",
      confidence: "moderate",
      relation: "reported",
      evidence: ["Check-in: cardio too easy"],
      alternatives: [],
      ask: "Add 1–2% incline to the treadmill sessions, nothing else.",
    });
  }

  // 8. Lopsided week or a long session stuck on a training day
  const trainCap = x.powerlifter ? 15 : 20;
  if (!x.plan.empty && (x.plan.trainingDayMinutesMax > trainCap + 10 || (x.plan.biggestDayShare > 0.5 && x.plan.sessions >= 3))) {
    recs.push({
      kind: "redistribute",
      title: "Spread the week more evenly",
      observation:
        x.plan.trainingDayMinutesMax > trainCap + 10
          ? `A ${x.plan.trainingDayMinutesMax}-minute session sits on a training day.`
          : `${Math.round(x.plan.biggestDayShare * 100)}% of the week's cardio is on one day.`,
      reason: "Most cardio on days off, and a short easy walk after lifting, keeps the same weekly work with less overlap with training.",
      confidence: "moderate",
      relation: null,
      evidence: [`Weekly: ${x.plan.minutes} min over ${x.plan.sessions} sessions`],
      alternatives: [],
      ask: `Redistribute the same weekly minutes: training-day sessions ${trainCap} min or less after lifting, the rest on days off.`,
    });
  }

  // 9. No cardio: only when the goal needs it
  if (x.plan.empty && !recs.length) {
    const needs = x.goal.direction === "lose" && x.goal.trendClear && (x.goal.status === "stalled" || x.goal.status === "behind" || x.goal.status === "wrong_way");
    recs.push(
      needs
        ? {
            kind: "increase",
            title: "Consider starting easy cardio",
            observation: "No cardio is set and the bodyweight trend is behind the goal.",
            reason: "A few easy incline walks on days off add output without touching training.",
            confidence: "low",
            relation: null,
            evidence: [x.goal.status ? `Trend: ${x.goal.status.replace("_", " ")}` : ""].filter(Boolean),
            alternatives: ["nutrition adherence", "a food change instead"],
            ask: "Build a simple, time-efficient cardio plan around their training days: easy incline treadmill walks on days off.",
          }
        : {
            kind: "maintain",
            title: "No cardio needed right now",
            observation: x.goal.direction === "gain" ? "They're building, and cardio isn't set." : "Nothing in their goal or recovery calls for cardio.",
            reason: "Not every client needs cardio; add it when the goal or their health asks for it.",
            confidence: "moderate",
            relation: null,
            evidence: [],
            alternatives: [],
            ask: null,
          },
    );
  }

  if (!recs.length) {
    recs.push({
      kind: "maintain",
      title: "Keep the cardio as it is",
      observation: x.adherence && x.adherence.planned ? `${Math.min(100, Math.round((x.adherence.done / x.adherence.planned) * 100))}% of sessions done, and nothing in recovery or strength points at the cardio.` : "Nothing in recovery or strength points at the cardio.",
      reason: "It's working or it's too early to tell; changing it now would make the next weeks harder to read.",
      confidence: cardioGaps(x).length >= 2 ? "low" : "moderate",
      relation: null,
      evidence: signals.filter((s) => s.status === "good").slice(0, 3).map((s) => `${s.label}: ${s.value}`),
      alternatives: [],
      ask: null,
    });
  }

  // one direction only: an increase never sits beside a reduce
  const primary = recs[0];
  const down = new Set<RecKind>(["reduce", "lower_intensity", "move_away", "change_modality"]);
  const rest = recs.slice(1).filter((r) => {
    if (r.kind === primary.kind) return false;
    if (primary.kind === "increase" && down.has(r.kind)) return false;
    if (down.has(primary.kind) && r.kind === "increase") return false;
    if (primary.kind === "maintain") return false;
    return true;
  });
  return { primary, others: rest.slice(0, 2), signals, gaps: cardioGaps(x) };
}

export const REC_LABEL: Record<RecKind, string> = {
  maintain: "Maintain",
  increase: "Increase",
  reduce: "Reduce",
  redistribute: "Redistribute",
  lower_intensity: "Lower intensity",
  change_modality: "Change modality",
  move_away: "Move away from lifting",
  adjust_nutrition: "Adjust nutrition instead",
  collect_data: "Collect more information",
};
