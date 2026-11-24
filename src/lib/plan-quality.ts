/**
 * Plan quality for training, nutrition and cardio (Nov 23 2026; one model for
 * all three Nov 24 2026): a design score out of 100 by category, worked out by
 * code from the plan and what's on file (program-quality.ts,
 * nutrition-targets/plan-quality.ts, cardio/quality.ts), kept apart from how
 * the client is following it.
 *
 *   Design      how well the prescription suits this person and their goal,
 *               never how aggressive or elaborate it is. A category with
 *               nothing to judge is left out (never guessed); a plan with too
 *               little to go on reads "not enough data" instead of a number.
 *   Execution   adherence (planned → done) and results (bodyweight, strength)
 *               shown beside the score, never mixed into it. They only shape
 *               the design score where they're evidence about the design:
 *               low adherence corroborating a practicality problem the plan
 *               already shows, or results behind while it's followed well.
 *   Verdict     one line: working / a design problem / a sound plan they're
 *               struggling to follow / practicality / followed but not working,
 *               and whether the coach needs to act.
 *
 * Plus what's working (strengths), what would help most (opportunities, ranked
 * by how much each would lift the score), and notes from the client's other
 * plans (connections), so training, nutrition and cardio are read together.
 * It is a coaching check, not a validated or clinical measure; the coach can
 * always publish their own plan over it.
 */
export type QualityDomain = "training" | "nutrition" | "cardio";

export type QualityCategory = {
  key: string;
  label: string;
  /** 0–100, or null when there's nothing to judge it on. */
  score: number | null;
  weight: number;
  /** What lowered it, or what it's good at; plain words, one line each. */
  notes: string[];
};

export type QualityConfidence = "high" | "moderate" | "low" | "insufficient";

/** How closely they follow the plan and whether it's working: beside the score, never in it. */
export type QualityExecution = {
  /** Share of what was planned that they did, recently (logged), or rated (check-ins), with how it was read. */
  adherence: { pct: number; label: string } | null;
  /** Results against the goal (bodyweight trend, strength), or null when there's nothing to read. */
  outcome: { status: "on_track" | "behind" | "off"; label: string } | null;
};

export type QualityVerdictKind = "working" | "watch" | "design" | "follow_through" | "practicality" | "results" | "insufficient" | "none";

export type QualityVerdict = {
  kind: QualityVerdictKind;
  /** One sentence: what's going on and what to do about it. */
  headline: string;
  /** none: leave it; review: worth a look; act: change something. */
  action: "none" | "review" | "act";
};

export type QualityOpportunity = {
  key: string;
  /** The category it's in. */
  label: string;
  /** What to fix, in one line. */
  title: string;
  /** Why it matters (the category's other notes). */
  why: string;
  impact: "high" | "medium" | "low";
  /** About how many points the score would gain if this category were fixed. */
  gain: number;
};

/** Something one of the client's other plans means for this one (cardio against lifting recovery…). */
export type QualityConnection = { domain: QualityDomain; text: string };

export type QualityScore = {
  /** 0–100, null when there isn't enough to score. */
  score: number | null;
  band: "strong" | "good" | "fair" | "weak" | null;
  confidence: QualityConfidence;
  summary: string;
  categories: QualityCategory[];
  /** What would make the read surer. */
  missing: string[];
  /** The ask "Optimize with Cleo" puts in the box (null when nothing's worth changing). */
  optimize: string | null;
  execution: QualityExecution;
  verdict: QualityVerdict;
  /** What's working well (the strongest categories). */
  strengths: string[];
  /** What would help most, the biggest gain first. */
  opportunities: QualityOpportunity[];
  connections: QualityConnection[];
};

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

/** The categories that would lift the score most if fixed, biggest gain first. */
export function opportunitiesOf(categories: QualityCategory[]): QualityOpportunity[] {
  const judged = categories.filter((c) => c.score != null && c.weight > 0);
  const total = judged.reduce((a, c) => a + c.weight, 0);
  if (!total) return [];
  return judged
    .filter((c) => (c.score as number) < 90 && c.notes.length)
    .map((c) => {
      const gain = Math.round(((c.weight / total) * (100 - (c.score as number))) * 10) / 10;
      return {
        key: c.key,
        label: c.label,
        title: noStop(c.notes[0]),
        why: c.notes.slice(1).map(noStop).join(" · "),
        impact: (gain >= 5 ? "high" : gain >= 2 ? "medium" : "low") as QualityOpportunity["impact"],
        gain,
      };
    })
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 5);
}

/** What's working: the strongest categories, in plain words. */
export function strengthsOf(categories: QualityCategory[]): string[] {
  return categories
    .filter((c) => c.score != null && (c.score as number) >= 90 && c.notes.length)
    .sort((a, b) => (b.score as number) - (a.score as number))
    .slice(0, 3)
    .map((c) => `${c.label}: ${lower(noStop(c.notes[0]))}`);
}

/** Categories about how hard a plan is to keep: the only ones low adherence can point at. */
export const PRACTICAL = new Set(["sustain", "duration", "timing", "efficiency"]);

/** Below this share of planned work done, they're struggling to follow it. */
export const FOLLOW_LOW = 70;

/**
 * The verdict: design read against how it's being followed. A sound plan they
 * aren't following is a conversation, not a rewrite; low adherence on a plan
 * that's hard to keep is practicality; a plan followed well that isn't working
 * needs changing even when it looks right on paper.
 */
export function verdictOf(score: number | null, categories: QualityCategory[], execution: QualityExecution): QualityVerdict {
  const judged = categories.filter((c) => c.score != null);
  if (score == null || !judged.length) return { kind: "insufficient", headline: "Not enough on file to score this plan yet.", action: "none" };
  const worst = judged.slice().sort((a, b) => (a.score as number) - (b.score as number))[0];
  const worstScore = worst.score as number;
  const why = worst.notes[0] ? `: ${lower(noStop(worst.notes[0]))}` : "";
  const designGood = score >= 80 && worstScore >= 70;
  const designWeak = score < 65 || worstScore < 50;
  const adh = execution.adherence?.pct ?? null;
  const poorFollow = adh != null && adh < FOLLOW_LOW;
  const behind = execution.outcome != null && execution.outcome.status !== "on_track";
  const onTrack = execution.outcome?.status === "on_track";

  if (poorFollow) {
    // low adherence is blamed on the plan only where the plan is hard to keep (sessions, hunger, meals…)
    const practical = judged.filter((c) => PRACTICAL.has(c.key) && (c.score as number) < 90).sort((a, b) => (a.score as number) - (b.score as number))[0];
    if (practical) {
      const pwhy = practical.notes[0] ? `: ${lower(noStop(practical.notes[0]))}` : "";
      return { kind: "practicality", headline: `Only ${adh}% followed, and ${lower(practical.label)} may be why${pwhy}.`, action: "act" };
    }
    if (designGood) return { kind: "follow_through", headline: `A sound plan they're struggling to follow (${adh}%). Talk through what's getting in the way before changing it.`, action: "review" };
    return { kind: "follow_through", headline: `Only ${adh}% followed, though the plan looks easy enough to keep: talk through what's getting in the way. Separately, ${lower(worst.label)} could be better${why}.`, action: "review" };
  }
  if (behind && designGood) {
    if (adh != null) return { kind: "results", headline: `Followed well (${adh}%), but ${lower(noStop(execution.outcome!.label))}. Worth adjusting.`, action: "act" };
    return { kind: "results", headline: `Looks well designed, but ${lower(noStop(execution.outcome!.label))}. Check how closely it's followed.`, action: "review" };
  }
  if (designWeak) return { kind: "design", headline: `${worst.label} is the weak spot${why}.`, action: "act" };
  if (!designGood) return { kind: "watch", headline: `${score >= 85 ? "Strong" : "Good"} overall. ${worst.label} could be better${why}.`, action: "review" };
  const parts = ["Well designed"];
  if (adh != null) parts.push(`followed (${adh}%)`);
  if (onTrack) parts.push("results are on track");
  return { kind: "working", headline: `${parts.length > 2 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts.join(" and ")}. Nothing needs changing.`, action: "none" };
}

/** The ask "Optimize with Cleo" sends: what would help most, in order, with why, and what to keep. */
export function optimizeAskFrom(what: string, q: Pick<QualityScore, "opportunities" | "strengths" | "execution" | "connections">): string | null {
  if (!q.opportunities.length) return null;
  const lines = q.opportunities.slice(0, 4).map((o, i) => `${i + 1}. ${o.title} (${o.label.toLowerCase()}, ${o.impact} impact)${o.why ? `: ${o.why}` : ""}`);
  const keep = q.strengths.length ? `\nKeep what's working: ${q.strengths.slice(0, 2).map((s) => lower(s)).join("; ")}.` : "";
  const exec = q.execution.adherence
    ? `\nThey've followed ${q.execution.adherence.pct}% of it lately; if a change is about making it easier to follow, say so.`
    : "";
  const links = q.connections.length ? `\nAcross their plans: ${q.connections.slice(0, 2).map((c) => noStop(c.text)).join("; ")}.` : "";
  const out = `Optimize the ${what}. In order of expected impact:\n${lines.join("\n")}${keep}${exec}${links}\nFor each change say what it is now, what you'd change it to, why, and how much it should help. Propose only what fixes these; change nothing else.`;
  return out.length > 1900 ? `${out.slice(0, 1898)}…` : out;
}

/** The older one-line ask (kept for callers that still want it). */
export function optimizeAsk(categories: QualityCategory[], what: string): string | null {
  const weak = categories.filter((c) => c.score != null && (c.score as number) < 80 && c.notes.length);
  if (!weak.length) return null;
  const items = weak
    .sort((a, b) => (a.score as number) - (b.score as number))
    .slice(0, 3)
    .map((c) => `${c.label.toLowerCase()} (${noStop(c.notes[0])})`);
  return `Optimize the ${what}: improve ${items.join("; ")}. Keep everything that's already working, and explain each change.`;
}

/**
 * Every domain's score is finished here, so all three read the same way. `none`
 * is a plan with nothing in it to judge (no cardio): no number, just whether
 * that's right for them.
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
    none?: { headline: string; action: QualityVerdict["action"] } | null;
  },
): QualityScore {
  const execution = o.execution ?? { adherence: null, outcome: null };
  const connections = o.connections ?? [];
  if (o.none) {
    return {
      score: null,
      band: null,
      confidence: confidenceFrom(o.points, 1, 2),
      summary: o.none.headline,
      categories: [],
      missing: o.missing,
      optimize: null,
      execution,
      verdict: { kind: "none", headline: o.none.headline, action: o.none.action },
      strengths: [],
      opportunities: [],
      connections,
    };
  }
  const judged = categories.filter((c) => c.score != null).length;
  const score = judged ? combine(categories) : null;
  const strengths = strengthsOf(categories);
  const opportunities = score == null ? [] : opportunitiesOf(categories);
  let verdict = verdictOf(score, categories, execution);
  // working on its own terms, but one of their other plans pulls against it: worth a look, said
  if (verdict.kind === "working" && connections.length)
    verdict = { kind: "watch", headline: `${verdict.headline.replace(/ Nothing needs changing\.$/, "")} Across their plans: ${lower(noStop(connections[0].text))}.`, action: "review" };
  const q: QualityScore = {
    score,
    band: bandOf(score),
    confidence: confidenceFrom(o.points, judged, categories.length),
    summary: verdict.kind === "insufficient" ? "Not enough on file to score this plan yet." : verdict.headline,
    categories,
    missing: o.missing,
    optimize: null,
    execution,
    verdict,
    strengths,
    opportunities,
    connections,
  };
  q.optimize = optimizeAskFrom(o.what, q);
  return q;
}

/** "62%" from done / planned, or null with too little to read. */
export function adherencePct(done: number, planned: number, min = 4): number | null {
  if (!(planned >= min)) return null;
  return Math.max(0, Math.min(100, Math.round((done / planned) * 100)));
}
