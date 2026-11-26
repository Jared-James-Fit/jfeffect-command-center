/**
 * After the meet (pure, tested in competition-handling.test.ts): what they
 * lifted against their targets and the gameplan, a short recap in the coach's
 * words to edit, and the next step offered. Everything comes from the results
 * and the plan; nothing is made up, and nothing enrolls anyone: the follow-up
 * is an offer the coach sends if he wants.
 */
import type { AthleteInfo } from "./athlete-info";
import type { MeetResults } from "./debrief";
import type { GameplanDoc } from "./gameplan";
import type { Lift } from "./types";

const LIFTS: Lift[] = ["squat", "bench", "deadlift"];
const KEY: Record<Lift, "s" | "b" | "d"> = { squat: "s", bench: "b", deadlift: "d" };
const WORD: Record<Lift, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };

export type RecapLine = {
  lift: Lift;
  best: number | null;
  target: number | null;
  plannedThird: number | null;
  made: number | null;
  taken: number | null;
  vsTarget: number | null;
};

export type HandlingRecap = {
  lines: RecapLine[];
  total: number | null;
  targetTotal: number | null;
  madeAll: number;
  takenAll: number;
  highlights: string[];
  /** a short message for the coach to edit and send */
  message: string;
  /** what to offer next, never applied by itself */
  offers: Array<"coaching" | "membership" | "handling">;
};

const r1 = (x: number) => Math.round(x * 10) / 10;

export function buildRecap(input: {
  first: string;
  meetName: string;
  results: MeetResults;
  info: AthleteInfo;
  plan: GameplanDoc | null;
  account: { tier: "coaching" | "self_serve"; hasLogin: boolean };
}): HandlingRecap {
  const { results, info, plan } = input;
  const lines: RecapLine[] = LIFTS.map((lift) => {
    const t = results.attempts?.[KEY[lift]] ?? null;
    const made = t ? t.filter((x) => x != null && x > 0).length : null;
    const taken = t ? t.filter((x) => x != null && x !== 0).length : null;
    const best = results[lift];
    const target = info.targets?.[lift] ?? null;
    return {
      lift,
      best,
      target,
      plannedThird: plan?.attempts[lift]?.third ?? null,
      made,
      taken,
      vsTarget: best != null && target != null ? r1(best - target) : null,
    };
  });
  const madeAll = lines.reduce((s, l) => s + (l.made ?? 0), 0);
  const takenAll = lines.reduce((s, l) => s + (l.taken ?? 0), 0);
  const targetTotal = lines.every((l) => l.target != null) ? lines.reduce((s, l) => s + (l.target ?? 0), 0) : null;
  const total = results.total;
  const highlights: string[] = [];
  for (const l of lines) {
    if (l.vsTarget != null && l.vsTarget >= 0) highlights.push(`${WORD[l.lift]} ${l.best} kg: on or over the ${l.target} kg target`);
    else if (l.vsTarget != null) highlights.push(`${WORD[l.lift]} ${l.best} kg, ${Math.abs(l.vsTarget)} kg short of the ${l.target} kg target`);
    else if (l.best != null) highlights.push(`${WORD[l.lift]} ${l.best} kg`);
  }
  if (takenAll) highlights.push(`${madeAll} of ${takenAll} attempts made`);
  if (total != null && targetTotal != null)
    highlights.push(total >= targetTotal ? `${total} kg total, at or over the ${targetTotal} kg target` : `${total} kg total against a ${targetTotal} kg target`);
  if (results.place) highlights.push(`Placed ${results.place}`);

  const bits: string[] = [];
  if (total != null) bits.push(`${total} kg total`);
  if (takenAll) bits.push(`${madeAll} for ${takenAll}`);
  const message = [
    `${input.first}, great work at ${input.meetName}.${bits.length ? ` ${bits.join(", ")}.` : ""}`,
    lines
      .filter((l) => l.best != null)
      .map((l) => `${WORD[l.lift]} ${l.best}`)
      .join(" · "),
    "Proud of how you handled the day. Rest up this week, and when you're ready let's talk about what's next.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const offers: HandlingRecap["offers"] = [];
  if (input.account.tier !== "coaching") offers.push("coaching");
  if (input.account.tier === "self_serve" && !input.account.hasLogin) offers.push("membership");
  offers.push("handling");
  return { lines, total, targetTotal, madeAll, takenAll, highlights, message, offers };
}
