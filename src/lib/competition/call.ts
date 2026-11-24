/**
 * Whether a strategy call is worth the athlete's and the coach's time at this
 * milestone (pure, tested). Most milestones need nothing more than the written
 * assessment: a call is recommended only when the reasons add up (a national
 * or international meet, a first meet, qualification or placing on the line
 * with a close field, a decision about the weight class, a projection that
 * moved, a concern, the athlete expecting much more than the evidence
 * supports), and never when the same strategy was just discussed or a call is
 * already booked. Whether it's included in their package is said plainly:
 * nothing promises a free call the package doesn't include, and nothing is
 * booked or charged without the coach.
 */
import type { MilestoneKind, Objective } from "./types";

export type CallInput = {
  milestone: MilestoneKind;
  level: "international" | "national" | "regional" | "provincial" | "local" | null;
  firstMeet: boolean;
  objective: Objective | null;
  /** a competitor's range overlaps ours and placing matters */
  closeField: boolean;
  qualificationOnLine: boolean;
  weightClassUndecided: boolean;
  /** expected total moved since the last assessment, as a share */
  projectionShift: number | null;
  /** concerns at "concern" or "serious" */
  concerns: number;
  /** athlete's stated goal total over the expected, as a share (0.06 = 6% more) */
  expectationGap: number | null;
  /** the attempt strategy has competition-driven branches */
  complexAttempts: boolean;
  /** days since the last call with them (a booked call that happened), null when none */
  lastCallDaysAgo: number | null;
  /** a call already booked between now and the meet */
  upcomingCallOn: string | null;
  /** their package's included calls left this period (null: no calls in their package) */
  includedCallsLeft: number | null;
  packageName: string | null;
};

export type CallRecommendation = {
  recommend: boolean;
  minutes: 15 | 30 | 45 | null;
  reasons: string[];
  /** why not, when the reasons didn't add up or a call is already covered */
  skipReason: string | null;
  coverage: { kind: "included" | "not_included" | "unknown"; text: string };
  score: number;
};

/** How much each milestone leans toward a call (game plans are where calls pay off). */
const BASE: Record<MilestoneKind, number> = {
  recon: 0,
  foundation: 1,
  intel: 0,
  forecast: 0,
  game_plan: 1,
  confirm: 0,
  update: 0,
  debrief: 0,
};

export function recommendCall(x: CallInput): CallRecommendation {
  const reasons: string[] = [];
  let score = BASE[x.milestone] ?? 0;
  if (x.level === "international") {
    score += 2;
    reasons.push("International meet");
  } else if (x.level === "national") {
    score += 1.5;
    reasons.push("National meet");
  }
  if (
    x.firstMeet &&
    (x.milestone === "game_plan" || x.milestone === "confirm" || x.milestone === "foundation")
  ) {
    score += 1.5;
    reasons.push("First meet: walking them through the day removes most of the nerves");
  }
  if (x.qualificationOnLine) {
    score += 1;
    reasons.push("A qualifying total is on the line");
  }
  if (x.closeField && (x.objective === "win" || x.objective === "podium")) {
    score += 1.5;
    reasons.push("Placing is close: the attempt strategy has real decisions in it");
  }
  if (x.weightClassUndecided) {
    score += 2;
    reasons.push("The weight class isn't settled");
  }
  if (x.projectionShift != null && Math.abs(x.projectionShift) >= 0.03) {
    score += 1.5;
    reasons.push(
      `The projected total moved ${Math.round(x.projectionShift * 1000) / 10}% since the last assessment`,
    );
  }
  if (x.concerns > 0) {
    score += Math.min(2, x.concerns);
    reasons.push(
      `${x.concerns} concern${x.concerns === 1 ? "" : "s"} on file (recovery, pain or bodyweight)`,
    );
  }
  if (x.expectationGap != null && x.expectationGap >= 0.05) {
    score += 1.5;
    reasons.push(
      `Their goal is ${Math.round(x.expectationGap * 100)}% over what the evidence supports: worth a conversation, not a message`,
    );
  }
  if (x.complexAttempts && (x.milestone === "game_plan" || x.milestone === "confirm")) {
    score += 1;
    reasons.push("The attempts branch on what competitors do");
  }

  const coverage: CallRecommendation["coverage"] =
    x.includedCallsLeft == null
      ? {
          kind: "not_included",
          text: x.packageName
            ? `${x.packageName} doesn't include calls: it would be a General Call`
            : "Calls aren't part of their package: it would be a General Call",
        }
      : x.includedCallsLeft > 0
        ? {
            kind: "included",
            text: `${x.includedCallsLeft} included call${x.includedCallsLeft === 1 ? "" : "s"} left this billing period`,
          }
        : {
            kind: "not_included",
            text: "Their included calls for this period are used: it would be a General Call",
          };

  let skipReason: string | null = null;
  if (x.upcomingCallOn) skipReason = `A call is already booked (${x.upcomingCallOn}): use it`;
  else if (
    x.lastCallDaysAgo != null &&
    x.lastCallDaysAgo <= 10 &&
    Math.abs(x.projectionShift ?? 0) < 0.03
  )
    skipReason = `You spoke ${x.lastCallDaysAgo} days ago and nothing big changed`;
  const recommend = !skipReason && score >= 3;
  if (!recommend && !skipReason)
    skipReason = reasons.length
      ? "Not enough to justify a call: the written assessment covers it"
      : "Routine milestone: the written assessment covers it";
  const minutes = !recommend ? null : score >= 6 ? 45 : score >= 4.5 ? 30 : 15;
  return { recommend, minutes, reasons, skipReason, coverage, score: Math.round(score * 10) / 10 };
}
