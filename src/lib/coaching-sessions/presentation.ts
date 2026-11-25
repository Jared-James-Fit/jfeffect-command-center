/**
 * What the athlete sees when the coach shares the screen, and the game plan
 * the coach may send after (pure, tested in coaching-sessions.test.ts).
 *
 * The athlete's screen shows only what's theirs to see: their own records
 * (workouts, weigh-ins, the countdown) and their own words. Never the coach's
 * private notes or priorities (source "coach"), never the app's reads
 * (source "read": interpretations, Competition Intelligence's field research
 * and projections), never an earlier call's private follow-ups (source
 * "history" is the coach's working list). Each section keeps its minutes so
 * the athlete sees how much of the call is theirs.
 */
import type { Agenda, PrepItem, SectionKey } from "./prepare";

export type AthleteSection = { key: SectionKey; title: string; minutes: number; points: string[] };

const SHAREABLE: ReadonlySet<PrepItem["source"]> = new Set(["record", "athlete"]);

/** Athlete-facing titles: spoken to them. */
const ATHLETE_TITLES: Record<SectionKey, string> = {
  going_well: "What's going well",
  improve: "Where we can improve",
  athletes_corner: "Your corner",
  game_plan: "Our game plan",
  alignment: "Next steps",
};

/** The prompts that open each section on the shared screen (never private). */
export const SECTION_PROMPTS: Record<SectionKey, string> = {
  going_well: "The wins we've earned since we last spoke.",
  improve: "One or two things that will move you forward most.",
  athletes_corner: "Your thoughts, questions and anything you want from me.",
  game_plan: "What's coming up and what we're deciding together.",
  alignment: "Who does what, by when.",
};

export function athleteView(agenda: Agenda | null | undefined): AthleteSection[] {
  if (!agenda) return [];
  return agenda.sections.map((s) => ({
    key: s.key,
    title: ATHLETE_TITLES[s.key],
    minutes: s.minutes,
    points: s.items.filter((i) => SHAREABLE.has(i.source)).map((i) => i.text).slice(0, 5),
  }));
}

export type GamePlan = {
  goingWell: string[];
  improving: string[];
  agreed: string[];
  athleteDoes: string[];
  coachDoes: string[];
  next: string | null;
};

export const EMPTY_GAME_PLAN: GamePlan = { goingWell: [], improving: [], agreed: [], athleteDoes: [], coachDoes: [], next: null };

/** The game plan as the athlete reads it in their chat, only the parts the coach kept. */
export function gamePlanMessage(firstName: string | null, plan: GamePlan): string {
  const lines: string[] = [];
  lines.push(`${firstName ? `${firstName}, here's` : "Here's"} our game plan from today.`);
  const block = (title: string, items: string[]) => {
    const kept = items.map((i) => i.trim()).filter(Boolean);
    if (!kept.length) return;
    lines.push("", title);
    for (const i of kept) lines.push(`• ${i}`);
  };
  block("What's going well", plan.goingWell);
  block("What we're improving", plan.improving);
  block("What we agreed", plan.agreed);
  block("Your part", plan.athleteDoes);
  block("My part", plan.coachDoes);
  if (plan.next?.trim()) lines.push("", `Next: ${plan.next.trim()}`);
  return lines.join("\n");
}

/** A first draft of the game plan from the shareable prep and what was decided in the call. */
export function draftGamePlan(
  agenda: Agenda | null | undefined,
  decisions: string[],
  commitments: Array<{ owner: "coach" | "athlete"; text: string; status: string }>,
): GamePlan {
  const view = athleteView(agenda);
  const of = (k: SectionKey) => view.find((s) => s.key === k)?.points ?? [];
  const open = commitments.filter((c) => c.status === "open");
  return {
    goingWell: of("going_well").slice(0, 3),
    improving: of("improve").slice(0, 2),
    agreed: decisions.slice(0, 6),
    athleteDoes: open.filter((c) => c.owner === "athlete").map((c) => c.text),
    coachDoes: open.filter((c) => c.owner === "coach").map((c) => c.text),
    next: null,
  };
}
