/**
 * What the athlete sees when the coach shares the screen, and the recap the
 * coach may send after (pure, tested in coaching-sessions.test.ts).
 *
 * The shared screen shows only what the coach lets it: a talking point is on
 * it when it's `share` (their own records and words, and the coach's
 * direction, by default; the coach turns any point on or off) and not skipped.
 * Never the coach's private notes or priorities, never an interpretation
 * (a weight read, a competition projection), never anything still to be
 * clarified, never an earlier meeting's private follow-ups. A stage with
 * nothing to show is left out, so there are never empty slides.
 */
import { normalizeAgenda, type Agenda, type SectionKey } from "./prepare";

export type AthleteSection = { key: SectionKey; title: string; minutes: number; points: string[] };

/** Athlete-facing titles: spoken to them. */
const ATHLETE_TITLES: Record<SectionKey, string> = {
  connect: "Catching up",
  recognize: "What's going well",
  evaluate: "What I'm seeing",
  coach: "My recommendations",
  execute: "Your plan",
  align: "Where we're headed",
};

/** The line that opens each slide on the shared screen (never private). */
export const SECTION_PROMPTS: Record<SectionKey, string> = {
  connect: "How things are going.",
  recognize: "What you've earned since we last spoke.",
  evaluate: "What the numbers and your training are telling me.",
  coach: "What I recommend, and why.",
  execute: "What you're doing, what I'm doing, and by when.",
  align: "The next objective.",
};

/**
 * The shared screen's slides: one per stage the coach's script has (a stage
 * with something not skipped), in the same order, so the two windows stay in
 * step by index; each shows only its shared points (a stage whose points are
 * all private shows its title and prompt).
 */
export function athleteView(raw: Agenda | null | undefined | unknown): AthleteSection[] {
  const agenda = normalizeAgenda(raw);
  if (!agenda) return [];
  return agenda.sections
    .filter((s) => s.items.some((i) => i.status !== "skipped"))
    .map((s) => ({
      key: s.key,
      title: ATHLETE_TITLES[s.key],
      minutes: s.minutes,
      points: s.items.filter((i) => i.share && i.status !== "skipped").map((i) => i.text).slice(0, 5),
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

/** The recap as the athlete reads it in their chat, only the parts the coach kept. */
export function gamePlanMessage(firstName: string | null, plan: GamePlan): string {
  const lines: string[] = [];
  lines.push(`${firstName ? `${firstName}, here's` : "Here's"} the recap from today.`);
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

/** A first draft of the recap from the shared plan and what was decided in the meeting. */
export function draftGamePlan(
  raw: Agenda | null | undefined | unknown,
  decisions: string[],
  commitments: Array<{ owner: "coach" | "athlete"; text: string; status: string; confirmed?: boolean }>,
): GamePlan {
  const agenda = normalizeAgenda(raw);
  const view = athleteView(agenda);
  const of = (k: SectionKey) => view.find((s) => s.key === k)?.points ?? [];
  const open = commitments.filter((c) => c.status === "open" && c.confirmed !== false);
  const athleteDoes = open.filter((c) => c.owner === "athlete").map((c) => c.text);
  const coachDoes = open.filter((c) => c.owner === "coach").map((c) => c.text);
  return {
    goingWell: of("recognize").slice(0, 3),
    improving: [...of("evaluate").slice(0, 1), ...of("coach").slice(0, 2)].slice(0, 3),
    agreed: decisions.slice(0, 6),
    athleteDoes: athleteDoes.length ? athleteDoes : of("execute").slice(0, 3),
    coachDoes,
    next: agenda?.nextObjective ?? null,
  };
}
