/**
 * Plan quality for training, nutrition and cardio (Nov 23 2026; one model for
 * all three Nov 24 2026): a design score out of 100 by category, worked out by
 * code from the plan and what's on file (program-quality.ts,
 * nutrition-targets/plan-quality.ts, cardio/quality.ts), kept apart from how
 * the client is following it. The same rules for all three; each engine says
 * what matters most for this client (critical categories) and flags what can't
 * wait (concerns), so the standard is consistent and the read is theirs.
 *
 *   Design      how well the prescription suits this person and their goal,
 *               never how aggressive or elaborate it is. A category with
 *               nothing to judge is left out (never guessed); fewer than
 *               MIN_JUDGED categories judged is "not enough data", never a
 *               number, and a thin read is marked provisional.
 *   Execution   adherence (planned → done) and results (bodyweight, strength)
 *               shown beside the score, never mixed into it. They only shape
 *               the design score where they're evidence about the design, and
 *               never for a plan that changed within SETTLE_DAYS (results from
 *               the old plan neither count against nor flatter the new one).
 *   Concerns    what needs the coach whatever the overall score: a safety or
 *               recovery flag, a weak or client-critical category, recovery
 *               slipping, very low adherence, results going the wrong way. A
 *               plan that scores 88 with one of these says so first.
 *   Verdict     one line: a concern, a design problem, a sound plan they're
 *               struggling to follow, practicality, followed but not working,
 *               changed recently (give it time), or keep it as is; and whether
 *               the coach needs to act.
 *
 * What would help (opportunities: every category under 90) is ranked by what
 * matters for the client (a concern first, then what's critical for them, then
 * what their adherence, results or recovery back up, then the size of the gap),
 * never by points. Small gaps on a plan that's working are optional fine-tuning:
 * keeping a working plan is a result, not a missed opportunity. Optimize with
 * Cleo is always there (a review that may well say "keep it"), and its ask never
 * mentions the score, so nothing is changed to chase a number.
 *
 * It is a coaching check, not a validated or clinical measure; the coach can
 * always publish their own plan over it.
 */
export type QualityDomain = "training" | "nutrition" | "cardio";

export type ConcernReason = "safety" | "recovery" | "timeline" | "results" | "adherence" | "weak_spot";
export type ConcernSeverity = "urgent" | "significant";

/** A specific issue an engine flags in a category (an allergen on the plan, pain loaded, loads heavier than written…). */
export type CategoryConcern = { text: string; severity: ConcernSeverity; reason: ConcernReason };

export type QualityCategory = {
  key: string;
  label: string;
  /** 0–100, or null when there's nothing to judge it on. */
  score: number | null;
  weight: number;
  /** What lowered it, or what it's good at; plain words, one line each. */
  notes: string[];
  /** Why it matters most for this client right now (their meet, recovery, health, adherence…), or null. */
  critical?: string | null;
  /** What in it can't wait, whatever the overall score. */
  concerns?: CategoryConcern[];
  /** Held under UNPROVEN_MAX only because its plan is too new for results: nothing to fix, just time. */
  awaitingResults?: boolean;
};

export type QualityConfidence = "high" | "moderate" | "low" | "insufficient";

/** How closely they follow the plan and whether it's working: beside the score, never in it. */
export type QualityExecution = {
  /** Share of what was planned that they did, recently (logged), or rated (check-ins), with how it was read. */
  adherence: { pct: number; label: string } | null;
  /** Results against the goal (bodyweight trend, strength), or null when there's nothing to read. */
  outcome: { status: "on_track" | "behind" | "off"; label: string } | null;
};

export type QualityVerdictKind = "working" | "watch" | "concern" | "design" | "follow_through" | "practicality" | "results" | "settling" | "insufficient" | "none";

export type QualityVerdict = {
  kind: QualityVerdictKind;
  /** One sentence: what's going on and what to do about it. */
  headline: string;
  /** none: leave it; review: worth a look; act: change something. */
  action: "none" | "review" | "act";
};

/** Something that needs the coach whatever the overall score says. */
export type QualityConcern = {
  key: string;
  /** The category it's in (null: plan-wide, like recovery slipping or adherence). */
  category: string | null;
  label: string;
  text: string;
  severity: ConcernSeverity;
  reason: ConcernReason;
};

export type QualityOpportunity = {
  key: string;
  /** The category it's in. */
  label: string;
  /** What to fix, in one line (a concern's own words when there is one). */
  title: string;
  /** Why it matters (the category's other notes). */
  why: string;
  /** How much it matters for this client: by concern, criticality, evidence, then the size of the gap. */
  impact: "high" | "medium" | "low";
  /** What it's for, in a word or two ("Safety", "Recovery", "Results", "Following it"…). */
  reason: string;
  /** Fine-tuning: worth it only if clearly better (small gaps, or anything on a plan that's working). */
  optional: boolean;
  /** Ranking only (higher first); never shown as points. */
  priority: number;
  /** How far the category is under 90, weighted (it only breaks ties; never the reason to change). */
  gain: number;
};

/** Something one of the client's other plans means for this one (cardio against lifting recovery…). */
export type QualityConnection = { domain: QualityDomain; text: string };

export type QualityScore = {
  /** 0–100, null when there isn't enough to score. */
  score: number | null;
  band: "strong" | "good" | "fair" | "weak" | null;
  confidence: QualityConfidence;
  /** A score read on thin data, or a plan too new for its results: shown, but marked as such. */
  provisional: boolean;
  summary: string;
  categories: QualityCategory[];
  /** What would make the read surer. */
  missing: string[];
  /** The ask "Optimize with Cleo" puts in the box: the ranked fixes, or a review that may say keep it. */
  optimize: string | null;
  execution: QualityExecution;
  verdict: QualityVerdict;
  /** What needs the coach whatever the overall score (most pressing first). */
  concerns: QualityConcern[];
  /** The plan changed recently: results aren't in for it yet. */
  settling: { days: number; window: number } | null;
  /** A recovery trend going the wrong way, in words (plan-wide). */
  recovery: string | null;
  /** What's working well (the strongest categories). */
  strengths: string[];
  /** What would help, most important first (optional fine-tuning last). */
  opportunities: QualityOpportunity[];
  connections: QualityConnection[];
};

/** Below this, a category is listed as something that could help (the general threshold). */
export const OPPORTUNITY_BELOW = 90;
/** Any category this low is a concern, whatever the overall score. */
export const WEAK_SPOT = 55;
/** A category critical for this client this low is a concern. */
export const CRITICAL_LOW = 75;
/** Fewer categories judged than this is "not enough data", never a number. */
export const MIN_JUDGED = 3;
/** Below this share of planned work done, they're struggling to follow it. */
export const FOLLOW_LOW = 70;
/** Below this, adherence is a concern on its own. */
export const FOLLOW_CONCERN = 50;
/**
 * How long a change takes to show in results: a block shows in logged strength in about three
 * weeks; a bodyweight trend needs four (the first week's water left out, weight-management's
 * SETTLE_DAYS), and cardio is read on the same trend.
 */
export const SETTLE_DAYS: Record<QualityDomain, number> = { training: 21, nutrition: 28, cardio: 28 };
/**
 * The most a results-backed category (nutrition's or cardio's goal alignment) can score while its
 * plan is too new for results: a plan reaches top marks there only once its own results back it,
 * so a change never lifts the score on its own say-so.
 */
export const UNPROVEN_MAX = 85;

export const clampScore = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function bandOf(score: number | null): QualityScore["band"] {
  if (score == null) return null;
  if (score >= 85) return "strong";
  if (score >= 70) return "good";
  if (score >= 55) return "fair";
  return "weak";
}

export const BAND_LABEL: Record<NonNullable<QualityScore["band"]>, string> = {
  strong: "Strong",
  good: "Good",
  fair: "Fair",
  weak: "Needs work",
};

export const CONFIDENCE_LABEL: Record<QualityConfidence, string> = {
  high: "High confidence",
  moderate: "Moderate confidence",
  low: "Low confidence: limited data",
  insufficient: "Not enough data",
};

/** The weighted score of the categories that could be judged. */
export function combine(categories: QualityCategory[]): number | null {
  const judged = categories.filter((c) => c.score != null && c.weight > 0);
  if (!judged.length) return null;
  const w = judged.reduce((a, c) => a + c.weight, 0);
  return clampScore(judged.reduce((a, c) => a + c.weight * (c.score as number), 0) / w);
}

export function confidenceFrom(points: number, judged: number, total: number): QualityConfidence {
  if (judged === 0) return "insufficient";
  if (judged < Math.ceil(total / 2)) return "low";
  if (points >= 4) return "high";
  if (points >= 2) return "moderate";
  return "low";
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const noStop = (s: string) => s.replace(/[.\s]+$/, "");
const SEV_RANK: Record<ConcernSeverity, number> = { urgent: 3, significant: 2 };
const REASON_RANK: Record<ConcernReason, number> = { safety: 6, recovery: 5, timeline: 4, results: 3, adherence: 2, weak_spot: 1 };

/** Whole days from one date to another (YYYY-MM-DD or an ISO time), or null. */
export function daysBetween(from: string | null | undefined, to: string): number | null {
  if (!from) return null;
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** The plan is too new for its results (changed `days` ago, inside its domain's window), else null. */
export function settlingOf(domain: QualityDomain, changedOn: string | null | undefined, today: string): QualityScore["settling"] {
  const days = daysBetween(changedOn, today);
  const window = SETTLE_DAYS[domain];
  return days != null && days >= 0 && days < window ? { days, window } : null;
}

/**
 * Recovery slipping, the same rule for all three: lower-body strength down while sleep or energy
 * are flagged, or while the loads the coach set keep running harder than written. A pattern, said
 * as one (never a cause), and a reason to hold off adding anything until it's understood.
 */
export function recoveryTrend(o: { lowerPerformance?: "up" | "steady" | "down" | null; recoveryFlags?: number; harderThanWritten?: boolean }): string | null {
  if (o.lowerPerformance !== "down") return null;
  if ((o.recoveryFlags ?? 0) >= 1) return "Recovery looks to be slipping: lower-body strength is down and sleep or energy were flagged on recent check-ins";
  if (o.harderThanWritten) return "Recovery looks to be slipping: lower-body strength is down and sets at your loads are running harder than written";
  return null;
}

/** "Strong goal alignment. Recovery compatibility is the weak spot: hard cardio the day before heavy squats." */
export function summaryOf(categories: QualityCategory[], score: number | null): string {
  const judged = categories.filter((c) => c.score != null);
  if (score == null || !judged.length) return "Not enough on file to score this plan yet.";
  const sorted = judged.slice().sort((a, b) => (a.score as number) - (b.score as number));
  const worst = sorted[0];
  const best = sorted[sorted.length - 1];
  if ((worst.score as number) >= 85) return `Well suited across the board. Best: ${best.label.toLowerCase()}.`;
  const why = worst.notes[0] ? `: ${noStop(worst.notes[0])}` : "";
  return `${best.label} is strong. ${worst.label} is the weak spot${why}.`;
}

/**
 * What needs the coach whatever the overall score: what each category flagged itself, any
 * category under WEAK_SPOT, a client-critical one under CRITICAL_LOW, recovery slipping, very low
 * adherence, and results going the wrong way while it's followed (never for a plan too new to judge).
 */
export function concernsOf(
  categories: QualityCategory[],
  execution: QualityExecution,
  o: { recovery?: string | null; settling?: QualityScore["settling"] } = {},
): QualityConcern[] {
  const out: QualityConcern[] = [];
  for (const c of categories) {
    const own = (c.concerns ?? []).map((x, i) => ({ key: `${c.key}:${i}`, category: c.key, label: c.label, text: noStop(x.text), severity: x.severity, reason: x.reason }));
    out.push(...own);
    if (own.length || c.score == null) continue;
    const why = c.notes[0] ? `: ${lower(noStop(c.notes[0]))}` : "";
    if (c.score < WEAK_SPOT) out.push({ key: `${c.key}:weak`, category: c.key, label: c.label, text: `${c.label} is a weak spot${why}`, severity: "significant", reason: "weak_spot" });
    else if (c.critical && c.score < CRITICAL_LOW)
      out.push({
        key: `${c.key}:critical`,
        category: c.key,
        label: c.label,
        text: `${c.label} matters most for them right now (${lower(noStop(c.critical))}), and it's weak${why}`,
        severity: "significant",
        reason: "weak_spot",
      });
  }
  if (o.recovery) out.push({ key: "recovery", category: null, label: "Recovery", text: noStop(o.recovery), severity: "significant", reason: "recovery" });
  const adh = execution.adherence?.pct ?? null;
  if (adh != null && adh < FOLLOW_CONCERN)
    out.push({ key: "adherence", category: null, label: "Adherence", text: `Only ${adh}% followed lately (${lower(noStop(execution.adherence!.label))})`, severity: "significant", reason: "adherence" });
  if (!o.settling && execution.outcome?.status === "off" && adh != null && adh >= FOLLOW_LOW)
    out.push({ key: "results", category: null, label: "Results", text: `Followed well (${adh}%), but ${lower(noStop(execution.outcome.label))}`, severity: "significant", reason: "results" });
  const weight = new Map(categories.map((c) => [c.key, c.weight]));
  return out.sort(
    (a, b) =>
      SEV_RANK[b.severity] - SEV_RANK[a.severity] ||
      REASON_RANK[b.reason] - REASON_RANK[a.reason] ||
      (weight.get(b.category ?? "") ?? 0) - (weight.get(a.category ?? "") ?? 0),
  );
}

const REASON_WORD: Record<ConcernReason, string> = { safety: "Safety", recovery: "Recovery", timeline: "Meet prep", results: "Results", adherence: "Following it", weak_spot: "" };
const KEY_REASON: Record<string, string> = {
  goal: "Results",
  calories: "Results",
  dose: "Results",
  progression: "Results",
  fatigue: "Recovery",
  recovery: "Recovery",
  training: "Recovery",
  performance: "Recovery",
  sustain: "Following it",
  duration: "Following it",
  timing: "Following it",
  efficiency: "Following it",
  selection: "Fit for them",
  individual: "Fit for them",
  food: "Fit for them",
  protein: "Nutrition",
  macros: "Nutrition",
  balance: "Nutrition",
  order: "Session flow",
  timeline: "Meet prep",
};
const RESULTS_KEYS = new Set(["goal", "calories", "dose", "progression"]);
const RECOVERY_KEYS = new Set(["fatigue", "recovery", "training", "performance"]);

/** Categories about how hard a plan is to keep: the only ones low adherence can point at. */
export const PRACTICAL = new Set(["sustain", "duration", "timing", "efficiency"]);

/**
 * What would help, most important first: every category under OPPORTUNITY_BELOW with something to
 * say, ranked by a concern in it, whether it's critical for this client, whether their adherence,
 * results or recovery back it up, then the size of the gap. Points only break ties. On a plan to
 * keep (`keep`), anything without a concern is optional fine-tuning.
 */
export function opportunitiesOf(
  categories: QualityCategory[],
  o: { concerns?: QualityConcern[]; execution?: QualityExecution; recovery?: string | null; settling?: QualityScore["settling"]; keep?: boolean } = {},
): QualityOpportunity[] {
  const judged = categories.filter((c) => c.score != null && c.weight > 0);
  const total = judged.reduce((a, c) => a + c.weight, 0);
  if (!total) return [];
  const concerns = o.concerns ?? [];
  const adh = o.execution?.adherence?.pct ?? null;
  const results = !o.settling && o.execution?.outcome != null && o.execution.outcome.status !== "on_track";
  return judged
    .filter((c) => (c.score as number) < OPPORTUNITY_BELOW && c.notes.length && !c.awaitingResults)
    .map((c) => {
      const score = c.score as number;
      const gain = Math.round((c.weight / total) * (OPPORTUNITY_BELOW - score) * 10) / 10;
      const concern = concerns.find((x) => x.category === c.key) ?? null;
      const sev = concern ? SEV_RANK[concern.severity] : 0;
      const evidence = (adh != null && adh < FOLLOW_LOW && PRACTICAL.has(c.key)) || (results && RESULTS_KEYS.has(c.key)) || (!!o.recovery && RECOVERY_KEYS.has(c.key));
      const critical = !!c.critical;
      const impact: QualityOpportunity["impact"] = sev || (critical && score < CRITICAL_LOW) || gain >= 6 ? "high" : critical || evidence || gain >= 2.5 ? "medium" : "low";
      const title = concern && concern.reason !== "weak_spot" ? concern.text : noStop(c.notes[0]);
      const rest = c.notes.map(noStop).filter((n) => n !== title);
      return {
        key: c.key,
        label: c.label,
        title,
        why: rest.join(" · "),
        impact,
        reason: (concern && REASON_WORD[concern.reason]) || KEY_REASON[c.key] || "Fit for them",
        // fine-tuning: anything on a plan to keep, or a small gap in a category that's already decent
        optional: !sev && (!!o.keep || (impact === "low" && score >= 80)),
        // a concern, then what's critical for them, then what their adherence, results or recovery back up; the gap breaks ties
        priority: Math.round((sev * 30 + (critical ? 20 : 0) + (evidence ? 15 : 0) + gain) * 10) / 10,
        gain,
      };
    })
    .sort((a, b) => Number(a.optional) - Number(b.optional) || b.priority - a.priority)
    .slice(0, 6);
}

/** What's working: the strongest categories, in plain words. */
export function strengthsOf(categories: QualityCategory[]): string[] {
  return categories
    .filter((c) => c.score != null && (c.score as number) >= OPPORTUNITY_BELOW && c.notes.length)
    .sort((a, b) => (b.score as number) - (a.score as number))
    .slice(0, 3)
    .map((c) => `${c.label}: ${lower(noStop(c.notes[0]))}`);
}

/**
 * The verdict: what needs the coach first, whatever the overall score. In order: an urgent
 * concern; not enough data; a plan they're not following (a conversation, or practicality when
 * the plan is hard to keep); a significant concern; a weak design; a plan too new to judge (give
 * it time); followed well but not working; worth a look; keep it as is.
 */
export function verdictOf(
  score: number | null,
  categories: QualityCategory[],
  execution: QualityExecution,
  o: { concerns?: QualityConcern[]; settling?: QualityScore["settling"]; confidence?: QualityConfidence; missing?: string[] } = {},
): QualityVerdict {
  const concerns = o.concerns ?? [];
  const more = (n: number) => (n > 0 ? ` ${n === 1 ? "One more thing" : `${n} more things`} to look at.` : "");
  const urgent = concerns.filter((c) => c.severity === "urgent");
  if (urgent.length) {
    const lead = noStop(urgent[0].text);
    const head = score != null && score >= 80 ? `${lead}. The rest of the plan reads well (${score}), but this comes first.` : `${lead}. This comes first.`;
    return { kind: "concern", headline: `${head}${more(concerns.length - 1)}`, action: "act" };
  }
  const judged = categories.filter((c) => c.score != null);
  const missing = (o.missing ?? []).slice(0, 2).map(lower);
  if (score == null || !judged.length)
    return {
      kind: "insufficient",
      headline: missing.length ? `Not enough on file to score this plan yet: ${missing.join(" and ")} would let it read the plan.` : "Not enough on file to score this plan yet.",
      action: "none",
    };
  const worst = judged.slice().sort((a, b) => (a.score as number) - (b.score as number))[0];
  const worstScore = worst.score as number;
  const why = worst.notes[0] ? `: ${lower(noStop(worst.notes[0]))}` : "";
  const designGood = score >= 80 && worstScore >= 70;
  const designWeak = score < 65 || worstScore < 50;
  const adh = execution.adherence?.pct ?? null;
  const poorFollow = adh != null && adh < FOLLOW_LOW;
  const settling = o.settling ?? null;
  const behind = !settling && execution.outcome != null && execution.outcome.status !== "on_track";
  const onTrack = execution.outcome?.status === "on_track";

  if (poorFollow) {
    // low adherence is blamed on the plan only where the plan is hard to keep (sessions, hunger, meals…)
    const practical = judged.filter((c) => PRACTICAL.has(c.key) && (c.score as number) < OPPORTUNITY_BELOW).sort((a, b) => (a.score as number) - (b.score as number))[0];
    if (practical) {
      const pwhy = practical.notes[0] ? `: ${lower(noStop(practical.notes[0]))}` : "";
      return { kind: "practicality", headline: `Only ${adh}% followed, and ${lower(practical.label)} may be why${pwhy}.`, action: "act" };
    }
    if (designGood && !concerns.some((c) => c.key !== "adherence"))
      return { kind: "follow_through", headline: `A sound plan they're struggling to follow (${adh}%). Talk through what's getting in the way before changing it.`, action: "review" };
    return { kind: "follow_through", headline: `Only ${adh}% followed, though the plan looks easy enough to keep: talk through what's getting in the way. Separately, ${lower(worst.label)} could be better${why}.`, action: "review" };
  }
  const significant = concerns.filter((c) => c.key !== "adherence");
  if (significant.length) {
    const top = significant[0];
    const lead = noStop(top.text);
    const head = score >= 85 ? `Strong overall (${score}), but ${lower(lead)}.` : `${lead}.`;
    // recovery slipping on its own is worth a look before anything is added; a flag in the plan needs changing
    const action = significant.some((c) => !(c.reason === "recovery" && c.category == null)) ? "act" : "review";
    return { kind: "concern", headline: `${head}${more(significant.length - 1)}`, action };
  }
  if (designWeak) return { kind: "design", headline: `${worst.label} is the weak spot${why}.`, action: "act" };
  if (settling) {
    const wait = Math.max(1, Math.ceil((settling.window - settling.days) / 7));
    const when = settling.days === 0 ? "today" : settling.days === 1 ? "yesterday" : `${settling.days} days ago`;
    return { kind: "settling", headline: `Changed ${when}: give it about ${wait} more week${wait === 1 ? "" : "s"} to show in their results before changing it again.`, action: "none" };
  }
  if (behind && designGood) {
    if (adh != null) return { kind: "results", headline: `Followed well (${adh}%), but ${lower(noStop(execution.outcome!.label))}. Worth adjusting.`, action: "act" };
    return { kind: "results", headline: `Looks well designed, but ${lower(noStop(execution.outcome!.label))}. Check how closely it's followed.`, action: "review" };
  }
  if (!designGood) return { kind: "watch", headline: `${score >= 85 ? "Strong" : "Good"} overall. ${worst.label} could be better${why}.`, action: "review" };
  if (o.confidence === "low")
    return { kind: "working", headline: `Looks sound on what's on file. Keep it as is${missing.length ? `; ${missing.join(" and ")} would make this read surer` : ""}.`, action: "none" };
  const parts = ["well designed"];
  if (adh != null) parts.push(`followed (${adh}%)`);
  if (onTrack) parts.push("results are on track");
  return { kind: "working", headline: `Keep it as is: ${parts.length > 2 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts.join(" and ")}.`, action: "none" };
}

const KEEP_LINE =
  "Fix what matters for this client's results, recovery and ability to follow it, most important first. Don't change anything just to tidy the plan, and if keeping something as it is serves them better, say so and leave it.";
const HOW_LINE = "For each change say what it is now, what you'd change it to, why, and the effect you expect.";

/** Context every ask carries: how it's going, a recent change, recovery, their other plans. */
function contextLines(q: Pick<QualityScore, "execution" | "connections" | "settling" | "recovery">): string {
  const out: string[] = [];
  if (q.execution.adherence) out.push(`They've followed ${q.execution.adherence.pct}% of it lately; if a change is about making it easier to follow, say so.`);
  if (q.settling) out.push(`It changed ${q.settling.days === 0 ? "today" : `${q.settling.days} days ago`}, so its results aren't in yet: don't undo a recent change before it's had time to work.`);
  if (q.recovery) out.push(`${noStop(q.recovery)}: hold off adding anything until that's understood.`);
  if (q.connections.length) out.push(`Across their plans: ${q.connections.slice(0, 2).map((c) => noStop(c.text)).join("; ")}.`);
  return out.length ? `\n${out.join("\n")}` : "";
}

/** The start of every review ask (a review may well answer "keep it"), so a screen can tell one from a change. */
export const REVIEW_ASK_START = "Review the ";
export const isReviewAsk = (text: string | null | undefined) => !!text && text.startsWith(REVIEW_ASK_START);

/** Optimize when nothing stands out: a review whose best answer may be to keep the plan as it is. */
export function reviewAskFrom(what: string, q: Pick<QualityScore, "verdict" | "strengths" | "execution" | "connections" | "settling" | "recovery">): string {
  const keep = q.strengths.length ? `\nWhat's working: ${q.strengths.slice(0, 3).map(lower).join("; ")}.` : "";
  const out = `${REVIEW_ASK_START}${what} for this client. It reads: ${noStop(q.verdict.headline)}.${keep}${contextLines(q)}\nIs anything worth changing for their results, recovery or ability to follow it? Keeping it as it is is a good answer when it's working: say so, and why. ${HOW_LINE}`;
  return out.length > 1900 ? `${out.slice(0, 1898)}…` : out;
}

/** The ask "Optimize with Cleo" sends: what matters most, in order, the optional fine-tuning apart, what to keep. */
export function optimizeAskFrom(
  what: string,
  q: Pick<QualityScore, "opportunities" | "strengths" | "execution" | "connections"> & Partial<Pick<QualityScore, "concerns" | "settling" | "recovery">>,
): string | null {
  const concerns = (q.concerns ?? []).filter((c) => !q.opportunities.some((o) => o.key === c.category));
  const main = q.opportunities.filter((o) => !o.optional);
  const optional = q.opportunities.filter((o) => o.optional);
  if (!main.length && !optional.length && !concerns.length) return null;
  const lines = [
    ...concerns.map((c) => `${c.text} (${(REASON_WORD[c.reason] || c.label).toLowerCase()}, needs looking at)`),
    ...main.map((o) => `${o.title} (${o.reason.toLowerCase()}, ${o.impact} priority)${o.why ? `: ${o.why}` : ""}`),
  ].slice(0, 5);
  const list = lines.length ? ` What matters most for them, in order:\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}` : "";
  const opt = optional.length ? `\nOptional, only if clearly worth it for them: ${optional.slice(0, 3).map((o) => lower(o.title)).join("; ")}.` : "";
  const keep = q.strengths.length ? `\nKeep what's working: ${q.strengths.slice(0, 2).map(lower).join("; ")}.` : "";
  const out = `Optimize the ${what}.${list}${opt}${keep}${contextLines({ execution: q.execution, connections: q.connections, settling: q.settling ?? null, recovery: q.recovery ?? null })}\n${KEEP_LINE} ${HOW_LINE}`;
  return out.length > 1900 ? `${out.slice(0, 1898)}…` : out;
}

/**
 * Every domain's score is finished here, so all three read the same way. `none` is a plan with
 * nothing in it to judge (no cardio): no number, just whether that's right for them (and an ask
 * when it's worth asking Cleo about).
 */
export function finishQuality(
  categories: QualityCategory[],
  o: {
    what: string;
    /** How many of the domain's key data points are on file (confidence). */
    points: number;
    missing: string[];
    execution?: QualityExecution;
    connections?: QualityConnection[];
    /** Recovery slipping (recoveryTrend), plan-wide. */
    recovery?: string | null;
    /** The plan changed recently (settlingOf). */
    settling?: QualityScore["settling"];
    none?: { headline: string; action: QualityVerdict["action"]; ask?: string | null } | null;
  },
): QualityScore {
  const connections = o.connections ?? [];
  const recovery = o.recovery ?? null;
  const settling = o.settling ?? null;
  const ex = o.execution ?? { adherence: null, outcome: null };
  // results read across a recent change are mostly the old plan's: said so beside the score
  const execution: QualityExecution = settling && ex.outcome ? { ...ex, outcome: { ...ex.outcome, label: `${noStop(ex.outcome.label)} (mostly before the change)` } } : ex;
  if (o.none) {
    return {
      score: null,
      band: null,
      confidence: confidenceFrom(o.points, 1, 2),
      provisional: false,
      summary: o.none.headline,
      categories: [],
      missing: o.missing,
      optimize: o.none.ask ?? null,
      execution,
      verdict: { kind: "none", headline: o.none.headline, action: o.none.action },
      concerns: recovery ? concernsOf([], execution, { recovery, settling }) : [],
      settling,
      recovery,
      strengths: [],
      opportunities: [],
      connections,
    };
  }
  const judged = categories.filter((c) => c.score != null).length;
  // two categories can't stand for a plan: no number until there's enough to read
  const score = judged >= Math.min(MIN_JUDGED, categories.length) ? combine(categories) : null;
  let confidence: QualityConfidence = score == null ? "insufficient" : confidenceFrom(o.points, judged, categories.length);
  // a plan too new for its results is never read with full confidence
  if (settling && confidence === "high") confidence = "moderate";
  // concerns are read whatever the score, so a thin read never hides an allergen or a safety flag
  const concerns = concernsOf(categories, execution, { recovery, settling });
  const strengths = strengthsOf(categories);
  let verdict = verdictOf(score, categories, execution, { concerns, settling, confidence, missing: o.missing });
  // keep it on its own terms, but one of their other plans pulls against it: worth a look, said
  if (verdict.kind === "working" && connections.length) {
    const lead = verdict.headline.startsWith("Keep it as is: ") ? verdict.headline.slice("Keep it as is: ".length) : verdict.headline.split(". ")[0];
    verdict = { kind: "watch", headline: `${noStop(lead.charAt(0).toUpperCase() + lead.slice(1))}. Across their plans: ${lower(noStop(connections[0].text))}.`, action: "review" };
  }
  const keep = verdict.kind === "working" || verdict.kind === "settling";
  const opportunities = score == null ? [] : opportunitiesOf(categories, { concerns, execution, recovery, settling, keep });
  const q: QualityScore = {
    score,
    band: bandOf(score),
    confidence,
    provisional: score != null && (confidence === "low" || !!settling),
    summary: verdict.headline,
    categories,
    missing: o.missing,
    optimize: null,
    execution,
    verdict,
    concerns,
    settling,
    recovery,
    strengths,
    opportunities,
    connections,
  };
  // Optimize is always there: the ranked fixes when something matters, else a review that may say keep it
  const ranked = keep ? null : optimizeAskFrom(o.what, q);
  q.optimize = ranked ?? reviewAskFrom(o.what, q);
  return q;
}

/** "62%" from done / planned, or null with too little to read. */
export function adherencePct(done: number, planned: number, min = 4): number | null {
  if (!(planned >= min)) return null;
  return Math.max(0, Math.min(100, Math.round((done / planned) * 100)));
}
