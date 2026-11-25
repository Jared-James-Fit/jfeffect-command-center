/**
 * Tutorials: short, skippable first-use guidance, only for what the person has
 * (Nov 25 2026). Each one opens by itself once, the first time its screen is
 * opened, and never again on any device once it's finished or skipped (stored
 * server-side in feature_announcement_views as `tutorial:<id>`, and
 * `tutorial:<id>:done` when finished). Account → Help & Tutorials replays any
 * of them. No screen carries a permanent tutorial button. Pure and tested
 * (tutorials.test.ts); the words match the support knowledge base.
 *
 * The workout logger's own tutorial is "Fastest way to log" (`QuickLogTips`),
 * which the workout opens once per account itself (workout_view_prefs); the
 * hub replays it, it isn't repeated here.
 */
export type TutorialTier = "self_serve" | "coaching";
export type TutorialStep = { title: string; body: string };
export type Tutorial = {
  id: string;
  title: string;
  /** The screen whose first visit opens it (exact path or its sub-pages); none = replay only. */
  route?: string;
  /** Who has the feature; absent = everyone. */
  tiers?: TutorialTier[];
  steps: (tier: TutorialTier) => TutorialStep[];
  /** Opened by its own screen (the logger's), so the gate never opens it. */
  ownTrigger?: boolean;
};

export const TUTORIALS: Tutorial[] = [
  {
    id: "logger",
    title: "Fastest way to log a workout",
    ownTrigger: true,
    steps: () => [],
  },
  {
    id: "messages",
    title: "Messages and JF Effect Support",
    route: "/portal/messages",
    steps: (tier) => [
      ...(tier === "coaching"
        ? [{ title: "Your coach is first", body: "Your coach's chat is pinned at the top: training, nutrition, check-ins and forms all happen there." }]
        : []),
      { title: "JF Effect Support", body: "Questions about the app or your account go to JF Effect Support. Cleo, JF Effect's assistant, answers first; \"Talk to a person\" reaches the team any time." },
      { title: "Message the crew", body: "Tap the pencil to message another member or start a group. Hold a chat to pin, mute or delete it." },
    ],
  },
  {
    id: "programs",
    title: "Choosing a program",
    route: "/portal/programs",
    tiers: ["self_serve"],
    steps: () => [
      { title: "Pick a plan", body: "Programs has the JF Effect plans, the crew's programs and your own. Open one to see what it is." },
      { title: "Start it", body: "Starting a plan puts its workouts on your calendar on your training days." },
      { title: "Change any time", body: "Switch or end a program from the same page. Everything you've logged stays." },
    ],
  },
  {
    id: "nutrition",
    title: "Nutrition and the food log",
    route: "/portal/nutrition-targets",
    steps: (tier) => [
      { title: "Your targets", body: tier === "coaching" ? "Your targets are at the top, set with your coach." : "Your suggested targets are at the top: estimates to start from, not medical advice." },
      { title: "Log food fast", body: "Log a meal from Saved, Quick add (the numbers off a label) or Describe (type what you ate for an estimate)." },
    ],
  },
  {
    id: "crew",
    title: "The Crew",
    route: "/portal/community",
    steps: () => [
      { title: "The feed", body: "See what the crew is training, newest first. Like and comment like you would anywhere." },
      { title: "Share", body: "Tap + at the top to share a workout or a photo." },
      { title: "Rankings", body: "Rankings shows where you stand, and the League has a new week every week." },
    ],
  },
  {
    id: "progress",
    title: "Tracking progress",
    route: "/portal/progress",
    steps: () => [
      { title: "Everything in one place", body: "Photos, videos, bodyweight and measurements live here." },
      { title: "Compare", body: "Put two dates side by side to see what's changed." },
    ],
  },
  {
    id: "calendar",
    title: "Your calendar",
    route: "/portal/calendar",
    steps: () => [
      { title: "Your week", body: "Your workouts and anything booked, in one calendar." },
      { title: "Move a workout", body: "You can always move your own upcoming workouts. Your usual training days are in Account → Units & training days." },
    ],
  },
];

export const tutorialKey = (id: string) => `tutorial:${id}`;
export const tutorialDoneKey = (id: string) => `tutorial:${id}:done`;

/** The tutorials this person has (the features of their tier). */
export function tutorialsFor(tier: TutorialTier): Tutorial[] {
  return TUTORIALS.filter((t) => !t.tiers || t.tiers.includes(tier));
}

/** The tutorial a screen opens on its first visit, if it has one this person hasn't finished or skipped. */
export function tutorialToShow(pathname: string, tier: TutorialTier, seen: ReadonlySet<string>): Tutorial | null {
  for (const t of tutorialsFor(tier)) {
    if (!t.route || t.ownTrigger) continue;
    const on = pathname === t.route || pathname.startsWith(`${t.route}/`);
    if (on && !seen.has(tutorialKey(t.id)) && t.steps(tier).length > 0) return t;
  }
  return null;
}

export type TutorialStatus = "new" | "skipped" | "done";
export function tutorialStatus(id: string, seen: ReadonlySet<string>): TutorialStatus {
  if (seen.has(tutorialDoneKey(id))) return "done";
  if (seen.has(tutorialKey(id))) return "skipped";
  return "new";
}
