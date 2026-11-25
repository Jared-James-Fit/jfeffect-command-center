/**
 * Representative automated posts for the post-design harness and tests: one
 * of every card kind, a deck in every theme, the content shapes the writers
 * actually produce (long and short covers, stats, myths, lists, quotes).
 * Made-up words in the coach's voice; no client's data.
 */
import type { CommunityPost } from "@/lib/community";

const author = { id: "coach", name: "Jared McIntyre", username: "jared", avatar: null, is_coach: true } as unknown as CommunityPost["author"];

function base(id: string, over: Partial<CommunityPost>): CommunityPost {
  return {
    id,
    created_at: "2026-11-20T13:00:00Z",
    visibility: "community",
    caption: "",
    media_path: null,
    media_type: null,
    kind: "note",
    series: null,
    series_data: null,
    series_extra: null,
    story: false,
    author,
    mentions: [],
    ...over,
  } as unknown as CommunityPost;
}

const deck = (theme: string, slides: unknown[], caption = "i think most people overthink this one. keep it simple for a month and see what happens") => ({
  deck: { v: 1, theme, slides, caption },
});

export const FIXTURES: { label: string; post: CommunityPost }[] = [
  {
    label: "Lesson deck · stat",
    post: base("l1", {
      series: "lesson",
      series_extra: { track: "hypertrophy", title: "Protein timing", ...deck("blush", [
        { type: "cover", kicker: "Hypertrophy", title: "You need *less* protein than the internet says", sub: "What a 2022 look at 69 studies found, and what it means for your plate." },
        { type: "stat", value: "1.6 g/kg", label: "Where muscle gain levels off for most lifters", bars: [{ label: "Most lifters", value: "1.6" }, { label: "Internet advice", value: "3.3" }], note: "A 2018 meta-analysis of 49 studies" },
        { type: "point", n: 1, title: "Hit the daily total first", body: "Timing barely matters until the number for the day is right. Most people miss the total, not the window." },
        { type: "point", n: 2, title: "Then spread it out", body: "Three or four meals with a decent hit of protein each covers almost everyone." },
        { type: "takeaway", title: "Get the total right for a month before you worry about *timing*" },
      ]) },
    }),
  },
  {
    label: "Truth deck · myth",
    post: base("l2", {
      series: "lesson",
      series_extra: { track: "truth", title: "Soreness", ...deck("red", [
        { type: "cover", kicker: "Uncomfortable truth", title: "Soreness isn't proof it *worked*" },
        { type: "compare", myth: true, left: { label: "The belief", text: "If I'm not sore, the workout didn't do anything" }, right: { label: "What's true", text: "Soreness tracks how new the work is, not how much muscle you built" } },
        { type: "list", title: "Better signs it's working", items: ["Your reps go up at the same weight", "Your sets feel easier week to week", "Your log moves forward"], style: "check" },
        { type: "takeaway", title: "Judge the log, not how your legs feel on Tuesday" },
      ]) },
    }),
  },
  {
    label: "Technique deck · list",
    post: base("l3", {
      series: "lesson",
      series_extra: { track: "fix", title: "Bench arch", ...deck("slate", [
        { type: "cover", kicker: "Technique fix", title: "Your bench stalls at the *same spot* every time" },
        { type: "point", title: "It's usually the touch, not the lockout", body: "A bar that drifts toward your face off the chest has to travel further and slower through the hardest part." },
        { type: "list", title: "Fix it in three cues", items: ["Touch the same spot every rep", "Drive back toward your face", "Keep your feet planted the whole set"], style: "number" },
        { type: "quote", text: "The bar goes where your eyes and elbows tell it to.", by: "Coach Jared" },
        { type: "takeaway", title: "Film one set from the side this week and *watch the touch*" },
      ]) },
    }),
  },
  {
    label: "Single-slide deck",
    post: base("l4", {
      series: "tuesday_tips",
      series_extra: { kind: "cue", ...deck("bone", [
        { type: "cover", kicker: "Tuesday tip", title: "Rest longer between your heavy sets", sub: "Three to five minutes on the main lift keeps your reps up, which is the whole point." },
      ]) },
    }),
  },
  {
    label: "Long cover deck",
    post: base("l5", {
      series: "lesson",
      series_extra: { track: "mind", title: "Consistency", ...deck("paper", [
        { type: "cover", kicker: "Mind & recovery", title: "Why the athletes who never miss a week usually aren't the most motivated ones", sub: null },
        { type: "point", title: "They plan the hard weeks", body: "A shorter session on a bad week beats a skipped one every time." },
        { type: "takeaway", title: "Write the bad-week version of your plan *now*" },
      ]) },
    }),
  },
  {
    label: "Words (tip, no deck)",
    post: base("w1", {
      series: "tuesday_tips",
      series_extra: { kind: "cue" } as never,
      caption: "Brace before you unrack, not after. Big breath into your belly, then pull the bar out of the hooks.\n\nmost misses start in the walkout",
    }),
  },
  {
    label: "Wednesday Wins",
    post: base("ww", {
      series: "wednesday_wins",
      caption: "50 PRs last week between 9 of you",
      series_data: { week_of: "2026-11-09", roster: 18, opened: 15, trained: 14, sessions: 61, sessions_prev: 52, prs: 50, pr_people: 9, volume_kg: 182000, reps: 9400, streaks: 6, bodyweight: 40, checkins: 12, busiest_day: "Mon", volume_prev_kg: 160000, volume_rank: 1, sessions_rank: 2, weeks_tracked: 12, history: [{ wk: "2026-09-21", sessions: 40 }, { wk: "2026-09-28", sessions: 44 }, { wk: "2026-10-05", sessions: 39 }, { wk: "2026-10-12", sessions: 47 }, { wk: "2026-10-19", sessions: 51 }, { wk: "2026-10-26", sessions: 49 }, { wk: "2026-11-02", sessions: 52 }, { wk: "2026-11-09", sessions: 61 }] } as never,
    }),
  },
  {
    label: "Sunday Recap",
    post: base("sr", {
      series: "sunday_recap",
      caption: "Week recap",
      series_data: { kind: "recap", week_of: "2026-11-09", roster: 18, opened: 15, trained: 14, sessions: 61, sessions_prev: 52, prs: 50, pr_people: 9, volume_kg: 182000, reps: 9400, streaks: 6, bodyweight: 40, checkins: 12, busiest_day: "Mon", planned: 70, planned_done: 58, hit: 10, active: 14, days: [14, 11, 9, 10, 8, 6, 3], completed: 61, fully_logged: 55, top: [{ name: "Marc", type: "pr", text: "Marc squatted 405 for a double, a 20 lb PR" }, { name: "Fionna", type: "streak", text: "Fionna hasn't missed a week in three months" }, { name: "Devin", type: "pr", text: "Devin's first 315 bench" }], improve: { kind: "logging", text: "Log every set" } } as never,
    }),
  },
  {
    label: "Tuesday numbers",
    post: base("tn", {
      series: "tuesday_tips",
      caption: "People who train 3+ times a week hit almost twice as many PRs",
      series_extra: { observation: "frequency", habit: "sessions", outcome: "prs", a: 8, b: 10, x: 4.2, y: 2.1 } as never,
    }),
  },
  {
    label: "Thursday feature",
    post: base("tf", {
      series: "try_it_thursday",
      caption: "Your warm-ups can tune today's weight",
      series_extra: { feature: "warmup", title: "Log your last warm-up", where: ["Workouts", "Exercise", "+ Warm-up"], stat: null } as never,
    }),
  },
  {
    label: "Birthday",
    post: base("bd", {
      series: null,
      caption: "Happy birthday @amanda!\nthree meets this year and a 40 lb deadlift PR. proud of you",
      series_data: { birthday: { name: "Amanda", user_id: "a" } } as never,
    }),
  },
  {
    label: "Lesson card (truth, no deck)",
    post: base("lt", {
      series: "lesson",
      caption: "You don't need to train to failure to grow.",
      series_extra: { track: "truth", title: "Failure isn't required", visual: { kind: "truth", belief: "Every set has to go to failure", truth: "Most of your growth comes from sets two or three reps short" } } as never,
    }),
  },
  {
    label: "Longest cover the old writer allowed (before tightening)",
    post: base("l6", {
      series: "lesson",
      series_extra: { track: "strength", title: "Bar path", ...deck("slate", [
        { type: "cover", kicker: "Strength science", title: "Your squat's sticking point usually starts *lower* than where it stalls" },
        { type: "point", title: "The bar slows before it stops", body: "Film from the side and watch where it starts to slow, not where it grinds." },
        { type: "takeaway", title: "Train the range where it *slows*" },
      ]) },
    }),
  },
];
