// The landing page's app screens (src/assets/landing/*.webp), from the app
// itself run locally against fixtures for a made-up athlete ("Alex", a free
// member), so they always match the current app and never show anyone's data.
// Re-run after the app's look changes:
//
//   npx vite dev --port 5173 --host 127.0.0.1           (in one terminal)
//   node scripts/coaching-screenshots/landing.cjs        (in another)
//
// app-home     Home: today, the week, progress (the hero)
// app-focus    today's back squat in Focus mode, one exercise a screen (the hero)
// app-week     Workouts: the week's calendar and today's workout
// app-log      the logger: a set logged, the next two waiting with their reps and
//              RPE already filled in, last time on the card
// app-insights Training analytics, Overview: estimated maxes, PRs, volume, consistency
// app-food     Nutrition: their own meal plan and macros
// app-build    the program builder on a phone: the Strength block's Lower A, a top set and its back-offs
// app-build-desktop  the same program in the builder on a computer
// app-import   an imported spreadsheet, every exercise matched, ready to save
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { run } = require("./harness.cjs");
const { composeWebp, composeDesktopWebp } = require("./frame.cjs");
const F = require("./fixtures.cjs");

const OUT = path.join(process.cwd(), "src/assets/landing");
const TMP = fs.mkdtempSync(path.join(require("os").tmpdir(), "landing-shots-"));
process.env.WAIT = process.env.WAIT || "10000";
const ONLY = process.argv.slice(2);

// a free member who logs bar speed (the column is on for them)
const member = { ...F.client, service_tier: "self_serve", status: "Member", assigned_coach_id: null, velocity_input_default: true };
// today's squat sets with the bar speed a tracker gave them
const SPEED = { "17:10": 0.56, "17:14": 0.54, "17:18": 0.52, "17:22": 0.5 };
const baseResults = F.fixtures.pl_row_results;
const results = (u) =>
  baseResults(u).map((x) => {
    const t = String(x.completed_at ?? "").slice(11, 16);
    return String(x.completed_at ?? "").startsWith("2026-11-06") && SPEED[t] != null ? { ...x, mean_concentric_velocity_mps: SPEED[t] } : x;
  });

// the fixtures' day: Friday Nov 6 2026, 11:20 AM in Winnipeg (the clock runs on from there)
const FIXED_CLOCK = `(() => {
  const off = Date.parse("2026-11-06T17:20:00Z") - Date.now();
  const D = Date;
  class FakeDate extends D {
    constructor(...a) { if (a.length === 0) super(D.now() + off); else super(...a); }
    static now() { return D.now() + off; }
  }
  FakeDate.parse = D.parse;
  FakeDate.UTC = D.UTC;
  globalThis.Date = FakeDate;
})();`;

const common = {
  initScript: FIXED_CLOCK,
  rpc: {
    ensure_my_member_client: F.CLIENT_ID,
    athlete_program_can_author: true,
    community_activity: { enabled: true, unseen: 0, seen_at: "2026-11-06T16:00:00Z" },
  },
  before: { "jf-theme": "dark", "jf-theme-updated-at": "2026-11-01T00:00:00Z" },
  scale: 2,
  height: 763,
  log: false,
};
const fixtures = {
  ...F.fixtures,
  clients: [member],
  pl_row_results: results,
  exercise_aliases: [],
  // the logger's tips and Focus intro already seen (they'd cover the screen)
  workout_view_prefs: [
    { user_id: F.USER_ID, view: "list", tried_at: "2026-10-01T00:00:00Z", focus_tips_at: "2026-11-06T00:00:00Z", logging_tips_at: "2026-10-01T00:00:00Z", set_video_tip_count: 9, set_video_tip_last_at: "2026-11-06T00:00:00Z" },
  ],
};

const ex = (name) => {
  const e = F.fixtures.exercises.find((x) => x.name === name);
  if (!e) throw new Error(`no fixture exercise ${name}`);
  return e;
};
const key = (s) => s.replace(/[^a-z0-9]/gi, "").slice(0, 12) + Math.random().toString(36).slice(2, 6);

/* ---------- the builder: a 12 week program in three blocks ---------- */
const PROG_ID = "f1111111-2222-4333-8444-555555555555";
// each block's days: [name, sets, reps, rpe, rest, role?, pct?] (a top set and its back-offs share a group)
const BLOCKS = [
  {
    name: "Hypertrophy",
    topRpe: ["7", "7.5", "8", "6"],
    days: [
      ["Lower A", [["Back Squat", 4, "8", "7", 150], ["Romanian Deadlift", 3, "10", "7", 120], ["Leg Press", 3, "12-15", "8", 90], ["Seated Leg Curl", 3, "12-15", "9", 60]]],
      ["Upper A", [["Bench Press", 4, "8", "7", 150], ["Chest Supported Row", 3, "10-12", "8", 90], ["Seated Dumbbell Shoulder Press", 3, "10-12", "8", 90], ["Cable Lateral Raise", 3, "15-20", "9", 60]]],
      ["Lower B", [["Deadlift", 3, "6", "7", 180], ["Bulgarian Split Squat", 3, "10", "8", 90], ["Seated Leg Curl", 3, "12", "9", 60]]],
      ["Upper B", [["Incline Dumbbell Press", 4, "10", "8", 120], ["Lat Pulldown", 4, "10-12", "8", 90], ["Cable Lateral Raise", 3, "15", "9", 60]]],
    ],
  },
  {
    name: "Strength",
    topRpe: ["7.5", "8", "8.5", "6"],
    days: [
      ["Lower A", [["Back Squat", 1, "3", "8", 240, "top"], ["Back Squat", 3, "5", null, 180, "backoff", 85], ["Romanian Deadlift", 3, "6", "7", 150], ["Leg Press", 3, "8-10", "8", 120], ["Seated Leg Curl", 3, "10", "8", 75]]],
      ["Upper A", [["Bench Press", 1, "3", "8", 240, "top"], ["Bench Press", 3, "5", null, 180, "backoff", 85], ["Chest Supported Row", 3, "8", "8", 120], ["Cable Lateral Raise", 3, "12-15", "9", 60]]],
      ["Lower B", [["Deadlift", 1, "2", "8", 240, "top"], ["Deadlift", 2, "4", null, 180, "backoff", 85], ["Bulgarian Split Squat", 3, "8", "8", 90]]],
      ["Upper B", [["Incline Dumbbell Press", 4, "6-8", "8", 120], ["Lat Pulldown", 4, "8-10", "8", 90]]],
    ],
  },
  {
    name: "Peak",
    topRpe: ["8.5", "9", "9", "6"],
    days: [
      ["Lower A", [["Back Squat", 1, "1", "9", 300, "top"], ["Back Squat", 2, "3", null, 180, "backoff", 90], ["Romanian Deadlift", 2, "5", "7", 150]]],
      ["Upper A", [["Bench Press", 1, "1", "9", 300, "top"], ["Bench Press", 2, "3", null, 180, "backoff", 90], ["Chest Supported Row", 3, "8", "7", 120]]],
      ["Lower B", [["Deadlift", 1, "1", "8.5", 300, "top"], ["Deadlift", 2, "2", null, 180, "backoff", 90]]],
      ["Upper B", [["Incline Dumbbell Press", 3, "6", "7", 120], ["Lat Pulldown", 3, "8", "7", 90]]],
    ],
  },
];
const DAYS = BLOCKS[0].days;
const dayKeys = DAYS.map(([t]) => key(t));
const plan = {
  v: 1,
  blocks: BLOCKS.map((bl) => {
    const groupKeys = bl.days.map(() => key("g"));
    const exKeys = bl.days.map(([, rows]) => rows.map(([n]) => key(n)));
    return {
      key: key(bl.name),
      name: bl.name,
      weeks: bl.topRpe.map((top, w) => ({
        key: key(`${bl.name}${w}`),
        days: bl.days.map(([title, rows], d) => ({
          key: dayKeys[d],
          title,
          focus: null,
          exercises: rows.map(([n, sets, reps, rpe, rest, role, pct], i) => ({
            key: exKeys[d][i],
            exercise_id: ex(n).id,
            // the deload week (the block's 4th) drops a set off everything but a top set
            sets: w === 3 && role !== "top" ? Math.max(1, sets - 1) : sets,
            reps,
            rpe: role === "backoff" ? null : i === 0 ? top : w === 3 ? "6" : rpe,
            rir: null,
            load: null,
            unit: null,
            pct: role === "backoff" ? pct : null,
            pct_of: role === "backoff" ? "top_set" : null,
            rest_seconds: rest,
            tempo: null,
            notes: null,
            role: role ?? null,
            group: role ? groupKeys[d] : null,
          })),
        })),
      })),
    };
  }),
};
const exercise_info = Object.fromEntries(
  F.fixtures.exercises.map((e) => [e.id, { name: e.name, muscle_group: e.muscle_group, equipment: e.equipment }]),
);
const detail = {
  id: PROG_ID,
  // short enough for the builder's header on a phone, never cut off
  title: "Upper / Lower",
  description: null,
  goal: "strength",
  level: "intermediate",
  weeks: 12,
  blocks: 3,
  days_per_week: 4,
  exercise_count: 14,
  visibility: "private",
  published_at: null,
  updated_at: "2026-11-05T18:00:00Z",
  save_count: 0,
  start_count: 0,
  hidden: false,
  is_mine: true,
  author: null,
  day_titles: DAYS.map(([t]) => t),
  forked_from: null,
  hidden_reason: null,
  can_moderate: false,
  copied: false,
  days: [],
  plan,
  exercise_info,
};

/* ---------- an imported spreadsheet, ready to check ---------- */
const IMP_ID = "e2222222-2222-4333-8444-555555555555";
const E = (name, sets, reps, more = {}) => ({
  name, sets, reps, load: null, unit: null, pct: null, pct_of: null, rpe: null, rir: null, tempo: null, rest_seconds: null,
  group: null, velocity: null, notes: null, src: `${name} | ${sets} | ${reps}`, unsure: null, ...more,
});
const PCT = [70, 72.5, 75, 65, 75, 77.5, 80, 65];
const importWeeks = PCT.map((pct, w) => ({
  label: `Week ${w + 1}`,
  deload: w === 3 || w === 7,
  notes: null,
  days: [
    { title: "Lower A", notes: null, exercises: [E("Back Squat", w === 3 || w === 7 ? 3 : 5, "5", { pct, pct_of: "1rm", rest_seconds: 180 }), E("RDL", 3, "8", { rpe: "7", rest_seconds: 150 }), E("Leg Press", 3, "10-12", { rir: "2" }), E("Seated Leg Curl", 3, "12", { rir: "2" })] },
    { title: "Upper A", notes: null, exercises: [E("Bench Press", w === 3 || w === 7 ? 3 : 5, "5", { pct, pct_of: "1rm", rest_seconds: 180 }), E("Chest Supported Row", 3, "8-10", { rir: "2" }), E("Seated DB Shoulder Press", 3, "8-10", { rir: "2" }), E("Cable Lateral Raise", 3, "15", { rir: "1" })] },
    { title: "Lower B", notes: null, exercises: [E("Deadlift", 4, "3", { pct: pct + 5, pct_of: "1rm", rest_seconds: 180 }), E("SSB Squat", 3, "6", { rpe: "7" }), E("Seated Leg Curl", 3, "10", { rir: "2" })] },
    { title: "Upper B", notes: null, exercises: [E("Incline DB Press", 4, "8", { rir: "2" }), E("Lat Pulldown", 4, "10", { rir: "2" }), E("Cable Lateral Raise", 3, "15", { rir: "1" })] },
  ],
}));
const importRow = {
  id: IMP_ID,
  status: "ready",
  method: "parsed",
  source_kind: "xlsx",
  file_name: "Upper Lower 8 Week.xlsx",
  file_paths: [],
  files_deleted_at: null,
  source_text: "=== Week 1 ===\nDay | Exercise | Sets | Reps | %1RM | RPE | RIR | Rest\n…",
  result: { title: "Upper Lower 8 Week", notes: null, unit: "lb", blocks: [{ name: null, weeks: importWeeks }], progression: [], issues: [] },
  error: null,
  program_id: null,
  created_at: "2026-11-06T16:00:00Z",
  updated_at: "2026-11-06T16:00:05Z",
};

/* ---------- the free nutrition tools: targets and today's food log ---------- */
const MEMBER_ROW_ID = "d3333333-2222-4333-8444-555555555555";
const at = (hm) => `2026-11-06T${hm}:00-06:00`;
const meal = (i, name, hm, calories, protein_g, carbs_g, fat_g) => ({
  id: `a${i}333333-2222-4333-8444-555555555555`, member_id: MEMBER_ROW_ID, user_id: F.USER_ID, name, logged_at: at(hm),
  calories, protein_g, carbs_g, fat_g, preset_id: null, raw_text: null, source: "manual", created_at: at(hm), updated_at: at(hm),
});
const MEALS = [
  meal(1, "Oats, whey and a banana", "07:30", 520, 42, 74, 8),
  meal(2, "Chicken, rice and greens", "12:15", 640, 52, 78, 12),
  meal(3, "Greek yogurt and berries", "15:40", 260, 26, 28, 5),
];

// their own meal plan, made in the Nutrition Studio (a member writes it; no coach)
const MEAL_DAY = `Breakfast
80 g oats (dry weight)
1 scoop whey protein
1 banana
Approx: 42P / 74C / 8F

Lunch
170 g chicken breast (raw)
250 g white rice (cooked)
100 g broccoli
Approx: 52P / 78C / 12F

Snack
200 g Greek yogurt (0%)
100 g berries
Approx: 26P / 28C / 5F

Dinner
180 g lean ground beef (raw)
300 g potatoes
100 g green beans
Approx: 40P / 55C / 22F`;
const OWN_PLAN = {
  id: "f3333333-2222-4333-8444-555555555555", client_name: "Alex Demo", coach_name: null, updated_at: "2026-11-05T14:00:00Z", phase: "Build strength", goal: null, structure: null,
  status: "Active", start_date: "2026-11-02", end_date: null, water: "3.5 L", client_notes: null, food_weighing_rules: null, pdf_name: null, pdf_signed_url: null, source: "member",
  days: [
    { id: "f1", day_label: "Training Day", calories: 1980, protein: 160, carbs: 235, fats: 47, fibre: null, steps: 9000, notes: MEAL_DAY, use_on: "training", weekdays: [] },
  ],
};
const dashboard = {
  member: { id: MEMBER_ROW_ID, user_id: F.USER_ID },
  target: { id: "e3333333-2222-4333-8444-555555555555", member_id: MEMBER_ROW_ID, active: true, pending_review: false, calories: 2550, protein_g: 190, carbs_g: 290, fat_g: 70, water_ml: 3500, goal: "Build strength", source: "calculator", notes: null, coach_note: null, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", approved_at: null, approved_by: null, coach_ack_at: null, input_snapshot: null },
  pendingTarget: null,
  meals: MEALS,
  presets: [],
  supplements: [],
  supplementLogs: [],
  weekMeals: MEALS,
};

/* ---------- weigh-ins (Home's bodyweight card, and no "add your bodyweight" prompt) ---------- */
const WEIGH_INS = Array.from({ length: 28 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 10 + i));
  const day = d.toISOString().slice(0, 10);
  const w = 184.6 - i * 0.1 + 0.35 * Math.sin(i * 1.7) + 0.2 * Math.sin(i * 0.9 + 1);
  return { id: `b${String(i).padStart(7, "0")}-2222-4333-8444-555555555555`, user_id: F.USER_ID, logged_date: day, weight_value: Math.round(w * 10) / 10, weight_unit: "lb", note: null, created_at: `${day}T13:00:00Z`, updated_at: `${day}T13:00:00Z` };
});

/* ---------- moving around ---------- */
const blur = async (p) => {
  await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await p.waitForTimeout(400);
};
const scrollToText = (text, offset = 16) => async (p) => {
  const y = await p.evaluate((t) => {
    const el = [...document.querySelectorAll("h1,h2,h3,div,span,p")].find((n) => n.childElementCount === 0 && n.textContent.trim() === t);
    return el ? el.getBoundingClientRect().top + window.scrollY : 0;
  }, text);
  await p.evaluate((yy) => window.scrollTo(0, yy), Math.max(0, y - offset));
  await p.waitForTimeout(1200);
  await blur(p);
};
const closeToasts = async (p) => {
  await p.evaluate(() => document.querySelectorAll("[data-sonner-toast]").forEach((t) => t.remove()));
  await p.waitForTimeout(200);
};

const SHOTS = [
  // the hero: their Home (today's workout, the week, progress) and a workout in Focus mode
  { name: "app-home", path: "/portal", fixtures: { progress_bodyweight: WEIGH_INS }, afterLoad: async (p) => { await closeToasts(p); await blur(p); } },
  {
    // the hero's front phone: today's back squat in Focus mode, three sets in
    // (bar speed beside each), the last one waiting with its reps and RPE filled in
    name: "app-focus",
    path: `/portal/workouts/${F.todayDayId}`,
    fixtures: {
      pl_row_results: (u) =>
        results(u).filter((x) => {
          const at = String(x.completed_at ?? "");
          return !(at.startsWith("2026-11-06T17:22") || at.startsWith("2026-11-06T17:30"));
        }),
      workout_view_prefs: [
        { user_id: F.USER_ID, view: "story", tried_at: "2026-10-01T00:00:00Z", focus_tips_at: "2026-11-06T00:00:00Z", logging_tips_at: "2026-10-01T00:00:00Z", set_video_tip_count: 9, set_video_tip_last_at: "2026-11-06T00:00:00Z" },
      ],
    },
    afterLoad: async (p) => { await closeToasts(p); await blur(p); },
  },
  { name: "app-week", path: "/portal/workouts", afterLoad: blur },
  {
    // what the Logging section says: reps and RPE come filled in, type the weight
    // and it's logged, last time on the same card. The squat's done; the Romanian
    // deadlift has its first set in and two waiting, the whole card on screen.
    name: "app-log",
    path: `/portal/workouts/${F.todayDayId}`,
    afterLoad: scrollToText("Romanian Deadlift", 40),
  },
  {
    // Training analytics, Overview: what the Progress section lists (estimated
    // maxes, PRs, volume and consistency) over the last 12 weeks
    name: "app-insights",
    path: "/portal/workouts/analytics?view=overview&filter=last_12w",
    afterLoad: async (p) => {
      await p.waitForTimeout(2500);
      await blur(p);
    },
  },
  {
    // the free nutrition tools: today's targets and food log
    name: "app-food",
    path: "/portal/nutrition-targets",
    fixtures: { member_nutrition_targets: [dashboard.target], member_meal_logs: MEALS },
    serverFnMocks: { getNutritionDashboard: dashboard, getActiveMemberTargets: dashboard.target, getCoachAssignedMealPlan: OWN_PLAN },
    afterLoad: async (p) => {
      await closeToasts(p);
      await blur(p);
    },
  },
  {
    // the Strength block's first week: a top set with its back-offs, the blocks' colours along the bottom
    name: "app-build",
    path: `/portal/programs/new?edit=${PROG_ID}`,
    rpc: { athlete_program_detail: detail, athlete_program_drafts: null },
    fixtures: { athlete_program_drafts: [], athlete_program_versions: [] },
    afterLoad: async (p) => {
      await closeToasts(p);
      await p.click('[data-week-tab="1:0"]').catch(() => {});
      await p.waitForTimeout(800);
      await blur(p);
    },
  },
  {
    name: "app-build-desktop",
    desktop: true,
    width: 1280,
    height: 800,
    path: `/portal/programs/new?edit=${PROG_ID}`,
    rpc: { athlete_program_detail: detail },
    fixtures: { athlete_program_drafts: [], athlete_program_versions: [] },
    afterLoad: async (p) => {
      await closeToasts(p);
      await p.click('[data-week-tab="1:0"]').catch(() => {});
      await p.waitForTimeout(800);
      await blur(p);
    },
  },
  {
    // every exercise matched (shorthand too: "SSB Squat", "RDL"), nothing to fix, Save one tap away
    name: "app-import",
    path: `/portal/programs/import?id=${IMP_ID}`,
    fixtures: { program_imports: [importRow], athlete_program_drafts: [] },
    afterLoad: async (p) => {
      await closeToasts(p);
      // the matches it made, shorthand included ("SSB Squat" → Safety Squat Bar Squat)
      await p.click('[data-import-group="matched"] button').catch(() => {});
      await p.waitForTimeout(500);
      await blur(p);
    },
  },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const s of SHOTS) {
    if (ONLY.length && !ONLY.includes(s.name)) continue;
    const raw = path.join(TMP, `${s.name}.png`);
    await run({
      ...common,
      ...(s.desktop ? { desktop: true, width: s.width, height: s.height, scale: 2 } : {}),
      rpc: { ...common.rpc, ...(s.rpc ?? {}) },
      path: s.path,
      out: raw,
      fixtures: { ...fixtures, ...(s.fixtures ?? {}) },
      serverFnMocks: s.serverFnMocks ?? {},
      afterLoad: s.afterLoad,
      log: !!process.env.LOG,
    });
    if (process.env.RAW) fs.copyFileSync(raw, path.join(process.env.RAW, `${s.name}.png`));
    const out = path.join(OUT, `${s.name}.webp`);
    if (s.desktop) await composeDesktopWebp(browser, raw, out, { width: s.width, height: s.height });
    else await composeWebp(browser, raw, out);
    console.log(`${s.name}.webp  ${Math.round(fs.statSync(out).size / 1024)} KB`);
  }
  await browser.close();
})();
